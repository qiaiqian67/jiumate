/**
 * The wire between the server and the desktop shell, end to end.
 *
 * The two sides of this link are in different packages and were written at different times,
 * so what could go wrong is a shape they disagree about: a frame the server sends that the
 * shell does not recognise, an answer the server cannot read, an op one of them knows and
 * the other does not. None of that shows up in either package's own tests — each one
 * assumes the other's shape.
 *
 * So this runs the REAL server's `ShellLink` against the REAL desktop shell's command
 * parser, over one in-memory port, the way the app wires them. The shell is Electron-facing,
 * so it cannot be constructed here; but its half of the protocol — what it recognises as a
 * command, what it refuses — is `builtin-browser-rules.ts`, which is pure and is what the
 * shell actually runs. That is the half where a disagreement would live.
 *
 * The other half — the shell's own guest handling — needs Electron and is covered by the
 * desktop package's own tests and by running the app.
 */
import { describe, expect, it } from "vitest";
import { ShellLink } from "@jiumate/server/browser";
import { isBrowserCommandMessage, parseBrowserCommand } from "../src/builtin-browser-rules.js";
import type { BrowserTab } from "@jiumate/core/interfaces";

/** The shell's capabilities: it cannot create tabs (the Web App's `<webview>` does). */
const BUILTIN_CAPABILITIES = {
  createsTabs: false,
  throttles: true,
  cookieStore: true,
};

/** The slice of Electron's ParentPort the link uses. */
interface Port {
  on(event: "message", listener: (e: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

/**
 * The port both sides use, the way Electron's utilityProcess port works: ONE channel, and
 * each side's `postMessage` reaches the other's listener on it.
 *
 * This is the shape the real code has — the server listens on the shell's port
 * (`browserLink?.listen(shellPort)`) and the shell listens on the same one
 * (`wireBuiltinBrowser(port, …)`) — so a fixture with two ports, one for each side, would
 * be testing a topology the app does not have.
 */
function sharedPort(): { port: Port; sent: unknown[] } {
  const listeners: ((e: { data: unknown }) => void)[] = [];
  const sent: unknown[] = [];
  const port: Port = {
    on: (_event, listener) => {
      listeners.push(listener);
    },
    postMessage: (message) => {
      sent.push(message);
      // A copy: a listener that posts back would otherwise mutate the array being walked.
      for (const listener of [...listeners]) listener({ data: message });
    },
  };
  return { port, sent };
}

/**
 * The shell's half, as the desktop's real parser sees it: it recognises the frame, reads
 * the command, and answers with the frame the server reads back.
 */
function installShell(port: Port, tabs: BrowserTab[]): void {
  port.on("message", (e) => {
    const data = e.data;
    if (!isBrowserCommandMessage(data)) return;
    const parsed = parseBrowserCommand(data);
    if (parsed === null) return;
    if ("error" in parsed) {
      port.postMessage({
        type: "desktop-browser-reply",
        id: parsed.id,
        ok: false,
        error: parsed.error,
      });
      return;
    }
    const command = parsed.command;
    switch (command.op) {
      case "hello":
        port.postMessage({
          type: "desktop-browser-reply",
          id: parsed.id,
          ok: true,
          result: { version: 1 },
        });
        return;
      case "tabs":
        port.postMessage({
          type: "desktop-browser-reply",
          id: parsed.id,
          ok: true,
          result: { tabs },
        });
        return;
      case "open-tab": {
        const created: BrowserTab = {
          id: 7,
          url: String(command.url),
          title: "Page",
          loading: false,
          canGoBack: false,
          canGoForward: false,
        };
        // The shell announces the tab before it answers, exactly as it does.
        port.postMessage({
          type: "desktop-browser-event",
          event: { kind: "tab", tab: created },
        });
        port.postMessage({
          type: "desktop-browser-reply",
          id: parsed.id,
          ok: true,
          result: { tabId: created.id },
        });
        return;
      }
      default:
        port.postMessage({
          type: "desktop-browser-reply",
          id: parsed.id,
          ok: true,
          result: {},
        });
    }
  });
}

/** A link over the shared port, with the shell installed on it. */
function wired(tabs: BrowserTab[] = []): { link: ShellLink; port: Port } {
  const { port } = sharedPort();
  installShell(port, tabs);
  const link = new ShellLink({
    backend: "builtin",
    capabilities: BUILTIN_CAPABILITIES,
    send: (message) => port.postMessage(message),
  });
  link.listen(port);
  return { link, port };
}

describe("the server's link and the desktop's shell", () => {
  it("handshakes, and the two sides agree on the shape", async () => {
    const { link } = wired();
    expect(await link.handshake()).toBe(true);
    expect(link.connected).toBe(true);
  });

  it("reads the shell's tab list", async () => {
    const { link } = wired([
      {
        id: 1,
        url: "https://example.test/",
        title: "Example",
        loading: false,
        canGoBack: false,
        canGoForward: false,
      },
    ]);
    const answer = (await link.request({ op: "tabs" })) as { tabs: BrowserTab[] };
    expect(answer.tabs).toHaveLength(1);
    expect(answer.tabs[0]?.url).toBe("https://example.test/");
  });

  it("relays the shell's events, and the tab arrives before the answer", async () => {
    const { link } = wired();
    const seen: string[] = [];
    link.onEvent((event) => {
      if (event.kind === "tab") seen.push(event.tab.url);
    });
    await link.request({ op: "open-tab", url: "https://example.test/", activate: true });
    expect(seen).toEqual(["https://example.test/"]);
  });

  it("refuses a command the shell does not know, and the server learns why", async () => {
    // The shell's parser refuses an op it does not have; the server must be able to read that
    // refusal, or a mismatch here would hang the request until it timed out.
    const { link } = wired();
    await expect(link.request({ op: "fly-to-the-moon" } as never)).rejects.toThrow(/unknown_op/);
  });

  it("a frame the shell does not recognise leaves the server's request unanswered", async () => {
    // The port carries the updater's and the exporter's frames too. The shell ignores them
    // and the server's own link ignores them; neither may mistake the other's for its own.
    const { port } = sharedPort();
    port.on("message", (e) => {
      if ((e.data as { type?: string })?.type === "desktop-updater-command") {
        port.postMessage({ type: "desktop-updater-reply", id: "x", ok: true });
      }
    });
    const link = new ShellLink({
      backend: "builtin",
      capabilities: BUILTIN_CAPABILITIES,
      send: (message) => port.postMessage(message),
    });
    link.listen(port);
    // The updater's frame does not answer the browser's request, so the request times out
    // rather than being fulfilled by the wrong answer.
    await expect(link.request({ op: "hello" }, 200)).rejects.toThrow(/did not answer/);
  });
});
