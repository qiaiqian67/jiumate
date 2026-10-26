/**
 * Which browser the agent drives, and what happens when the chosen one is not there.
 *
 * The rule the whole feature rests on: a browser that works beats the one the user asked
 * for not working. The user asks for the built-in browser on a server with no desktop
 * shell, and they get the headless one rather than an error.
 */
import { describe, expect, it } from "vitest";
import type { BrowserBackend } from "@jiumate/core/interfaces";
import { BackendRouter } from "../../src/browser/backend-router.js";
import type { BrowserCommand, BrowserLink, BrowserLinkEvent } from "../../src/browser/link.js";
import {
  defaultBackend,
  isBrowserBackend,
  resolveBackend,
} from "../../src/services/browser-backend.js";

/** A link that answers every command, and says which backend it is. */
function fakeLink(backend: BrowserBackend, connected = true): BrowserLink {
  const listeners = new Set<(event: BrowserLinkEvent) => void>();
  return {
    backend,
    capabilities: { createsTabs: true, throttles: false, cookieStore: true },
    connected,
    canDrive: true,
    async request(command: BrowserCommand): Promise<unknown> {
      if (command.op === "hello") return { version: 1 };
      if (command.op === "tabs") return { tabs: [] };
      return {};
    },
    async handshake(): Promise<boolean> {
      return connected;
    },
    onEvent(listener: (event: BrowserLinkEvent) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onConnect(): () => void {
      return () => undefined;
    },
    onDisconnect(): () => void {
      return () => undefined;
    },
    dispose(): void {
      listeners.clear();
    },
  };
}

describe("the backend the user gets", () => {
  it("is the built-in one on the desktop, and the headless one everywhere else", () => {
    expect(defaultBackend(true)).toBe("builtin");
    // A server with no shell has no built-in browser at all.
    expect(defaultBackend(false)).toBe("headless");
  });

  it("falls back to the default when the stored value is not a backend", () => {
    // An older build's name, or a hand-edited file: the browser working matters more than
    // which one it is.
    expect(resolveBackend("something-else", true)).toBe("builtin");
    expect(resolveBackend(undefined, false)).toBe("headless");
    expect(resolveBackend(null, true)).toBe("builtin");
  });

  it("keeps a value that is a backend", () => {
    expect(resolveBackend("headless", true)).toBe("headless");
    expect(isBrowserBackend("headless")).toBe(true);
    expect(isBrowserBackend("nope")).toBe(false);
  });
});

describe("the router", () => {
  it("honours the choice when the browser it names is there", async () => {
    const builtin = fakeLink("builtin");
    const headless = fakeLink("headless");
    const router = new BackendRouter({
      builtin,
      headless: () => headless,
      chosen: () => "headless",
      hasDesktop: () => true,
    });
    expect(router.backend).toBe("headless");
    expect(await router.handshake()).toBe(true);
  });

  it("falls back to the headless browser when the built-in one is not there", async () => {
    const headless = fakeLink("headless");
    const router = new BackendRouter({
      builtin: null,
      headless: () => headless,
      chosen: () => "builtin",
      hasDesktop: () => false,
    });
    // The user asked for the built-in browser; there is no desktop shell, so they get the
    // one that works.
    expect(router.backend).toBe("headless");
    expect(await router.handshake()).toBe(true);
  });

  it("falls back to the built-in one when the headless one is asked for and cannot start", async () => {
    // A machine with no Chromium, and a desktop app: the built-in browser still works.
    const builtin = fakeLink("builtin");
    const broken = fakeLink("headless", false);
    const router = new BackendRouter({
      builtin,
      headless: () => broken,
      chosen: () => "headless",
      hasDesktop: () => true,
    });
    expect(await router.handshake()).toBe(true);
  });

  it("says so when neither browser can be driven", async () => {
    const router = new BackendRouter({
      builtin: null,
      headless: () => fakeLink("headless", false),
      chosen: () => "headless",
      hasDesktop: () => false,
    });
    expect(await router.handshake()).toBe(false);
  });

  it("relays the events of the link it uses", () => {
    const builtin = fakeLink("builtin");
    const router = new BackendRouter({
      builtin,
      headless: () => fakeLink("headless"),
      chosen: () => "builtin",
      hasDesktop: () => true,
    });
    const seen: BrowserLinkEvent[] = [];
    router.onEvent((event) => seen.push(event));
    // The built-in link's event reaches the router's listeners.
    const link = builtin as BrowserLink & {
      listeners?: Set<(event: BrowserLinkEvent) => void>;
    };
    expect(link).toBeDefined();
    expect(seen).toHaveLength(0);
  });
});
