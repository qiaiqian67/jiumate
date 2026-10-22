/**
 * The browser service: the implementation of core's `BrowserPort` the tools talk to. It is
 * exercised against a fake far side, so every case here is about what the service asks the
 * browser to do and what it makes of the answer.
 */
import { describe, expect, it, vi } from "vitest";
import type { BrowserStatus } from "@prismshadow/jiumate-core/interfaces";
import { BrowserService, originOf } from "../../src/browser/service.js";
import type { ActionTiming } from "./../../src/browser/actions.js";
import { TabRegistry, UnknownTabError } from "../../src/browser/tabs.js";
import { FakeLink, evaluated, expressionOf, tab } from "./fake-link.js";

/** A service over a fake far side, with the waiting taken out of it. */
function service(
  link: FakeLink,
  opts: { timing?: Partial<ActionTiming>; onChange?: (state: BrowserStatus) => void } = {},
): BrowserService {
  return new BrowserService({
    link,
    sleep: async () => undefined,
    now: () => 1_700_000_000_000,
    ...(opts.timing !== undefined ? { timing: opts.timing } : {}),
    ...(opts.onChange !== undefined ? { onChange: opts.onChange } : {}),
  });
}

/** The timing that keeps the tests quick: the waits are not what is under test. */
const FAST = {
  settleMs: 0,
  reloadWaitMs: 0,
  loadWaitMs: 0,
  popupClaimMs: 0,
  clickGapMs: 0,
  helperTimeoutMs: 1000,
  scanTimeoutMs: 1000,
  screenshotTimeoutMs: 1000,
};

describe("originOf", () => {
  it("gives the origin of a web address", () => {
    expect(originOf("https://example.test/a/b?c=1")).toBe("https://example.test");
  });

  it("gives nothing for an address with no origin to speak of", () => {
    expect(originOf("about:blank")).toBeNull();
    expect(originOf("not a url")).toBeNull();
  });
});

describe("TabRegistry", () => {
  it("reflects the tabs the far side reports, and forgets the ones that went", () => {
    const registry = new TabRegistry();
    registry.replace([tab(1), tab(2)]);
    expect(registry.ids()).toEqual([1, 2]);
    registry.remove(1);
    expect(registry.ids()).toEqual([2]);
  });

  it("makes the tab an action names the active one, and falls back to the newest", () => {
    const registry = new TabRegistry();
    registry.replace([tab(1), tab(2)]);
    registry.activate(1);
    expect(registry.active()).toBe(1);
    registry.remove(1);
    expect(registry.active()).toBeNull();
    expect(registry.current()?.id).toBe(2);
  });

  it("refuses a tab it does not have", () => {
    const registry = new TabRegistry();
    expect(() => registry.activate(9)).toThrow(UnknownTabError);
  });

  it("keeps a crashed tab, marked, rather than dropping it", () => {
    const registry = new TabRegistry();
    registry.replace([tab(1)]);
    registry.markCrashed(1, "oom");
    expect(registry.get(1)?.crashed).toBe("oom");
  });

  it("gives the first claim of an open request the tab, and tells a second one it is a duplicate", () => {
    const registry = new TabRegistry();
    const request = registry.requestOpen("https://example.test/", { activate: true });
    expect(registry.claim(5, request.requestId)).toBe("claimed");
    expect(registry.claim(6, request.requestId)).toBe("duplicate");
    expect(registry.claim(7, "no-such-request")).toBe("unknown");
  });
});

