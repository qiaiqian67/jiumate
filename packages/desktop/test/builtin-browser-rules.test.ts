/**
 * The rules the built-in browser's shell applies. Pure and Electron-free, so each one is
 * unit-tested here rather than under a running app; builtin-browser.ts beside it is the
 * Electron-facing code that applies them, and builtin-browser-menu.ts the guest's context menu.
 */
import { describe, expect, it } from "vitest";
import {
  BUILTIN_BROWSER_PARTITION,
  clearDataPlan,
  focusGuestScript,
  hardenGuestPreferences,
  isBrowserCommandMessage,
  isGrantedPermission,
  isOpenableUrl,
  mayAttachGuest,
  mayNavigate,
  parseBrowserCommand,
  pickFavicon,
  plainChromeUserAgent,
  privateMemoryKB,
  tabLoads,
  typesIntoGuest,
} from "../src/builtin-browser-rules.js";
import { guestContextMenu } from "../src/builtin-browser-menu.js";

describe("isOpenableUrl", () => {
  it("takes web addresses and nothing else", () => {
    expect(isOpenableUrl("https://example.test/a")).toBe(true);
    expect(isOpenableUrl("http://localhost:3000/")).toBe(true);
    // A guest that could load these would read the user's disk or run page it was handed.
    expect(isOpenableUrl("file:///etc/passwd")).toBe(false);
    expect(isOpenableUrl("javascript:alert(1)")).toBe(false);
    expect(isOpenableUrl("data:text/html,<script>")).toBe(false);
    expect(isOpenableUrl("not a url")).toBe(false);
  });
});

describe("mayAttachGuest", () => {
  it("takes only this app's own browser partition", () => {
    // Another partition is the app's signed-in session: a <webview> there would be a page
    // holding the user's cookies.
    expect(mayAttachGuest({ partition: BUILTIN_BROWSER_PARTITION })).toBe(true);
    expect(mayAttachGuest({ partition: "persist:other" })).toBe(false);
    expect(mayAttachGuest({})).toBe(false);
  });

  it("takes a blank or web start page only", () => {
    expect(mayAttachGuest({ partition: BUILTIN_BROWSER_PARTITION, src: "" })).toBe(true);
    expect(mayAttachGuest({ partition: BUILTIN_BROWSER_PARTITION, src: "about:blank" })).toBe(true);
    expect(
      mayAttachGuest({ partition: BUILTIN_BROWSER_PARTITION, src: "https://example.test/" }),
    ).toBe(true);
    expect(mayAttachGuest({ partition: BUILTIN_BROWSER_PARTITION, src: "file:///etc/passwd" })).toBe(
      false,
    );
  });

  it("does not let a guest walk onto a local file later either", () => {
    expect(mayNavigate("https://example.test/")).toBe(true);
    expect(mayNavigate("file:///C:/Users/me/.ssh/id_rsa")).toBe(false);
  });
});

describe("hardenGuestPreferences", () => {
  it("keeps the guest a plain sandboxed page, whatever the page asked for", () => {
    const prefs: Record<string, unknown> = {
      nodeIntegration: true,
      preload: "/tmp/evil.js",
      webSecurity: false,
      allowRunningInsecureContent: true,
      partition: "persist:something-else",
    };
    hardenGuestPreferences(prefs, BUILTIN_BROWSER_PARTITION);
    expect(prefs).toMatchObject({
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      partition: BUILTIN_BROWSER_PARTITION,
    });
  });
});

describe("isGrantedPermission", () => {
  it("grants the few a browser page is asked for and refuses the rest", () => {
    expect(isGrantedPermission("clipboard-sanitized-write")).toBe(true);
    // The ones it must refuse are the ones that would give a page the user's machine.
    expect(isGrantedPermission("media")).toBe(false);
    expect(isGrantedPermission("geolocation")).toBe(false);
    expect(isGrantedPermission("notifications")).toBe(false);
  });
});

describe("plainChromeUserAgent", () => {
  it("drops the Electron and app tokens so sites see the browser they would serve", () => {
    const ua = plainChromeUserAgent(
      "Mozilla/5.0 Chrome/130.0.0.0 Electron/33.0.0 Safari/537.36 JiuMate/0.3.0",
    );
    expect(ua).toBe("Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36");
    expect(ua).not.toContain("Electron");
  });
});

describe("typesIntoGuest", () => {
  it("names the CDP methods that need the window's keyboard focus first", () => {
    // Sent unfocused, these land in the app's own UI: the composer, the address bar.
    expect(typesIntoGuest("Input.insertText")).toBe(true);
    expect(typesIntoGuest("Input.dispatchKeyEvent")).toBe(true);
    expect(typesIntoGuest("Input.dispatchMouseEvent")).toBe(false);
    expect(typesIntoGuest("Runtime.evaluate")).toBe(false);
  });
});

describe("focusGuestScript", () => {
  it("focuses the guest's own element and says whether it found it", () => {
    const script = focusGuestScript(7);
    expect(script).toContain('data-guest-id="7"');
    expect(script).toContain("focus()");
  });
});

