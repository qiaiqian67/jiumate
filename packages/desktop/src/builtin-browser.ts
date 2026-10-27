/**
 * The built-in browser's shell half: it hosts the `<webview>` guests the Web App creates in the
 * main window, and relays for the embedded server what only the main process can do — raw CDP
 * through each guest's `webContents.debugger` (a command that types first gives its guest the
 * window's keyboard focus), and cookie and storage writes on the guests' partition session.
 * Mechanism only: the tab registry, the page scripts, and scan / exec / click / type are the
 * server platform's (packages/server/src/browser).
 *
 * Electron-facing and untested, like main.ts and tray.ts; the rules it applies are the pure
 * builtin-browser-rules.ts and builtin-browser-menu.ts beside it, which carry the tests.
 *
 * The wire is the server's contract (packages/server/src/browser/shell-link.ts), imported
 * type-only. Every command gets exactly one reply; tab changes, closes, crashes, popups and
 * the CDP events a `cdp` command asked for are pushed as events whenever a server is there to
 * hear them — a server that starts later asks for the tab list itself.
 *
 * Load is measured here because only the main process can see the guests' processes. What is
 * too much, and what to tell the user, is the server's call; so is which tabs may be throttled
 * while out of sight (`throttle`) — every guest runs unthrottled until it says, and a guest
 * playing media stays unthrottled even while it is in the list.
 */
import fs from "node:fs";
import { BrowserWindow, Menu, app, clipboard, session } from "electron";
import type { ContextMenuParams, MenuItemConstructorOptions, Session, WebContents } from "electron";
import type { BrowserCookie, BrowserTab } from "@jadelau/core/interfaces";
import type {
  BrowserCommandMessage,
  BrowserEventMessage,
  BrowserReplyMessage,
} from "@jadelau/server/browser";
import { guestContextMenu, runGuestMenuAction } from "./builtin-browser-menu.js";
import {
  BUILTIN_BROWSER_PARTITION,
  BUILTIN_BROWSER_PROTOCOL_VERSION,
  METRICS_INTERVAL_MS,
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
} from "./builtin-browser-rules.js";
import { urlForLog } from "./util.js";

export interface BuiltinBrowserShellOptions {
  /** Sends one frame to the embedded server; dropped while none is running. */
  post(message: unknown): void;
  /** The language of the guests' context menu: the Web App's, as the tray follows it. */
  locale(): string;
  log(line: string): void;
}

export interface BuiltinBrowserShell {
  /**
   * Lets this window's page host guests. The main window only: every other page is refused a
   * guest, even one that was given `webviewTag`.
   */
  host(win: BrowserWindow): void;
  /** Runs one frame from the server if it is a browser command; false when it is not one. */
  handle(message: unknown): boolean;
}

/** The CDP version the debugger attaches with (the only one Chromium serves). */
const CDP_VERSION = "1.3";
/** After a tab closes, how soon the load is measured again, so a warning it caused can clear. */
const METRICS_AFTER_CLOSE_MS = 1_500;

interface Guest {
  /** The guest's webContents id, kept because a destroyed webContents can no longer be asked. */
  id: number;
  wc: WebContents;
  favicon?: string;
  /** The CDP events relayed to the server, as the commands' `events` / `unrelayEvents` set them. */
  relayed: Set<string>;
  /** The server permits background throttling, provided no media is playing. */
  throttleAllowed: boolean;
  /** Electron reports starts/stops per player, including muted media and players in frames. */
  playingMedia: number;
  /** Why the page's renderer last went away; reported while `wc.isCrashed()` says it still is. */
  crashReason?: string;
}

/** The pages' processes: the guest's renderer and those of its cross-site frames (ads, embeds). */
function pagePids(wc: WebContents): number[] {
  const pids = new Set<number>();
  try {
    pids.add(wc.getOSProcessId());
    for (const frame of wc.mainFrame.framesInSubtree) pids.add(frame.osProcessId);
  } catch {
    // A page between renderers has no frames to ask.
  }
  return [...pids].filter((pid) => pid > 0);
}