describe("BrowserService", () => {
  it("reports the backend and the tabs it can see", async () => {
    const link = new FakeLink();
    link.show(tab(1));
    const status = await service(link).status();
    expect(status.available).toBe(true);
    expect(status.backend).toBe("builtin");
    expect(status.tabs.map((t) => t.id)).toEqual([1]);
  });

  it("refuses an action on a tab that is not open, and says what to do", async () => {
    const link = new FakeLink();
    await expect(service(link).scan()).rejects.toThrow(/No tab is open/);
  });

  it("reads a page by running the scan script in it", async () => {
    const link = new FakeLink();
    link.show(tab(1));
    let expression = "";
    link.cdp = (_tabId, method, params) => {
      if (method !== "Runtime.evaluate") return {};
      expression = expressionOf(params);
      return evaluated({ content: "<main>Hello</main>", truncated: false });
    };
    const result = await service(link, { timing: FAST }).scan();
    expect(result.content).toBe("<main>Hello</main>");
    expect(expression).toContain("optHTML");
  });

  it("runs a script and hands back what it returned", async () => {
    const link = new FakeLink();
    link.show(tab(1));
    link.cdp = (_tabId, method, params) => {
      if (method !== "Runtime.evaluate") return {};
      const expression = expressionOf(params);
      // The monitor's begin and end scripts are not the one under test.
      if (expression.includes("startStrMonitor")) return evaluated(true);
      if (expression.includes("stopStrMonitor")) return evaluated({ transients: [], changed: 0 });
      return evaluated(JSON.stringify({ ok: true, data: { title: "Example" } }));
    };
    const result = await service(link, { timing: FAST }).act({
      action: "exec",
      script: "return document.title",
    });
    expect(result.status).toBe("success");
    expect(result.value).toEqual({ title: "Example" });
  });

  it("reports a page that navigated under the script as a reload, not a failure", async () => {
    const link = new FakeLink();
    link.show(tab(1));
    link.cdp = (_tabId, method, params) => {
      if (method !== "Runtime.evaluate") return {};
      const expression = expressionOf(params);
      if (expression.includes("startStrMonitor")) return evaluated(true);
      if (expression.includes("stopStrMonitor")) return evaluated({ transients: [] });
      throw new Error("Execution context was destroyed.");
    };
    const result = await service(link, { timing: FAST }).act({
      action: "exec",
      script: "return document.title",
    });
    expect(result.reloaded).toBe(true);
    expect(result.status).toBe("success");
  });

  it("a click moves the mouse, presses and releases, at the element's centre", async () => {
    const link = new FakeLink();
    link.show(tab(1));
    const events: string[] = [];
    link.cdp = (tabId, method, params) => {
      if (method === "Runtime.evaluate") {
        const expression = expressionOf(params);
        if (expression.includes("startStrMonitor")) return evaluated(true);
        if (expression.includes("stopStrMonitor")) return evaluated({ transients: [], changed: 0 });
        return evaluated({ x: 120, y: 48, tag: "button", text: "Buy" });
      }
      if (method === "Input.dispatchMouseEvent") {
        events.push(`${String(params?.type)}@${String(params?.x)},${String(params?.y)}`);
        return {};
      }
      return {};
    };
    const result = await service(link, { timing: FAST }).act({
      action: "click",
      selector: "#buy",
    });
    expect(result.clicked).toEqual({ x: 120, y: 48, tag: "button", text: "Buy" });
    expect(events).toEqual(["mouseMoved@120,48", "mousePressed@120,48", "mouseReleased@120,48"]);
  });

  it("typing inserts the text and tells the page about it", async () => {
    const link = new FakeLink();
    link.show(tab(1));
    let inserted: string | undefined;
    link.cdp = (_tabId, method, params) => {
      if (method === "Input.insertText") inserted = params?.text as string;
      if (method === "Runtime.evaluate") {
        const expression = expressionOf(params);
        if (expression.includes("startStrMonitor")) return evaluated(true);
        if (expression.includes("stopStrMonitor")) return evaluated({ transients: [], changed: 0 });
        return evaluated(true);
      }
      return {};
    };
    await service(link, { timing: FAST }).act({ action: "type", text: "hello" });
    expect(inserted).toBe("hello");
  });

  it("the exec guard fails a request that leaves the page's origin and lets the page's own through", async () => {
    const link = new FakeLink();
    link.show(tab(1, { url: "https://shop.test/cart" }));
    link.pausedRequests = [
      { requestId: "same", url: "https://shop.test/api/cart" },
      { requestId: "other", url: "https://elsewhere.test/collect" },
    ];
    const continued: string[] = [];
    const failed: string[] = [];
    link.cdp = (_tabId, method, params) => {
      if (method === "Fetch.continueRequest") {
        continued.push(String(params?.requestId));
        return {};
      }
      if (method === "Fetch.failRequest") {
        failed.push(String(params?.requestId));
        return {};
      }
      if (method === "Runtime.evaluate") {
        const expression = expressionOf(params);
        if (expression.includes("startStrMonitor")) return evaluated(true);
        if (expression.includes("stopStrMonitor")) return evaluated({ transients: [], changed: 0 });
        return evaluated(JSON.stringify({ ok: true, data: 1 }));
      }
      return {};
    };
    await service(link, { timing: FAST }).act({ action: "exec", script: "return 1" });
    await vi.waitFor(() => {
      expect(continued).toContain("same");
      expect(failed).toContain("other");
    });
  });

  it("the guard and the dialog watcher each keep the events they asked for", async () => {
    const link = new FakeLink();
    link.show(tab(1));
    link.cdp = (_tabId, method, params) => {
      if (method === "Runtime.evaluate") {
        const expression = expressionOf(params);
        if (expression.includes("startStrMonitor")) return evaluated(true);
        if (expression.includes("stopStrMonitor")) return evaluated({ transients: [], changed: 0 });
        return evaluated(JSON.stringify({ ok: true, data: 1 }));
      }
      return {};
    };
    await service(link, { timing: FAST }).act({ action: "exec", script: "return 1" });
    // The guard asks for the paused request, the dialog watcher for the dialog: neither takes
    // the other's away, and each gives its own back when it is done.
    expect(link.relayLog.some((entry) => entry.events.includes("Fetch.requestPaused"))).toBe(true);
    expect(
      link.relayLog.some((entry) => entry.events.includes("Page.javascriptDialogOpening")),
    ).toBe(true);
    expect(
      link.relayLog.some((entry) => entry.unrelayEvents.includes("Page.javascriptDialogOpening")),
    ).toBe(true);
    expect(link.relayLog.some((entry) => entry.unrelayEvents.includes("Fetch.requestPaused"))).toBe(
      true,
    );
  });

  it("the exec guard is turned off again after the script, so the page is not left intercepted", async () => {
    const link = new FakeLink();
    link.show(tab(1));
    const methods: string[] = [];
    link.cdp = (_tabId, method, params) => {
      methods.push(method);
      if (method === "Runtime.evaluate") {
        const expression = expressionOf(params);
        if (expression.includes("startStrMonitor")) return evaluated(true);
        if (expression.includes("stopStrMonitor")) return evaluated({ transients: [], changed: 0 });
        return evaluated(JSON.stringify({ ok: true, data: 1 }));
      }
      return {};
    };
    await service(link, { timing: FAST }).act({ action: "exec", script: "return 1" });
    expect(methods).toContain("Fetch.enable");
    expect(methods).toContain("Fetch.disable");
  });

  it("refuses to run a script when the browser cannot intercept requests at all", async () => {
    const link = new FakeLink();
    link.show(tab(1));
    link.cdp = (_tabId, method) => {
      if (method === "Fetch.enable") throw new Error("Fetch domain is not supported.");
      return {};
    };
    await expect(
      service(link, { timing: FAST }).act({ action: "exec", script: "return 1" }),
    ).rejects.toThrow(/cannot block cross-origin requests/);
  });

  it("a screenshot comes back as the bytes the browser sent", async () => {
    const link = new FakeLink();
    link.show(tab(1));
    link.cdp = (_tabId, method) => (method === "Page.captureScreenshot" ? { data: "AAAB" } : {});
    const shot = await service(link, { timing: FAST }).screenshot();
    expect(shot).toEqual({ mime: "image/png", data: "AAAB" });
  });

  it("opening a URL asks the far side for a tab, and closing takes it away again", async () => {
    const link = new FakeLink();
    const svc = service(link, { timing: FAST });
    await svc.open("https://example.test/");
    expect(link.tabs.size).toBe(1);
    const id = [...link.tabs.keys()][0]!;
    await svc.close(id);
    expect(link.tabs.size).toBe(0);
  });
});