describe("pickFavicon", () => {
  it("prefers a PNG, which is what a tab strip has room for", () => {
    expect(
      pickFavicon([{ url: "https://a.test/i.svg" }, { url: "https://a.test/i.png" }]),
    ).toBe("https://a.test/i.png");
  });

  it("falls back to whatever the document announced", () => {
    expect(pickFavicon([{ url: "https://a.test/i.svg" }])).toBe("https://a.test/i.svg");
    expect(pickFavicon([])).toBeUndefined();
  });
});

describe("clearDataPlan", () => {
  it("maps the names it knows and refuses the rest", () => {
    expect(clearDataPlan(["cookies", "storage"])).toEqual({
      storageData: ["cookies", "localstorage"],
      cache: false,
    });
    expect(clearDataPlan(["cache"])).toEqual({ storageData: [], cache: true });
    expect(clearDataPlan(["everything"])).toBeNull();
  });
});

describe("tabLoads", () => {
  it("counts a process two tabs share once, so the total adds up", () => {
    // A cross-site iframe both pages embed is one process: reporting it twice would tell the
    // user their two tabs use twice the memory they do.
    const loads = tabLoads(
      [
        { pid: 1, memoryKB: 100, cpuPercent: 1 },
        { pid: 2, memoryKB: 50, cpuPercent: 2 },
      ],
      [
        { tabId: 1, pids: [1, 2] },
        { tabId: 2, pids: [1] },
      ],
    );
    expect(loads.totalKB).toBe(150);
    expect(loads.tabs.find((t) => t.tabId === 2)?.memoryKB).toBe(0);
    expect(loads.tabs.find((t) => t.tabId === 2)?.cpuPercent).toBe(1);
  });

  it("reports nothing for a tab whose processes are gone", () => {
    const loads = tabLoads([], [{ tabId: 1, pids: [9] }]);
    expect(loads.tabs[0]).toEqual({ tabId: 1, memoryKB: 0, cpuPercent: 0 });
    expect(loads.totalKB).toBe(0);
  });
});

describe("privateMemoryKB", () => {
  it("prefers what the platform reports privately", () => {
    // Windows' workingSetSize counts pages shared with other processes.
    expect(
      privateMemoryKB("win32", { privateBytes: 2048, workingSetSize: 8192 }, null),
    ).toBe(2);
    expect(privateMemoryKB("darwin", { workingSetSize: 4096 }, null)).toBe(4);
  });

  it("reads Linux's own account of the process", () => {
    expect(
      privateMemoryKB("linux", { workingSetSize: 1_000_000 }, "VmRSS:\t  3072 kB\nName:\tx"),
    ).toBe(3072);
  });
});

describe("the command envelope", () => {
  it("only claims frames that carry its own type", () => {
    // The port carries the updater's and the exporter's frames too.
    expect(isBrowserCommandMessage({ type: "desktop-browser-command", id: "a" })).toBe(true);
    expect(isBrowserCommandMessage({ type: "desktop-updater-command", action: "check" })).toBe(false);
    expect(isBrowserCommandMessage(null)).toBe(false);
  });

  it("reads one of ours and refuses an op it does not know", () => {
    expect(
      parseBrowserCommand({
        type: "desktop-browser-command",
        id: "a",
        command: { op: "tabs" },
      }),
    ).toEqual({ id: "a", command: { op: "tabs" } });
    expect(
      parseBrowserCommand({
        type: "desktop-browser-command",
        id: "a",
        command: { op: "import-cookies-from-my-disk" },
      }),
    ).toEqual({ id: "a", error: "unknown_op" });
  });

  it("refuses a command whose own arguments are missing", () => {
    for (const command of [
      { op: "cdp", method: "Runtime.evaluate" },
      { op: "cdp", tabId: 1 },
      { op: "close-tab" },
      { op: "open-tab" },
    ]) {
      expect(
        parseBrowserCommand({ type: "desktop-browser-command", id: "a", command }),
        JSON.stringify(command),
      ).toEqual({ id: "a", error: "bad_command" });
    }
  });
});

describe("guestContextMenu", () => {
  const base = {
    linkURL: "",
    srcURL: "",
    mediaType: "none",
    isEditable: false,
    selectionText: "",
    canGoBack: false,
    canGoForward: false,
  };

  it("disables what cannot act rather than hiding it, so the menu does not jump", () => {
    const items = guestContextMenu("en", base);
    const back = items.find((item) => item.action === "back");
    expect(back?.enabled).toBe(false);
    expect(items.some((item) => item.action === "reload")).toBe(true);
    // No link under the pointer, no link entries at all.
    expect(items.some((item) => item.action === "copy-link")).toBe(false);
  });

  it("offers the link entries and cuts only what can be cut", () => {
    const items = guestContextMenu("en", {
      ...base,
      linkURL: "https://a.test/x",
      isEditable: true,
      selectionText: "chosen",
    });
    expect(items.some((item) => item.action === "open-link")).toBe(true);
    expect(items.find((item) => item.action === "cut")?.enabled).toBe(true);
    expect(
      guestContextMenu("en", { ...base, isEditable: false, selectionText: "chosen" }).find(
        (item) => item.action === "cut",
      )?.enabled,
    ).toBe(false);
  });

  it("says the same in both languages the app ships", () => {
    const en = guestContextMenu("en-US", base);
    const zh = guestContextMenu("zh-CN", base);
    expect(en.find((item) => item.action === "reload")?.label).toBe("Reload");
    expect(zh.find((item) => item.action === "reload")?.label).toBe("重新加载");
  });
});