/** Linux's account of a process's memory, where one is kept; null elsewhere or once it has exited. */
function procStatus(pid: number): string | null {
  if (process.platform !== "linux") return null;
  try {
    return fs.readFileSync(`/proc/${pid}/status`, "utf8");
  } catch {
    return null;
  }
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function createBuiltinBrowserShell(opts: BuiltinBrowserShellOptions): BuiltinBrowserShell {
  const guests = new Map<number, Guest>();
  const hosted = new WeakSet<BrowserWindow>();
  /** The pages of the hosted windows: the only embedders a guest may attach to. */
  const embedders = new WeakSet<WebContents>();
  const partitionSessions = new Map<string, Session>();
  let metricsTimer: NodeJS.Timeout | null = null;
  let metricsSoon: NodeJS.Timeout | null = null;

  // No page but a hosted window's may attach a guest, whatever its own preferences say. Any
  // other window's are built from options its opener can reach (a `webviewTag=yes` in
  // window.open's features), and a <webview> there would attach past every check below: in any
  // partition, the app's own signed-in session included.
  app.on("web-contents-created", (_event, wc) => {
    wc.on("will-attach-webview", (event) => {
      if (embedders.has(wc)) return;
      event.preventDefault();
      opts.log(`builtin browser: refused a <webview> in ${urlForLog(wc.getURL())}`);
    });
  });

  /**
   * The guests' session, set up once before the first guest is created: the user agent sites
   * see, and which permission prompts a page is granted. Downloads keep Electron's own save
   * dialog.
   */
  function browserSession(partition = BUILTIN_BROWSER_PARTITION): Session {
    const existing = partitionSessions.get(partition);
    if (existing !== undefined) return existing;
    const ses = session.fromPartition(partition);
    ses.setUserAgent(plainChromeUserAgent(ses.getUserAgent()));
    ses.setPermissionRequestHandler((_wc, permission, callback) =>
      callback(isGrantedPermission(permission)),
    );
    ses.setPermissionCheckHandler((_wc, permission) => isGrantedPermission(permission));
    partitionSessions.set(partition, ses);
    return ses;
  }

  function emit(event: BrowserEventMessage["event"]): void {
    opts.post({ type: "desktop-browser-event", event } satisfies BrowserEventMessage);
  }

  function reply(
    id: string,
    outcome: { ok: true; result: unknown } | { ok: false; error: string },
  ): void {
    opts.post({
      type: "desktop-browser-reply",
      id,
      ...outcome,
    } satisfies BrowserReplyMessage);
  }

  function tabOf(guest: Guest): BrowserTab {
    const { wc } = guest;
    const crashed = wc.isCrashed() ? (guest.crashReason ?? "crashed") : undefined;
    return {
      id: guest.id,
      url: wc.getURL(),
      title: wc.getTitle(),
      loading: wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      ...(guest.favicon !== undefined ? { favicon: guest.favicon } : {}),
      ...(crashed !== undefined ? { crashed } : {}),
    };
  }

  /**
   * Measures every live guest's load and sends it; with none left, one empty measurement clears
   * the last. It runs on a timer, where a throw would be an uncaught main-process error, so a
   * measurement that fails is logged and skipped.
   */
  function sendMetrics(): void {
    try {
      const live = [...guests.values()].filter((guest) => !guest.wc.isDestroyed());
      const tabs = live.map((guest) => ({ tabId: guest.id, pids: pagePids(guest.wc) }));
      const wanted = new Set(tabs.flatMap((tab) => tab.pids));
      const processes = app
        .getAppMetrics()
        .filter((metric) => wanted.has(metric.pid))
        .map((metric) => ({
          pid: metric.pid,
          memoryKB: privateMemoryKB(process.platform, metric.memory, procStatus(metric.pid)),
          cpuPercent: metric.cpu.percentCPUUsage,
        }));
      const loads = tabLoads(processes, tabs);
      emit({
        kind: "metrics",
        tabs: loads.tabs.map((load) => ({
          tabId: load.tabId,
          memoryKB: load.memoryKB,
          cpuPercent: load.cpuPercent,
        })),
        totalKB: loads.totalKB,
      });
    } catch (err) {
      opts.log(`builtin browser: the tabs' load could not be measured: ${messageOf(err)}`);
    }
  }

  /** Measures on a steady beat while there are guests, and stops with the last of them. */
  function followLoad(): void {
    if (guests.size > 0) {
      metricsTimer ??= setInterval(() => sendMetrics(), METRICS_INTERVAL_MS);
      return;
    }
    if (metricsTimer !== null) clearInterval(metricsTimer);
    metricsTimer = null;
  }

  /** Measures again shortly (coalesced): a closed tab's memory should leave the numbers soon. */
  function measureSoon(): void {
    if (metricsSoon !== null) return;
    metricsSoon = setTimeout(() => {
      metricsSoon = null;
      sendMetrics();
    }, METRICS_AFTER_CLOSE_MS);
  }

  function liveGuest(tabId: number): Guest {
    const guest = guests.get(tabId);
    if (guest === undefined || guest.wc.isDestroyed()) throw new Error("no_such_tab");
    return guest;
  }

  /**
   * A guest is only touched when its setting changes: Electron shows a hidden page again on
   * every call. Let Chromium apply throttling at its next visibility change. Forcing a
   * frozen/active lifecycle round trip to apply it immediately pauses media and can tear down a
   * stream, including a player still buffering before its first media-started-playing event.
   */
  function applyThrottling(guest: Guest): void {
    const { wc } = guest;
    const allowed = guest.throttleAllowed && guest.playingMedia === 0;
    if (wc.isDestroyed() || wc.getBackgroundThrottling() === allowed) return;
    wc.setBackgroundThrottling(allowed);
  }

  /** Registers a guest that passed `will-attach-webview` and wires what the server hears of it. */
  function adopt(wc: WebContents): void {
    const id = wc.id;
    if (guests.has(id)) return;
    const guest: Guest = { id, wc, relayed: new Set(), throttleAllowed: false, playingMedia: 0 };
    guests.set(id, guest);
    wc.on("media-started-playing", () => {
      guest.playingMedia += 1;
      applyThrottling(guest);
    });
    wc.on("media-paused", () => {
      guest.playingMedia = Math.max(0, guest.playingMedia - 1);
      applyThrottling(guest);
    });
    // The CDP events the server asked for, and only those: the debugger's session sees every
    // event of the domains enabled on it.
    wc.debugger.on("message", (_event, method: string, params: unknown) => {
      if (!guest.relayed.has(method)) return;
      emit({
        kind: "cdp-event",
        tabId: id,
        method,
        params: (params ?? {}) as Record<string, unknown>,
      });
    });

    // Every popup is denied; a web one becomes a request for a tab, which the server turns
    // into a <webview> in the Web App like any other.
    wc.setWindowOpenHandler(({ url, disposition }) => {
      if (isOpenableUrl(url)) {
        emit({
          kind: "open-request",
          url,
          openerTabId: id,
          ...(disposition === "background-tab" ? { background: true } : {}),
        });
      } else {
        opts.log(`builtin browser: refused a popup to ${urlForLog(url)}`);
      }
      return { action: "deny" };
    });
    wc.on("will-navigate", (event, url) => {
      if (mayNavigate(url)) return;
      event.preventDefault();
      opts.log(`builtin browser: refused a navigation to ${urlForLog(url)}`);
    });

    const push = () => {
      if (!wc.isDestroyed()) emit({ kind: "tab", tab: tabOf(guest) });
    };
    wc.on("did-start-loading", push);
    wc.on("did-stop-loading", push);
    // A new document keeps the icon the tab shows: Chromium announces a document's icons only
    // when they differ from the previous document's, so the icon changes exactly when
    // `page-favicon-updated` says so — and a page on the same site, which shares its icon with
    // the one before it, is never announced at all.
    wc.on("did-navigate", push);
    wc.on("did-navigate-in-page", (_event, _url, isMainFrame) => {
      if (isMainFrame) push();
    });
    wc.on("page-title-updated", push);
    wc.on("page-favicon-updated", (_event, favicons) => {
      const favicon = pickFavicon(favicons.map((url) => ({ url })));
      if (favicon === undefined) delete guest.favicon;
      else guest.favicon = favicon;
      push();
    });
    wc.on("context-menu", (_event, params) => openContextMenu(guest, params));
    // The page's renderer died (a crash, the system reclaiming memory, a kill): the tab stays,
    // showing the crash until it is reloaded, and the server hears why. The app-level
    // render-process-gone handler in main.ts logs it.
    wc.on("render-process-gone", (_event, details) => {
      guest.crashReason = details.reason;
      guest.playingMedia = 0;
      applyThrottling(guest);
      emit({ kind: "tab-crashed", tabId: id, reason: details.reason, exitCode: details.exitCode });
      push();
      // A command the dead renderer took is never answered. Detaching fails every one of them
      // now (their replies go out after the event above); the next command attaches again.
      try {
        if (wc.debugger.isAttached()) wc.debugger.detach();
      } catch {
        // Nothing attached.
      }
    });
    wc.on("unresponsive", () => opts.log(`builtin browser: tab ${id} stopped responding`));
    wc.on("responsive", () => opts.log(`builtin browser: tab ${id} responds again`));
    wc.once("destroyed", () => {
      try {
        if (wc.debugger.isAttached()) wc.debugger.detach();
      } catch {
        // Already gone with its webContents.
      }
      guests.delete(id);
      emit({ kind: "tab-closed", tabId: id });
      followLoad();
      measureSoon();
    });
    push();
    followLoad();
  }

  /**
   * Raw CDP on a guest. The debugger attaches on first use and stays; when it is detached
   * under us (the target's DevTools, or a crash) the next command simply attaches again.
   */
  async function sendCdp(guest: Guest, method: string, params?: Record<string, unknown>) {
    const dbg = guest.wc.debugger;
    if (!dbg.isAttached()) {
      try {
        dbg.attach(CDP_VERSION);
      } catch (err) {
        if (!/already attached/i.test(messageOf(err))) throw err;
      }
    }
    return (await dbg.sendCommand(method, params ?? {})) as unknown;
  }

  /**
   * Before a command that types, gives the guest the window's keyboard focus by focusing its
   * <webview> element in the embedder. A guest that cannot take it gets no keystrokes at all
   * (`keyboard_focus_failed`): sent anyway, they would land in the app's own UI — the composer,
   * the address bar.
   */
  async function focusForTyping(guest: Guest): Promise<void> {
    const embedder = guest.wc.hostWebContents as WebContents | null;
    let focused: unknown = false;
    try {
      if (embedder !== null && !embedder.isDestroyed()) {
        focused = await embedder.executeJavaScript(focusGuestScript(guest.id));
      }
    } catch {
      // The embedder could not run it (navigating, gone): the guest stays unfocused.
    }
    if (focused !== true) throw new Error("keyboard_focus_failed");
  }

  /**
   * Records which pages may be throttled while out of sight. A playing page stays at full speed
   * until its last player stops, including muted video (audibility alone cannot protect it).
   */
  function throttle(tabIds: readonly number[]): Record<string, never> {
    const throttled = new Set(tabIds);
    for (const guest of guests.values()) {
      guest.throttleAllowed = throttled.has(guest.id);
      applyThrottling(guest);
    }
    return {};
  }

  async function clearData(storages: readonly string[], partition?: string) {
    const plan = clearDataPlan(storages);
    if (plan === null) throw new Error("bad_command");
    const ses = browserSession(partition);
    if (plan.storageData.length > 0) {
      await ses.clearStorageData({ storages: plan.storageData });
    }
    if (plan.cache) await ses.clearCache();
    return {};
  }

  /**
   * Writes cookies into the browser's own store, so a page the user is signed in to opens
   * signed in.
   *
   * The store is the partition's session, which is the one every guest shares — so the
   * cookies reach every tab, and they survive the tab that was open when they arrived.
   */
  async function setCookies(
    cookies: readonly BrowserCookie[],
    partition?: string,
  ): Promise<{ written: number }> {
    const ses = browserSession(partition);
    let written = 0;
    for (const cookie of cookies) {
      try {
        await ses.cookies.set({
          url: cookie.url,
          name: cookie.name,
          value: cookie.value,
          ...(cookie.domain !== undefined ? { domain: cookie.domain } : {}),
          path: cookie.path,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          ...(cookie.expirationDate !== undefined
            ? { expirationDate: cookie.expirationDate }
            : {}),
          sameSite: cookie.sameSite,
        });
        written++;
      } catch {
        // One cookie the store refuses (a malformed domain, a SameSite the store rejects) must
        // not cost the other thousand.
      }
    }
    return { written };
  }

  async function run(command: Record<string, unknown>): Promise<unknown> {
    switch (command["op"]) {
      case "hello":
        return { version: BUILTIN_BROWSER_PROTOCOL_VERSION, partition: BUILTIN_BROWSER_PARTITION };
      case "tabs":
        return {
          tabs: [...guests.values()]
            .filter((guest) => !guest.wc.isDestroyed())
            .map((g) => tabOf(g)),
        };
      case "cdp": {
        const guest = liveGuest(command["tabId"] as number);
        // A page with no renderer cannot answer; it takes a reload first.
        if (guest.wc.isCrashed()) throw new Error("tab_crashed");
        // The event set is additive, so the exec guard's interception and the dialog watcher's
        // dialogs do not take turns replacing each other's list.
        for (const event of (command["events"] as string[] | undefined) ?? []) {
          guest.relayed.add(event);
        }
        for (const event of (command["unrelayEvents"] as string[] | undefined) ?? []) {
          guest.relayed.delete(event);
        }
        if (typesIntoGuest(command["method"] as string)) await focusForTyping(guest);
        return sendCdp(
          guest,
          command["method"] as string,
          command["params"] as Record<string, unknown> | undefined,
        );
      }
      case "open-tab":
        // The shell cannot create a tab: the Web App's <webview> does, and it claims the
        // request the server records. Answering 409 tells the server the far side is the one
        // that must ask the page.
        throw new Error("tabs_created_by_the_page");
      case "close-tab": {
        const guest = liveGuest(command["tabId"] as number);
        // The guest closes itself (its <webview> element is removed by the page); the shell
        // asks the embedder to do it, which is what a closed <webview> means to Chromium.
        const embedder = guest.wc.hostWebContents as WebContents | null;
        if (embedder === null || embedder.isDestroyed()) throw new Error("no_such_tab");
        const id = guest.id;
        await embedder
          .executeJavaScript(
            `(() => { const el = document.querySelector('webview[data-guest-id="${id}"]'); if (el) el.remove(); return true; })()`,
          )
          .catch(() => undefined);
        guests.delete(id);
        emit({ kind: "tab-closed", tabId: id });
        followLoad();
        measureSoon();
        return {};
      }
      case "activate-tab": {
        const guest = liveGuest(command["tabId"] as number);
        const embedder = guest.wc.hostWebContents as WebContents | null;
        if (embedder === null || embedder.isDestroyed()) throw new Error("no_such_tab");
        await embedder
          .executeJavaScript(
            `(() => { const el = document.querySelector('webview[data-guest-id="${guest.id}"]'); if (!el) return false; el.focus(); el.scrollIntoView({ block: 'nearest' }); return true; })()`,
          )
          .catch(() => undefined);
        return {};
      }
      case "throttle": {
        // A malformed list throttles nothing: the server sends the tabs it wants spared, and
        // a name it never sent means none.
        const sent = command["tabIds"];
        const tabIds = Array.isArray(sent)
          ? sent.filter((id): id is number => typeof id === "number")
          : [];
        return throttle(tabIds);
      }
      case "set-cookies": {
        const sent = command["cookies"];
        const cookies = Array.isArray(sent)
          ? sent.filter((c): c is BrowserCookie => typeof c === "object" && c !== null)
          : [];
        return setCookies(cookies, command["partition"] as string | undefined);
      }
      case "clear-data": {
        const sent = command["storages"];
        const storages = Array.isArray(sent)
          ? sent.filter((s): s is string => typeof s === "string")
          : [];
        return clearData(storages, command["partition"] as string | undefined);
      }
    }
    throw new Error("unknown_op");
  }

  function openContextMenu(guest: Guest, params: ContextMenuParams): void {
    const { wc } = guest;
    const items = guestContextMenu(opts.locale(), {
      linkURL: params.linkURL,
      srcURL: params.srcURL,
      mediaType: params.mediaType,
      isEditable: params.isEditable,
      selectionText: params.selectionText,
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
    });
    const template: MenuItemConstructorOptions[] = items.map((item) =>
      item.action === undefined
        ? { type: "separator" }
        : {
            label: item.label ?? "",
            enabled: item.enabled ?? true,
            click: () =>
              runGuestMenuAction(
                wc,
                item.action!,
                params,
                (url, openerTabId, background) =>
                  emit({ kind: "open-request", url, openerTabId, background }),
                (text) => clipboard.writeText(text),
              ),
          },
    );
    const host = BrowserWindow.fromWebContents(wc.hostWebContents ?? wc);
    Menu.buildFromTemplate(template).popup(host !== null ? { window: host } : {});
  }

  return {
    host(win: BrowserWindow): void {
      if (hosted.has(win)) return;
      hosted.add(win);
      const embedder = win.webContents;
      embedders.add(embedder);
      // Every <webview> the page creates passes here first: the browser's partition and a web
      // or blank start page, or it is refused; then its preferences are forced into the
      // hardened shape. Electron only defines the element in the main frame of a window with
      // `webviewTag`, so a frame inside the page (a Files panel preview) never reaches here.
      embedder.on("will-attach-webview", (event, webPreferences, params) => {
        if (!mayAttachGuest(params)) {
          event.preventDefault();
          opts.log(
            `builtin browser: refused a <webview> in partition '${params.partition ?? ""}' for ${urlForLog(params.src ?? "")}`,
          );
          return;
        }
        browserSession(params.partition ?? BUILTIN_BROWSER_PARTITION);
        hardenGuestPreferences(
          webPreferences as unknown as Record<string, unknown>,
          params.partition ?? BUILTIN_BROWSER_PARTITION,
        );
      });
      embedder.on("did-attach-webview", (_event, wc) => adopt(wc));
    },

    handle(message: unknown): boolean {
      if (!isBrowserCommandMessage(message)) return false;
      const parsed = parseBrowserCommand(message);
      if (parsed === null) return false;
      if ("error" in parsed) {
        reply(parsed.id, { ok: false, error: parsed.error });
        return true;
      }
      run(parsed.command).then(
        (result) => reply(parsed.id, { ok: true, result }),
        (err: unknown) => reply(parsed.id, { ok: false, error: messageOf(err) }),
      );
      return true;
    },
  };
}

/** The wire types the server's shell link declares, re-exported for the main process's imports. */
export type { BrowserCommandMessage, BrowserEventMessage, BrowserReplyMessage };