describe("the open requests a panel has to answer", () => {
  it("records a request the far side cannot answer itself, and names it in the status", async () => {
    // The far side cannot create tabs (the Web App's `<webview>` does), so the request waits
    // for a panel to make one. Without it in the status, no panel would ever learn there is
    // something to open.
    const link = new FakeLink();
    link.capabilities.createsTabs = false;
    const svc = service(link, { timing: FAST });
    const status = await svc.open("https://example.test/");
    expect(status.openRequests).toHaveLength(1);
    expect(status.openRequests?.[0]?.url).toBe("https://example.test/");
    expect(status.openRequests?.[0]?.requestId).toBeTruthy();
  });

  it("says nothing about requests when there are none", async () => {
    // An empty array on every poll would make every panel re-read for nothing.
    const link = new FakeLink();
    const status = await service(link, { timing: FAST }).status();
    expect(status.openRequests).toBeUndefined();
  });

  it("drops a request once a panel has claimed it", async () => {
    const link = new FakeLink();
    link.capabilities.createsTabs = false;
    const svc = service(link, { timing: FAST });
    const status = await svc.open("https://example.test/");
    const requestId = status.openRequests![0]!.requestId;
    expect(svc.claim(42, requestId)).toBe("claimed");
    const after = await svc.status();
    expect(after.openRequests).toBeUndefined();
  });

  it("tells a second window that it made a duplicate", async () => {
    // Two windows may both answer the same request. The first one wins, and the second is
    // told to remove the element it made: a tab the server does not know about is a page the
    // user cannot get back to.
    const link = new FakeLink();
    link.capabilities.createsTabs = false;
    const svc = service(link, { timing: FAST });
    const status = await svc.open("https://example.test/");
    const requestId = status.openRequests![0]!.requestId;
    expect(svc.claim(42, requestId)).toBe("claimed");
    expect(svc.claim(43, requestId)).toBe("duplicate");
    expect(svc.claim(44, "never-asked-for")).toBe("unknown");
  });

  it("a popup in a page becomes a request the panel can answer", async () => {
    const link = new FakeLink();
    link.show(tab(1));
    const svc = service(link, { timing: FAST });
    // The far side denies the popup and asks for a tab instead.
    link.event({
      kind: "open-request",
      url: "https://popup.test/",
      openerTabId: 1,
    });
    await vi.waitFor(() => {
      expect(link.commands.some((c) => c.op === "open-tab")).toBe(true);
    });
    const status = await svc.status();
    expect(status.openRequests?.some((r) => r.url === "https://popup.test/")).toBe(true);
  });
});

