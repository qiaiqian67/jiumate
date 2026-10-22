/**
 * The headless browser's link: a real Chromium, started by the server, driven over its own
 * debugger.
 *
 * This is the third backend, and it is the one that works without a desktop shell. The
 * built-in browser needs the desktop app's window (a `<webview>` is created by the Web App
 * and hosted by the shell); the Chrome extension needs the user to have Chrome open and to
 * have installed it. This one needs only a Chromium on the machine — which the machine
 * already has, because the desktop app ships one.
 *
 * The shape is the same as the other links' — the same `BrowserLink` interface, the same
 * commands — so the driver, the actions, the scripts and the tools are unchanged. What
 * differs is who holds the browser:
 *
 * - the built-in browser's tabs are `<webview>` guests the shell hosts, and the shell runs
 *   their CDP; here the tabs are CDP targets the browser itself owns;
 * - the shell creates no tab (the page does), and here the browser creates them on request;
 * - the shell's cookie store is the partition session, and here it is the browser's own
 *   profile.
 *
 * The user cannot see this browser and cannot take a tab over. That is the trade: nothing
 * opens on their screen, and the agent works in a browser of its own.
 */
import type { BrowserCookie, BrowserTab } from "@prismshadow/jiumate-core/interfaces";
import { spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import {
  BrowserLinkError,
  type BrowserCommand,
  type BrowserLink,
  type BrowserLinkEvent,
} from "../link.js";
import { CdpConnection, type CdpEvent } from "./cdp-connection.js";
import { launchChromium, resolveChromium, type Env } from "./chromium.js";

/** The headless browser's capabilities: it creates its own tabs and keeps its own cookies. */
export const HEADLESS_CAPABILITIES = {
  createsTabs: true,
  throttles: false,
  cookieStore: true,
} as const;

/** How long the browser may take to start before the call is given up on. */
const HANDSHAKE_TIMEOUT_MS = 40_000;

/** One tab of the headless browser: a CDP target and the session attached to it. */
interface HeadlessTab {
  /** The tab's own id, as the tools know it. */
  id: number;
  /** The CDP target's id. */
  targetId: string;
  /** The session attached to it; the id CDP addresses it by. */
  sessionId: string;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  favicon?: string;
  crashed?: string;
}

export interface HeadlessLinkOptions {
  /** The data root: the browser's profile lives under it, so the sign-ins persist. */
  root: string;
  /** Which browser to drive; the first one on the machine when absent. */
  browserId?: string;
  /** Whether the browser shows a window. Headless means no window. */
  headless?: boolean;
  /** The machine's paths, injectable for tests. */
  env?: Env;
  /** Reports a line for the log. */
  log?: (line: string) => void;
}

/**
 * The headless browser's link.
 *
 * The browser is started on the first use, not at construction: a server that never drives a
 * page should not leave a browser running.
 */
export class HeadlessLink implements BrowserLink {
  readonly backend = "headless" as const;
  readonly capabilities = HEADLESS_CAPABILITIES;

  private connection: CdpConnection | null = null;
  private browser: Awaited<ReturnType<typeof launchChromium>> | null = null;
  /** Whether the browser was ever started; a browser that was never started is not a failure. */
  private started = false;
  private starting: Promise<void> | null = null;
  private readonly tabs = new Map<number, HeadlessTab>();
  private readonly tabIds = new Map<string, number>();
  private readonly sessions = new Map<string, number>();
  private nextTabId = 1;
  private activeTabId: number | null = null;
  private readonly listeners = new Set<(event: BrowserLinkEvent) => void>();
  private readonly connectListeners = new Set<() => Promise<void> | void>();
  private readonly disconnectListeners = new Set<() => void>();
  private readonly log: (line: string) => void;
  private readonly opts: HeadlessLinkOptions;
  /** Why the browser could not be driven, when it could not. */
  private failure: string | null = null;

  constructor(opts: HeadlessLinkOptions) {
    this.opts = opts;
    this.log = opts.log ?? (() => undefined);
  }

  get connected(): boolean {
    return this.connection?.isOpen === true;
  }

  /**
   * Whether the browser can be driven.
   *
   * A browser that has not started yet still can: it starts on the first call that needs
   * it. So this is true even before the first page is opened.
   */
  get canDrive(): boolean {
    return this.started || this.failure === null;
  }

  /** Why the browser is not available, when it is not. */
  get unavailableReason(): string | null {
    return this.failure;
  }

  async request(command: BrowserCommand, timeoutMs?: number): Promise<unknown> {
    // The browser starts when the agent ACTUALLY uses it, not when the app asks about it:
    // a server that has never driven a page should not leave a browser running, and
    // asking "which tabs do you have" must not start one to answer.
    if (!this.connected && (command.op === "tabs" || command.op === "hello")) {
      return command.op === "tabs" ? { tabs: [] } : { version: 1, backend: "headless" };
    }
    await this.ensureStarted();
    const connection = this.connection;
    if (connection === null) {
      throw new BrowserLinkError("closed", this.failure ?? "The browser is not running.");
    }
    switch (command.op) {
      case "hello":
        return { version: 1, backend: "headless" };
      case "tabs":
        return { tabs: this.tabList() };
      case "cdp": {
        // A tab id of 0 means the browser itself, not a tab: the commands that are about
        // the whole browser (its cookie store, its version) have no session.
        if (command.tabId === 0) {
          return connection.send(command.method, command.params ?? {}, {
            ...(timeoutMs !== undefined ? { timeoutMs } : {}),
          });
        }
        const sessionId = this.sessionOf(command.tabId);
        if (sessionId === undefined) {
          throw new BrowserLinkError("refused", "no_such_tab");
        }
        return connection.send(command.method, command.params ?? {}, {
          sessionId,
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        });
      }
      case "open-tab": {
        const tab = await this.openTab(command.url);
        if (command.activate) this.activeTabId = tab.id;
        return { tabId: tab.id };
      }
      case "close-tab": {
        await this.closeTab(command.tabId);
        return {};
      }
      case "activate-tab": {
        if (this.tabs.has(command.tabId)) this.activeTabId = command.tabId;
        return {};
      }
      case "set-cookies": {
        const written = await this.setCookies(command.cookies);
        return { written };
      }
      case "clear-data": {
        await this.clearData();
        return {};
      }
    }
  }

  async handshake(force = false): Promise<boolean> {
    if (this.connected && !force) return true;
    // The handshake asks whether the browser is THERE, not for it to be started: a server
    // that has not driven a page yet has no browser, and that is not an error.
    if (!this.started) {
      this.failure = null;
      return false;
    }
    try {
      await this.connection?.send("Target.getTargets");
      for (const listener of [...this.connectListeners]) await listener();
      return true;
    } catch (err) {
      this.failure = err instanceof Error ? err.message : String(err);
      return false;
    }
  }

  onEvent(listener: (event: BrowserLinkEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onConnect(listener: () => Promise<void> | void): () => void {
    this.connectListeners.add(listener);
    return () => this.connectListeners.delete(listener);
  }

  onDisconnect(listener: () => void): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  /**
   * Stops the browser, gracefully.
   *
   * The graceful part matters: a browser killed outright does not write its cookie store
   * out, so the sign-ins an import brought would be gone the next time it started. Chrome
   * asked to close writes everything out and leaves.
   */
  async close(): Promise<void> {
    const browser = this.browser;
    if (browser === null) return;
    // `Browser.close` is the browser's own goodbye: it flushes its stores and exits.
    await this.connection?.send("Browser.close").catch(() => undefined);
    const timer = setTimeout(() => killBrowser(browser), 5_000);
    timer.unref?.();
    await browser.exited;
    clearTimeout(timer);
    // The browser's own children (its renderers, its utility processes) hold the profile
    // open even after the parent is gone, so they are killed too: whoever wants to remove
    // that directory cannot until they are.
    killBrowser(browser);
    this.connection?.close();
    this.connection = null;
  }

  /**
   * Whether the browser is running.
   *
   * The process may be gone while its children are not, and the children hold the profile
   * open — so this is about the whole tree, not just the parent.
   */
  get running(): boolean {
    return this.browser !== null && this.browser.process.exitCode === null;
  }

  dispose(): void {
    // The browser holds its profile open, so the process has to be gone before anyone can
    // remove that directory. The kill is the signal; the promise is the wait.
    const browser = this.browser;
    if (browser !== null) {
      // The graceful close is asked for first, and the kill is the fallback: a browser that
      // does not answer must still go, or the profile stays locked.
      void this.connection?.send("Browser.close").catch(() => undefined);
      const timer = setTimeout(() => killBrowser(browser), 3_000);
      timer.unref?.();
      browser.exited.then(() => clearTimeout(timer));
    }
    this.connection?.close();
    this.connection = null;
    this.listeners.clear();
    this.connectListeners.clear();
    this.disconnectListeners.clear();
  }

  /**
   * Resolves when the browser is gone.
   *
   * The browser holds its profile open, so whoever wants to remove that directory has to
   * wait for the process to be gone first.
   */
  async waitForExit(): Promise<void> {
    await this.browser?.exited;
  }

  // -------------------------------------------------------------------------
  // Starting
  // -------------------------------------------------------------------------

  /** Starts the browser if it is not running. */
  private async ensureStarted(): Promise<void> {
    if (this.connected) return;
    if (this.starting !== null) return this.starting;
    this.starting = this.start().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async start(): Promise<void> {
    const browser = resolveChromium(this.opts.browserId, this.opts.env);
    if (browser === null || browser.path === null) {
      this.failure =
        this.opts.browserId !== undefined && this.opts.browserId !== ""
          ? `No ${this.opts.browserId} on this machine.`
          : "No Chromium browser on this machine.";
      throw new BrowserLinkError("refused", this.failure);
    }
    const profile = profileFor(this.opts.root, browser.id);
    try {
      this.browser = await launchChromium(browser.path, profile, {
        ...(this.opts.headless !== undefined ? { headless: this.opts.headless } : {}),
      });
    } catch (err) {
      this.failure = err instanceof Error ? err.message : String(err);
      throw new BrowserLinkError("refused", this.failure);
    }
    this.failure = null;
    this.started = true;
    this.connection = await CdpConnection.connect(this.browser.endpoint, HANDSHAKE_TIMEOUT_MS);
    this.connection.onEvent((event) => this.onCdpEvent(event));
    this.log(`headless browser: started ${browser.name} on port ${this.browser.port}`);
  }

  // -------------------------------------------------------------------------
  // Tabs
  // -------------------------------------------------------------------------

  /** A new tab, attached to a session of its own. */
  private async openTab(url: string): Promise<HeadlessTab> {
    const connection = this.connection;
    if (connection === null) throw new BrowserLinkError("closed", "The browser is not running.");
    const created = (await connection.send("Target.createTarget", { url })) as { targetId: string };
    const attached = (await connection.send("Target.attachToTarget", {
      targetId: created.targetId,
      flatten: true,
    })) as { sessionId: string };
    const id = this.nextTabId++;
    const tab: HeadlessTab = {
      id,
      targetId: created.targetId,
      sessionId: attached.sessionId,
      url,
      title: "",
      loading: true,
      canGoBack: false,
      canGoForward: false,
    };
    this.tabs.set(id, tab);
    this.tabIds.set(created.targetId, id);
    this.sessions.set(attached.sessionId, id);
    this.activeTabId = id;
    // The Page domain has to be on for the load events to come: a target that is attached
    // but not asked to report anything stays quiet, and a tab that never hears that the
    // page loaded stays "loading" forever.
    await this.enableDomains(attached.sessionId);
    await this.syncTab(id);
    this.emit({ kind: "tab", tab: this.tabOf(tab) });
    return tab;
  }

  /** Turns on the CDP domains the driver's own commands rely on. */
  private async enableDomains(sessionId: string): Promise<void> {
    const connection = this.connection;
    if (connection === null) return;
    await connection.send("Page.enable", {}, { sessionId }).catch(() => undefined);
    await connection.send("Network.enable", {}, { sessionId }).catch(() => undefined);
    await connection.send("Runtime.enable", {}, { sessionId }).catch(() => undefined);
  }

  private async closeTab(tabId: number): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (tab === undefined) return;
    this.tabs.delete(tabId);
    this.tabIds.delete(tab.targetId);
    this.sessions.delete(tab.sessionId);
    if (this.activeTabId === tabId) this.activeTabId = null;
    await this.connection
      ?.send("Target.closeTarget", { targetId: tab.targetId })
      .catch(() => undefined);
    this.emit({ kind: "tab-closed", tabId });
  }

  /** The CDP session of a tab, for the driver. */
  private sessionOf(tabId: number): string | undefined {
    return this.tabs.get(tabId)?.sessionId;
  }

  /** The tab list, as the far side answers it. */
  private tabList(): BrowserTab[] {
    return [...this.tabs.values()].map((tab) => this.tabOf(tab));
  }

  private tabOf(tab: HeadlessTab): BrowserTab {
    return {
      id: tab.id,
      url: tab.url,
      title: tab.title,
      loading: tab.loading,
      canGoBack: tab.canGoBack,
      canGoForward: tab.canGoForward,
      ...(tab.favicon !== undefined ? { favicon: tab.favicon } : {}),
      ...(tab.crashed !== undefined ? { crashed: tab.crashed } : {}),
    };
  }

  // -------------------------------------------------------------------------
  // Cookies
  // -------------------------------------------------------------------------

  /**
   * Writes cookies into the browser's own store.
   *
   * The browser is started with `--remote-debugging-port`, so its store is a plain file on
   * disk — but the browser holds it open, so it is written through CDP, not by touching the
   * file.
   */
  private async setCookies(cookies: readonly BrowserCookie[]): Promise<number> {
    const connection = this.connection;
    if (connection === null) throw new BrowserLinkError("closed", "The browser is not running.");
    let written = 0;
    for (const cookie of cookies) {
      try {
        await connection.send("Storage.setCookies", {
          cookies: [
            {
              name: cookie.name,
              value: cookie.value,
              domain: cookie.domain ?? hostOf(cookie.url),
              path: cookie.path,
              secure: cookie.secure,
              httpOnly: cookie.httpOnly,
              ...(cookie.expirationDate !== undefined ? { expires: cookie.expirationDate } : {}),
              sameSite: sameSiteOf(cookie.sameSite),
            },
          ],
        });
        written++;
      } catch {
        // One cookie the store refuses must not cost the other thousand.
      }
    }
    return written;
  }

  /** Empties the browser's cookie store. */
  private async clearData(): Promise<void> {
    const connection = this.connection;
    if (connection === null) return;
    await connection.send("Storage.clearCookies").catch(() => undefined);
    await connection.send("Network.clearBrowserCookies").catch(() => undefined);
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  private onCdpEvent(event: CdpEvent): void {
    const tabId = event.sessionId !== undefined ? this.sessions.get(event.sessionId) : undefined;
    switch (event.method) {
      case "Page.frameNavigated": {
        const frame = event.params["frame"] as { parentId?: string; url?: string } | undefined;
        // Only the main frame is the tab's page; a subframe's navigation is not the tab's.
        if (frame === undefined || frame.parentId !== undefined) return;
        const tab = tabId === undefined ? undefined : this.tabs.get(tabId);
        if (tab === undefined || frame.url === undefined) return;
        tab.url = frame.url;
        tab.loading = true;
        this.emit({ kind: "tab", tab: this.tabOf(tab) });
        return;
      }
      case "Page.loadEventFired": {
        const tab = tabId === undefined ? undefined : this.tabs.get(tabId);
        if (tab === undefined || tabId === undefined) return;
        tab.loading = false;
        void this.syncTab(tabId);
        this.emit({ kind: "tab", tab: this.tabOf(tab) });
        return;
      }
      case "Page.frameStoppedLoading": {
        const tab = tabId === undefined ? undefined : this.tabs.get(tabId);
        if (tab === undefined) return;
        tab.loading = false;
        this.emit({ kind: "tab", tab: this.tabOf(tab) });
        return;
      }
      case "Page.javascriptDialogOpening": {
        // The dialogs are answered by the far side's own watcher; here the browser's default
        // is to dismiss them, which is what a page that asks a question without an answer
        // should get.
        if (tabId === undefined) return;
        void this.connection
          ?.send("Page.handleJavaScriptDialog", { accept: false }, { sessionId: event.sessionId })
          .catch(() => undefined);
        return;
      }
      case "Target.targetCreated": {
        // A popup: the browser made a target of its own. It is a tab the agent can drive.
        void this.adoptTarget(event.params["targetInfo"] as { targetId?: string } | undefined);
        return;
      }
      case "Target.targetDestroyed": {
        const targetId = event.params["targetId"] as string | undefined;
        if (targetId === undefined) return;
        const id = this.tabIds.get(targetId);
        if (id === undefined) return;
        this.tabs.delete(id);
        this.tabIds.delete(targetId);
        if (this.activeTabId === id) this.activeTabId = null;
        this.emit({ kind: "tab-closed", tabId: id });
        return;
      }
      case "Inspector.targetCrashed": {
        const tab = tabId === undefined ? undefined : this.tabs.get(tabId);
        if (tab === undefined || tabId === undefined) return;
        tab.crashed = "crashed";
        this.emit({ kind: "tab", tab: this.tabOf(tab) });
        this.emit({ kind: "tab-crashed", tabId, reason: "crashed", exitCode: 0 });
        return;
      }
      case "Target.detachedFromTarget": {
        const sessionId = event.params["sessionId"] as string | undefined;
        if (sessionId === undefined) return;
        const id = this.sessions.get(sessionId);
        if (id === undefined) return;
        this.sessions.delete(sessionId);
        return;
      }
    }
  }

  /** A target the browser made by itself: a popup. It becomes a tab. */
  private async adoptTarget(info: { targetId?: string } | undefined): Promise<void> {
    const connection = this.connection;
    if (connection === null || info?.targetId === undefined) return;
    if (this.tabIds.has(info.targetId)) return;
    // Only pages are tabs; a worker or a service worker is not.
    const attached = (await connection
      .send("Target.attachToTarget", { targetId: info.targetId, flatten: true })
      .catch(() => undefined)) as { sessionId: string } | undefined;
    if (attached === undefined) return;
    const id = this.nextTabId++;
    const tab: HeadlessTab = {
      id,
      targetId: info.targetId,
      sessionId: attached.sessionId,
      url: "",
      title: "",
      loading: false,
      canGoBack: false,
      canGoForward: false,
    };
    this.tabs.set(id, tab);
    this.tabIds.set(info.targetId, id);
    this.sessions.set(attached.sessionId, id);
    await this.enableDomains(attached.sessionId);
    await this.syncTab(id);
    this.emit({ kind: "tab", tab: this.tabOf(tab) });
  }

  /** Reads a tab's title and history buttons, so the strip shows what is there. */
  private async syncTab(tabId: number): Promise<void> {
    const tab = this.tabs.get(tabId);
    const connection = this.connection;
    if (tab === undefined || connection === null) return;
    const sessionId = tab.sessionId;
    const title = (await connection
      .send("Runtime.evaluate", { expression: "document.title" }, { sessionId })
      .catch(() => undefined)) as { result?: { value?: unknown } } | undefined;
    const url = (await connection
      .send("Runtime.evaluate", { expression: "location.href" }, { sessionId })
      .catch(() => undefined)) as { result?: { value?: unknown } } | undefined;
    if (typeof title?.result?.value === "string") tab.title = title.result.value;
    if (typeof url?.result?.value === "string") tab.url = url.result.value;
    const history = (await connection
      .send("Page.getNavigationHistory", {}, { sessionId })
      .catch(() => undefined)) as { currentIndex?: number; entries?: unknown[] } | undefined;
    const index = history?.currentIndex ?? 0;
    const total = history?.entries?.length ?? 0;
    tab.canGoBack = index > 0;
    tab.canGoForward = index < total - 1;
  }

  private emit(event: BrowserLinkEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // A listener's failure is its own.
      }
    }
  }
}

/** The host of a cookie's URL, for the store's own domain field. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** CDP's spelling of the same-site values. */
function sameSiteOf(sameSite: BrowserCookie["sameSite"]): string {
  switch (sameSite) {
    case "no_restriction":
      return "None";
    case "lax":
      return "Lax";
    case "strict":
      return "Strict";
    default:
      return "Lax";
  }
}

/** Where the headless browser's profile lives: under the data root, so it persists. */
function profileFor(root: string, browserId: string): string {
  return `${root}/browser/${browserId}`;
}

/**
 * Kills a browser and everything it started.
 *
 * Chrome's parent process forks renderers and utility processes, and those hold the
 * profile open even after the parent is gone: whoever wants to remove that directory
 * cannot until they are. So the whole tree goes.
 *
 * The tree is found by the **profile directory**, not by the parent process: by the time
 * the browser is being cleaned up its parent has usually exited, and a kill aimed at a
 * dead parent reaches nothing. Every process that names our profile is ours.
 */
function killBrowser(browser: { process: ChildProcess; profile: string }): void {
  const pid = browser.process.pid;
  if (globalThis.process.platform === "win32") {
    if (pid !== undefined) {
      try {
        spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
      } catch {
        // The parent may be gone already; the profile walk below still works.
      }
    }
    killByProfile(browser.profile);
    return;
  }
  if (pid !== undefined) {
    try {
      // The group: the browser starts its children in its own group, so one signal reaches
      // all of them.
      browser.process.kill(-pid);
    } catch {
      try {
        browser.process.kill();
      } catch {
        // Already gone.
      }
    }
  }
}

/**
 * Kills every process that holds the profile directory open, on Windows.
 *
 * The processes are found by their command line, which names the profile: a browser
 * started for us is the only one that names our directory. PowerShell's CIM query is used
 * because `wmic` is being retired and is not on every machine.
 */
function killByProfile(profile: string): void {
  const script =
    "$needle = $env:JIUMATE_BROWSER_PROFILE; " +
    "Get-CimInstance Win32_Process | " +
    "Where-Object { $_.CommandLine -and $_.CommandLine.Contains($needle) } | " +
    "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }";
  try {
    spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "ignore", "ignore"],
      env: { ...globalThis.process.env, JIUMATE_BROWSER_PROFILE: profile },
    });
  } catch {
    // Without PowerShell the parent's own kill is all there is.
  }
}
