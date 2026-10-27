/**
 * The agent's path, end to end: the real `browser_read` / `browser_act` tools over the real
 * `BrowserService` over a fake far side.
 *
 * The tool tests in core use a stub port, and the service tests in server use the service
 * directly. Neither crosses the seam between them — the tool's argument names, the service's
 * request shape, and the result the tool hands back. That seam is where a rename on one side
 * would leave the other quietly wrong, and nothing in either package's own tests would say so.
 *
 * So this runs the tool the way the runtime does: the tool is built from the registry's own
 * definition, given the service as its port, and called with the arguments the model would
 * send. The far side is a fake, so what is under test is the seam — not the browser.
 */
import { describe, expect, it } from "vitest";
import {
  BROWSER_ACT_NAME,
  BROWSER_READ_NAME,
  BUILTIN_TOOL_FACTORIES,
} from "@jadelau/core";
import { defaultSystemConfig } from "@jadelau/core";
import type { ToolDefinitionConfig } from "@jadelau/core/interfaces";
import { BrowserService } from "../../src/browser/service.js";
import { FakeLink, evaluated, expressionOf, tab } from "./fake-link.js";

/**
 * The tool definition the registry hands the agent.
 *
 * The browser tools are not in the DEFAULT toolset — they are opt-in, because a host
 * without a browser has nothing for them to read — so the definition is built the way the
 * registry builds one, from the tool's own schema.
 */
function definitionFor(name: string): ToolDefinitionConfig {
  const builtin = defaultSystemConfig().tools?.builtin ?? [];
  const entry = builtin.find((tool) => tool.name === name);
  if (entry !== undefined) return entry;
  // Not in the default set: build the definition from the tool's own description, the way
  // an Agent whose config lists it would.
  return {
    name,
    description: "",
    permission: name === BROWSER_ACT_NAME ? "rw" : "r",
  };
}

/** A service over a fake far side, with the waiting taken out of it. */
function service(link: FakeLink): BrowserService {
  return new BrowserService({
    link,
    sleep: async () => undefined,
    now: () => 1_700_000_000_000,
    timing: {
      settleMs: 0,
      reloadWaitMs: 0,
      loadWaitMs: 0,
      popupClaimMs: 0,
      clickGapMs: 0,
      helperTimeoutMs: 1000,
      scanTimeoutMs: 1000,
      screenshotTimeoutMs: 1000,
    },
  });
}

/**
 * The tool, built the way the runtime builds it: through the registry's factory, with the
 * browser service handed over as the host's browser surface. That is the real wiring —
 * `services.browser` is what the service is registered as — so a rename on either side of
 * it would show up here and nowhere else.
 */
function readTool(link: FakeLink) {
  const factory = BUILTIN_TOOL_FACTORIES[BROWSER_READ_NAME];
  if (factory === undefined) throw new Error("browser_read is not in the registry");
  return factory(definitionFor(BROWSER_READ_NAME), { browser: service(link) });
}

/** The acting tool, built the same way. */
function actTool(link: FakeLink) {
  const factory = BUILTIN_TOOL_FACTORIES[BROWSER_ACT_NAME];
  if (factory === undefined) throw new Error("browser_act is not in the registry");
  return factory(definitionFor(BROWSER_ACT_NAME), { browser: service(link) });
}

/** Runs a tool the way the runtime does, and collects what it produced. */
async function run(
  tool: ReturnType<typeof readTool>,
  args: Record<string, unknown>,
): Promise<{ text: string; images: string[]; stopReason: string | undefined }> {
  const chunks: string[] = [];
  const generator = tool.execute(args, { workspaceDir: "/tmp", toolCallId: "call-1" });
  for (;;) {
    const next = await generator.next();
    if (next.done) {
      return {
        text: chunks.join(""),
        images: next.value?.images ?? [],
        stopReason: next.value?.stopReason,
      };
    }
    const payload = next.value.payload as { output?: string };
    if (typeof payload.output === "string") chunks.push(payload.output);
  }
}