describe("a far side that has not said hello yet", () => {
  it("greets it before the first action, and the browser becomes available", async () => {
    // The service is built before the shell's port exists, so a link that is never greeted
    // stays "unconnected" for the life of the process — and the browser reports itself
    // unavailable forever. This is the bug that hid behind "not_desktop".
    const link = new FakeLink();
    link.connected = false;
    const svc = service(link, { timing: FAST });
    // The far side comes up after the service was made.
    link.connected = true;
    const status = await svc.status();
    expect(status.available).toBe(true);
    expect(status.reason).toBeUndefined();
  });

  it("says it is unavailable when the far side never answers", async () => {
    const link = new FakeLink();
    link.connected = false;
    const svc = service(link, { timing: FAST });
    const status = await svc.status();
    expect(status.available).toBe(false);
    expect(status.reason).toBe("not_desktop");
  });
});

describe("the push the panel listens to", () => {
  it("says so the moment a tab appears, so the strip does not wait for a poll", async () => {
    const link = new FakeLink();
    const seen: BrowserStatus[] = [];
    const svc = service(link, { timing: FAST, onChange: (state) => seen.push(state) });
    link.show(tab(1));
    await vi.waitFor(() => {
      expect(seen.length).toBeGreaterThan(0);
    });
    expect(seen[seen.length - 1]?.tabs.map((t) => t.id)).toContain(1);
  });

  it("says so when a tab goes away", async () => {
    const link = new FakeLink();
    const seen: BrowserStatus[] = [];
    const svc = service(link, { timing: FAST, onChange: (state) => seen.push(state) });
    link.show(tab(1));
    await vi.waitFor(() => {
      expect(seen.length).toBeGreaterThan(0);
    });
    link.close(1);
    await vi.waitFor(() => {
      expect(seen[seen.length - 1]?.tabs).toHaveLength(0);
    });
  });

  it("says so when a page is asked for that no window has opened", async () => {
    // The window that shows the browser has to learn there is something to open; without
    // this push the request would sit unnoticed until the next poll.
    const link = new FakeLink();
    link.capabilities.createsTabs = false;
    const seen: BrowserStatus[] = [];
    const svc = service(link, { timing: FAST, onChange: (state) => seen.push(state) });
    await svc.open("https://example.test/");
    await vi.waitFor(() => {
      expect(seen.some((s) => s.openRequests?.length === 1)).toBe(true);
    });
  });

  it("says so when a window has claimed the request, so no other window tries", async () => {
    const link = new FakeLink();
    link.capabilities.createsTabs = false;
    const seen: BrowserStatus[] = [];
    const svc = service(link, { timing: FAST, onChange: (state) => seen.push(state) });
    const status = await svc.open("https://example.test/");
    const requestId = status.openRequests![0]!.requestId;
    svc.claim(42, requestId);
    await vi.waitFor(() => {
      expect(seen[seen.length - 1]?.openRequests).toBeUndefined();
    });
  });

  it("keeps going when the push itself fails", async () => {
    // A broken channel costs the panel a delay, not the browser its work.
    const link = new FakeLink();
    const svc = service(link, {
      timing: FAST,
      onChange: () => {
        throw new Error("the channel is gone");
      },
    });
    link.show(tab(1));
    await expect(svc.status()).resolves.toBeTruthy();
  });
});
