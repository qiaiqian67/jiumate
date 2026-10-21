/**
 * The rules the built-in browser's shell half applies. Pure and Electron-free, so each one is
 * unit-tested here rather than under a running app; builtin-browser.ts beside it is the
 * Electron-facing code that applies them.
 */

/** The storage partition the guests live in, so their sign-ins persist between runs. */
export const BUILTIN_BROWSER_PARTITION = "persist:jiumate-browser";

/** The version of the browser protocol this shell speaks; `hello` reports it. */
export const BUILTIN_BROWSER_PROTOCOL_VERSION = 1;

/** How often the guests' load is measured while any of them exists. */
export const METRICS_INTERVAL_MS = 10_000;

/** The protocols a guest may be pointed at. Anything else never reaches the network. */
const OPENABLE_PROTOCOLS = new Set(["http:", "https:"]);

/** Whether a URL may be opened in a guest at all. */
export function isOpenableUrl(url: string): boolean {
  try {
    return OPENABLE_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

/**
 * The start pages a `<webview>` may be created with. A guest created for anything else — a
 * page that named a file:// or data: URL — is refused before it can load it.
 */
const GUEST_START_URLS = new Set(["about:blank", ""]);

/**
 * Whether a `<webview>` the page asked for may attach. The partition is not the caller's to
 * choose: only this app's own browser partition, and a web or blank start page.
 */
export function mayAttachGuest(params: { partition?: string; src?: string }): boolean {
  if (params.partition !== BUILTIN_BROWSER_PARTITION) return false;
  const src = params.src ?? "";
  return src === "" || src === "about:blank" || isOpenableUrl(src);
}

/**
 * Whether a guest may navigate there. Same rule as a start page: web addresses only, so a
 * page cannot walk a guest onto `file://` and read the user's disk.
 */
export function mayNavigate(url: string): boolean {
  return isOpenableUrl(url);
}

/** The permissions a page is granted, and the ones it never is. */
const GRANTED = new Set(["clipboard-sanitized-write", "fullscreen", "pointer-lock"]);

export function isGrantedPermission(permission: string): boolean {
  return GRANTED.has(permission);
}

/**
 * The user agent the guests see. Chromium's own token is what sites feature-detect a
 * browser with; it is stripped so the guests are not refused the APIs they support, and so a
 * site does not see a version number Electron has nothing to do with.
 */
export function plainChromeUserAgent(userAgent: string): string {
  return userAgent
    .replace(/\s*Electron\/[\d.]+/gi, "")
    .replace(/\s*JiuMate\/[\d.]+/gi, "")
    .replace(/\s*Hyphenate/gi, "")
    .trim();
}

/**
 * Forces a guest's preferences into the hardened shape. A guest keeps Node integration off and
 * no preload, whatever the page asked for: the guests load pages the Agent navigates to, and
 * none of them is the app's own UI.
 */
export function hardenGuestPreferences(
  preferences: Record<string, unknown>,
  partition: string,
): void {
  preferences["nodeIntegration"] = false;
  preferences["nodeIntegrationInWorker"] = false;
  preferences["nodeIntegrationInSubFrames"] = false;
  preferences["contextIsolation"] = true;
  preferences["sandbox"] = true;
  preferences["webSecurity"] = true;
  preferences["allowRunningInsecureContent"] = false;
  preferences["experimentalFeatures"] = false;
  preferences["spellcheck"] = false;
  preferences["partition"] = partition;
}

/**
 * Whether a CDP method types into the page. One that does needs the window's keyboard focus
 * first, or the keystrokes land in the app's own UI — the composer, the address bar.
 */
export function typesIntoGuest(method: string): boolean {
  return method.startsWith("Input.insertText") || method.startsWith("Input.dispatchKeyEvent");
}

/**
 * The script the embedder runs to focus a guest, by focusing its `<webview>` element. Returns
 * whether the focus landed, which is what the shell answers `keyboard_focus_failed` on.
 */
export function focusGuestScript(guestId: number): string {
  return `(() => {
    const el = document.querySelector('webview[data-guest-id="${guestId}"]');
    if (!el) return false;
    el.focus();
    return true;
  })()`;
}

/**
 * Picks the icon a tab shows: Chromium announces several sizes and types per document, and the
 * largest PNG is the one a tab strip has room for.
 */
export function pickFavicon(favicons: { url: string }[]): string | undefined {
  const pngs = favicons.filter((icon) => /\.png(\?|$)/i.test(icon.url));
  return (pngs.length > 0 ? pngs : favicons)[0]?.url;
}

/** The names a `clear-data` command may use, mapped to Electron's own storage names. */
const STORAGE_NAMES = {
  cookies: "cookies",
  storage: "localstorage",
} as const satisfies Record<string, "cookies" | "localstorage">;

/** What clearing `storages` means, or null when the names name something this shell does not clear. */
export function clearDataPlan(storages: readonly string[]): {
  storageData: ("cookies" | "localstorage")[];
  cache: boolean;
} | null {
  const unknown = storages.find((name) => !(name in STORAGE_NAMES) && name !== "cache");
  if (unknown !== undefined) return null;
  const storageData = storages
    .filter((name) => name !== "cache")
    .map((name) => STORAGE_NAMES[name as keyof typeof STORAGE_NAMES]);
  return { storageData, cache: storages.includes("cache") };
}

/** What one page's load is, from its processes' numbers. */
export interface TabLoad {
  tabId: number;
  memoryKB: number;
  cpuPercent: number;
}

/**
 * Rolls each tab's processes up into one figure. A process shared by two tabs (a cross-site
 * iframe both pages embed) is counted once, so the total is not the sum of twice the same
 * memory — the number the user is shown has to add up.
 */
export function tabLoads(
  processes: { pid: number; memoryKB: number; cpuPercent: number }[],
  tabs: { tabId: number; pids: number[] }[],
): { tabs: TabLoad[]; totalKB: number } {
  const byPid = new Map(processes.map((p) => [p.pid, p]));
  const counted = new Set<number>();
  const loads: TabLoad[] = [];
  for (const tab of tabs) {
    let memoryKB = 0;
    let cpuPercent = 0;
    for (const pid of tab.pids) {
      const proc = byPid.get(pid);
      if (proc === undefined) continue;
      if (!counted.has(pid)) {
        counted.add(pid);
        memoryKB += proc.memoryKB;
      }
      cpuPercent += proc.cpuPercent;
    }
    loads.push({ tabId: tab.tabId, memoryKB, cpuPercent });
  }
  return {
    tabs: loads,
    totalKB: [...counted].reduce((sum, pid) => sum + (byPid.get(pid)?.memoryKB ?? 0), 0),
  };
}

/** One entry of a guest's context menu. */
/** A command frame from the server, once its `type` has been checked. */
export type ParsedBrowserCommand =
  { id: string; command: Record<string, unknown> } | { id: string; error: string };

/**
 * Whether a frame from the server is a browser command at all. The main process's message
 * channel carries the updater's and the exporter's frames too, so this is what keeps each
 * relay to its own.
 */
export function isBrowserCommandMessage(data: unknown): data is {
  type: "desktop-browser-command";
  id: string;
  command: unknown;
} {
  if (typeof data !== "object" || data === null) return false;
  const m = data as { type?: unknown; id?: unknown };
  return m.type === "desktop-browser-command" && typeof m.id === "string";
}

/**
 * One browser command off the wire, or the error it carries. The command's own shape is the
 * server's contract; this only checks that the envelope is whole and the op is one of ours,
 * so a frame from a future server fails with a message rather than a cast.
 */
const OPS = new Set(["hello", "tabs", "cdp", "open-tab", "close-tab", "activate-tab"]);

export function parseBrowserCommand(data: unknown): ParsedBrowserCommand | null {
  if (!isBrowserCommandMessage(data)) return null;
  const command = data.command as { op?: unknown; tabId?: unknown } | null;
  if (typeof command !== "object" || command === null) return { id: data.id, error: "bad_command" };
  const op = typeof command.op === "string" ? command.op : "";
  if (!OPS.has(op)) return { id: data.id, error: "unknown_op" };
  if (
    op === "cdp" &&
    (typeof command.tabId !== "number" ||
      typeof (command as { method?: unknown }).method !== "string")
  ) {
    return { id: data.id, error: "bad_command" };
  }
  if ((op === "close-tab" || op === "activate-tab") && typeof command.tabId !== "number") {
    return { id: data.id, error: "bad_command" };
  }
  if (op === "open-tab" && typeof (command as { url?: unknown }).url !== "string") {
    return { id: data.id, error: "bad_command" };
  }
  return { id: data.id, command: command as Record<string, unknown> };
}

/**
 * The private (not shared) memory of a process, in KB. Chromium's own `workingSetSize` is the
 * whole resident set, which counts pages it shares with other processes; on Windows Electron
 * reports the private share separately, and on Linux `/proc` is the authority. Shared pages
 * counted once per page would otherwise report two tabs using twice the memory they use.
 */
export function privateMemoryKB(
  platform: NodeJS.Platform,
  memory: { privateBytes?: number; workingSetSize: number },
  procStatusText: string | null,
): number {
  if (platform === "linux" && procStatusText !== null) {
    const match = procStatusText.match(/VmRSS:\s+(\d+)\s+kB/);
    if (match !== null) return Number(match[1]);
  }
  const bytes = platform === "win32" ? memory.privateBytes : memory.workingSetSize;
  return Math.round((bytes ?? memory.workingSetSize) / 1024);
}
