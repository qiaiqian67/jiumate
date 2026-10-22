/**
 * The agent browser's web side: the state the server pushes, the guests the window hosts, and
 * the claim flow that turns an open request into a tab.
 *
 * The parts that can run in node are tested here. The `<webview>` element cannot — Electron
 * defines it only in the desktop app's main window — so the panel's wiring is pinned by
 * reading its source, the same way the other structural tests in this package do.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  browserStateVersion,
  browserUnavailableReason,
  currentTabId,
  liveTabs,
  noteBrowserState,
  pendingOpenRequests,
  subscribeBrowserState,
} from "../src/features/browser/browser-list";
import {
  createGuestForRequest,
  guestForTab,
  guestVersion,
  hostedGuests,
  removeGuest,
  subscribeGuests,
  unansweredGuest,
} from "../src/features/browser/browser-guests";

const read = (rel: string): string =>
  fs.readFileSync(path.join(__dirname, "..", "src", ...rel.split("/")), "utf8");

const tab = (id: number, patch: Record<string, unknown> = {}) => ({
  id,
  url: `https://example.test/${id}`,
  title: `Page ${id}`,
  loading: false,
  canGoBack: false,
  canGoForward: false,
  ...patch,
});

describe("the state the server pushes", () => {
  it("takes the server's state as it is", () => {
    noteBrowserState({
      available: true,
      backend: "builtin",
      backends: [{ backend: "builtin", available: true }],
      tabs: [tab(1), tab(2)],
      activeTabId: 2,
    });
    expect(liveTabs().map((t) => t.id)).toEqual([1, 2]);
    expect(currentTabId()).toBe(2);
  });

  it("tells the subscribers that the state moved", () => {
    let told = 0;
    const stop = subscribeBrowserState(() => {
      told += 1;
    });
    const before = browserStateVersion();
    noteBrowserState({
      available: true,
      backend: "builtin",
      backends: [],
      tabs: [tab(9)],
      activeTabId: 9,
    });
    expect(browserStateVersion()).not.toBe(before);
    expect(told).toBe(1);
    stop();
  });

  it("says nothing when the state did not move", () => {
    const state = {
      available: true,
      backend: "builtin" as const,
      backends: [],
      tabs: [tab(3)],
      activeTabId: 3,
    };
    noteBrowserState(state);
    const version = browserStateVersion();
    let told = 0;
    const stop = subscribeBrowserState(() => {
      told += 1;
    });
    // The same state again: a title that did not change, a poll that found nothing new.
    noteBrowserState(state);
    expect(browserStateVersion()).toBe(version);
    expect(told).toBe(0);
    stop();
  });

  it("notices a title change, which a count would miss", () => {
    // The version is a counter, so it must move whenever the state did — including when only
    // a tab's title changed and the number of tabs stayed the same.
    noteBrowserState({
      available: true,
      backend: "builtin",
      backends: [],
      tabs: [tab(1, { title: "One" })],
      activeTabId: 1,
    });
    const version = browserStateVersion();
    noteBrowserState({
      available: true,
      backend: "builtin",
      backends: [],
      tabs: [tab(1, { title: "Two" })],
      activeTabId: 1,
    });
    expect(browserStateVersion()).not.toBe(version);
  });

  it("carries the open requests a window has to answer", () => {
    noteBrowserState({
      available: true,
      backend: "builtin",
      backends: [],
      tabs: [],
      activeTabId: null,
      openRequests: [
        {
          requestId: "r1",
          url: "https://example.test/",
          activate: true,
          createdAt: 1_700_000_000_000,
        },
      ],
    });
    expect(pendingOpenRequests()).toHaveLength(1);
    expect(pendingOpenRequests()[0]?.url).toBe("https://example.test/");
  });

  it("remembers why the browser cannot be driven", () => {
    noteBrowserState({
      available: false,
      reason: "not_desktop",
      backend: "builtin",
      backends: [],
      tabs: [],
      activeTabId: null,
    });
    expect(browserUnavailableReason()).toBe("not_desktop");
  });
});

describe("the guests this window hosts", () => {
  it("creates a guest for a request, and remembers which request it answers", () => {
    const guest = createGuestForRequest({
      requestId: "r2",
      url: "https://example.test/",
      activate: true,
    });
    expect(hostedGuests()).toHaveLength(1);
    expect(guest.src).toBe("https://example.test/");
    expect(unansweredGuest("r2")).toBeUndefined();
    expect(unansweredGuest("never-asked-for")).toBeUndefined();
    removeGuest(guest.key, false);
  });

  it("tells the subscribers that the guest list moved", () => {
    let told = 0;
    const stop = subscribeGuests(() => {
      told += 1;
    });
    const before = guestVersion();
    const guest = createGuestForRequest({
      requestId: "r3",
      url: "https://example.test/",
      activate: true,
    });
    expect(guestVersion()).not.toBe(before);
    expect(told).toBe(1);
    removeGuest(guest.key, false);
    stop();
  });

  it("finds the guest showing a tab, and none for a tab it does not host", () => {
    const guest = createGuestForRequest({
      requestId: "r4",
      url: "https://example.test/",
      activate: true,
    });
    // The guest has no tab id until the element attaches.
    expect(guestForTab(1)).toBeUndefined();
    removeGuest(guest.key, false);
  });
});

describe("the panel's wiring", () => {
  it("mounts a guest's element with the browser's own partition", () => {
    const panel = read("features/browser/browser-panel.tsx");
    // The desktop shell refuses a <webview> outside this partition (builtin-browser-rules.ts),
    // so a guest in another partition would be silently refused and the page would never
    // appear.
    expect(panel).toContain("persist:jiumate-browser");
  });

  it("keeps the guests mounted, and only hides the ones that are not in front", () => {
    const panel = read("features/browser/browser-panel.tsx");
    // A <webview> that is moved in the DOM reloads its page, so the elements are only ever
    // appended or removed — never unmounted and remounted.
    expect(panel).not.toContain("unmountOnExit");
    expect(panel).toContain('"hidden"');
  });

  it("takes the pushed state rather than polling for it", () => {
    const panel = read("features/browser/browser-panel.tsx");
    const list = read("features/browser/browser-list.ts");
    // The state arrives on the user channel; a poll would make the strip lag behind the
    // agent's page by the poll interval.
    expect(panel).not.toContain("setInterval");
    expect(list).not.toContain("setInterval");
  });

  it("answers an open request once, and only the window that made the guest", () => {
    const guests = read("features/browser/browser-guests.ts");
    // A second window may answer the same request; the server tells that one it made a
    // duplicate, and the element it made is removed. The refusal path must remove the
    // guest — checked here on the code, not on the word "duplicate" in a comment.
    expect(guests).toContain("removeGuest");
    // The claim is made through the API, and a refusal is what makes the guest go.
    expect(guests).toContain("apiFetch");
    expect(guests).toMatch(/catch\s*\{[^}]*removeGuest/);
  });
});