describe("the agent's path through the browser", () => {
  it("reads the browser's state, and names the backend it is reading", async () => {
    const link = new FakeLink();
    link.show(tab(1, { title: "Example" }));
    const tool = readTool(link);
    const result = await run(tool, { action: "status" });
    expect(result.stopReason).toBeUndefined();
    expect(result.text).toContain("backend builtin");
    expect(result.text).toContain("Example");
  });

  it("scans a page and hands back what is on it", async () => {
    const link = new FakeLink();
    link.show(tab(1));
    link.cdp = (_tabId, method, params) => {
      if (method !== "Runtime.evaluate") return {};
      return evaluated({ content: "<main>Hello from the page</main>", truncated: false });
    };
    const tool = readTool(link);
    const result = await run(tool, { action: "scan" });
    expect(result.text).toContain("Hello from the page");
  });

  it("brings a screenshot back as an image, not as text", async () => {
    // The whole point of the screenshot being a tool: the model sees the page in the turn
    // that asked for it.
    const link = new FakeLink();
    link.show(tab(1));
    link.cdp = (_tabId, method) => (method === "Page.captureScreenshot" ? { data: "AAAB" } : {});
    const tool = readTool(link);
    const result = await run(tool, { action: "screenshot" });
    expect(result.images).toEqual(["data:image/png;base64,AAAB"]);
  });

  it("runs a script and hands back what it returned", async () => {
    const link = new FakeLink();
    link.show(tab(1));
    link.cdp = (_tabId, method, params) => {
      if (method !== "Runtime.evaluate") return {};
      const expression = expressionOf(params);
      if (expression.includes("startStrMonitor")) return evaluated(true);
      if (expression.includes("stopStrMonitor")) return evaluated({ transients: [], changed: 0 });
      return evaluated(JSON.stringify({ ok: true, data: { title: "Example" } }));
    };
    const tool = actTool(link);
    const result = await run(tool, { action: "exec", script: "return document.title" });
    expect(result.stopReason).toBeUndefined();
    expect(result.text).toContain("Example");
  });

  it("opens a page and reports the browser's state afterwards", async () => {
    const link = new FakeLink();
    const tool = readTool(link);
    const result = await run(tool, { action: "open", url: "https://example.test/" });
    expect(result.stopReason).toBeUndefined();
    expect(result.text).toContain("example.test");
  });

  it("says so plainly when the host has no browser", async () => {
    // A host with no browser surface is not an error the model should guess at: the tool
    // says what is missing.
    const link = new FakeLink();
    link.connected = false;
    const tool = readTool(link);
    const result = await run(tool, { action: "status" });
    expect(result.text).toContain("unavailable");
  });

  it("fails the call, with the reason, when the tab is not there", async () => {
    const link = new FakeLink();
    const tool = readTool(link);
    const result = await run(tool, { action: "scan", tab_id: 999 });
    expect(result.stopReason).toBe("fatal");
    expect(result.text).toMatch(/no tab|not open/i);
  });

  it("scrolls the page, and says where it ended up", async () => {
    // The position is the answer: a model told "scrolled to the bottom" when nothing moved
    // would keep asking, and one told the page's height can decide for itself.
    const link = new FakeLink();
    link.show(tab(1));
    link.cdp = (_tabId, method, params) => {
      if (method !== "Runtime.evaluate") return {};
      return evaluated({
        moved: true,
        x: 0,
        y: 600,
        atBottom: true,
        atTop: false,
        height: 2400,
        viewport: 800,
      });
    };
    const tool = actTool(link);
    const result = await run(tool, { action: "scroll", amount: 600 });
    expect(result.stopReason).toBeUndefined();
    expect(result.text).toContain("atBottom");
  });

  it("presses a key", async () => {
    const link = new FakeLink();
    link.show(tab(1));
    const tool = actTool(link);
    const result = await run(tool, { action: "press", key: "Enter" });
    expect(result.stopReason).toBeUndefined();
    expect(result.text).toContain("Enter");
  });

  it("chooses an option in a dropdown", async () => {
    const link = new FakeLink();
    link.show(tab(1));
    link.cdp = (_tabId, method) => {
      if (method !== "Runtime.evaluate") return {};
      return evaluated({ value: "us", label: "United States" });
    };
    const tool = actTool(link);
    const result = await run(tool, { action: "select", selector: "#country", value: "us" });
    expect(result.stopReason).toBeUndefined();
    expect(result.text).toContain("United States");
  });

  it("navigates, and takes a bare host or a search for what it is given", async () => {
    const link = new FakeLink();
    link.show(tab(1));
    const tool = actTool(link);
    const result = await run(tool, { action: "navigate", url: "localhost:3000" });
    expect(result.stopReason).toBeUndefined();
    // The address the page was sent to is the bare host with a scheme — the same rule the
    // address bar uses.
    const navigated = link.commands.find((c) => c.op === "cdp");
    expect(navigated).toBeTruthy();
  });

  it("says what is missing rather than failing obscurely", async () => {
    const link = new FakeLink();
    link.show(tab(1));
    const tool = actTool(link);
    const result = await run(tool, { action: "press" });
    expect(result.stopReason).toBe("fatal");
    expect(result.text).toContain("key");
  });
});
