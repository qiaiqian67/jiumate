/**
 * The browser service: the one implementation of core's `BrowserPort`, and therefore what the
 * `browser_read` / `browser_act` tools talk to.
 *
 * It owns the pieces below it — the link to the far side, the driver over it, the tab
 * registry, the actions — and adds the two things the tools need and the pieces do not have:
 * the answer to "can this be driven at all right now", and the guard on `exec`.
 *
 * The guard matters because `exec` runs arbitrary script in a page the user is signed into.
 * The script runs in the page's own origin, so it cannot read another origin's DOM — but it
 * could *send* to one, carrying `document.cookie` away. So while a script runs, the tab's
 * requests are intercepted and the ones that leave the page's origin are failed. That is
 * enforced in the browser, not by reading the script: a script that hid the call behind
 * `new Image().src` would pass a source check and be stopped here all the same.
 */
import type {
  BrowserActRequest,
  BrowserBackend,
  BrowserBackendInfo,
  BrowserExecResult,
  BrowserPort,
  BrowserScanResult,
  BrowserScreenshot,
  BrowserStatus,
  BrowserTab,
} from "@prismshadow/jiumate-core/interfaces";
import { HttpError } from "../http/errors.js";
import { BrowserActions } from "./actions.js";
import type { ActionTiming } from "./actions.js";
import { BrowserDriver } from "./driver.js";
import type { BrowserLink, BrowserLinkEvent } from "./link.js";
import { TabRegistry } from "./tabs.js";

/** The CDP event a paused request raises while the `Fetch` domain is on. */
const FETCH_PAUSED_EVENT = "Fetch.requestPaused";

/** The origin of a URL, or null when it has none (`about:blank`, `data:`). */
export function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

export interface BrowserServiceOptions {
  link: BrowserLink;
  timing?: Partial<ActionTiming>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** The scan's content budget, in characters. */
  scanMaxChars?: number;
  /**
   * Called whenever the browser's state changes — a tab appeared, closed or crashed, or a
   * page was asked for that a window has yet to open. The Web App's panel learns of the
   * change through this rather than by polling: the change is pushed the moment it happens,
   * so the strip does not lag behind the agent's page by a poll interval.
   */
  onChange?: (state: BrowserStatus) => void;
}

export class BrowserService implements BrowserPort {
  private readonly link: BrowserLink;
  private readonly tabs = new TabRegistry();
  private readonly driver: BrowserDriver;
  private readonly actions: BrowserActions;
  private readonly scanMaxChars: number | undefined;
  /** Whether the far side has answered at least once. */
  private ready = false;
  /** Whether the far side's tab list has been read at least once. */
  private refreshed = false;
  /** The refresh under way, so concurrent callers wait for one answer rather than many. */
  private refreshing: Promise<void> | null = null;
  /** The tab the user is looking at, or null when no window is showing one. */
  private onScreenTabId: number | null = null;
  /** The push channel's callback, when the host gave one. */
  private readonly onChange: ((state: BrowserStatus) => void) | undefined;

  constructor(opts: BrowserServiceOptions) {
    this.link = opts.link;
    this.driver = new BrowserDriver(opts.link, {
      ...(opts.sleep !== undefined ? { sleep: opts.sleep } : {}),
      ...(opts.now !== undefined ? { now: opts.now } : {}),
    });
    this.actions = new BrowserActions({
      driver: this.driver,
      tabs: this.tabs,
      ...(opts.timing !== undefined ? { timing: opts.timing } : {}),
      ...(opts.sleep !== undefined ? { sleep: opts.sleep } : {}),
      ...(opts.now !== undefined ? { now: opts.now } : {}),
    });
    this.scanMaxChars = opts.scanMaxChars;
    this.onChange = opts.onChange;
    this.link.onEvent((event) => this.onLinkEvent(event));
    this.link.onConnect(() => this.refresh());
    // The far side is only "connected" once it has answered a hello. Nobody else does that
    // handshake: the link is created here, before the shell's port exists, and the port is
    // handed over later. So the service makes it, and a far side that is not there yet simply
    // does not answer — the next call tries again.
    void this.handshake();
  }

  /**
   * Greets the far side, so the link knows it is there. A far side that does not answer is
   * not an error: the shell may not have started yet, and the browser is reported as
   * unavailable until it does.
   */
  private async handshake(): Promise<void> {
    try {
      await this.link.handshake();
    } catch {
      // The link reports an unconnected far side itself; nothing to add.
    }
  }

  /**
   * Tells the push channel the browser's state moved. A failure here is not the browser's
   * problem: the panel will read the state the next time it asks, so a broken push costs a
   * delay, not a wrong answer.
   */
  private announce(): void {
    if (this.onChange === undefined) return;
    try {
      this.onChange(this.statusSync());
    } catch {
      // The channel is gone; the next state change tries again.
    }
  }

  /** The state as it stands, without waiting for the far side. */
  private statusSync(): BrowserStatus {
    const info = this.backendInfo();
    const opens = this.tabs.pendingOpens();
    return {
      available: info.available,
      ...(info.reason !== undefined ? { reason: info.reason } : {}),
      backend: info.backend,
      backends: [info],
      tabs: this.tabs.list(),
      activeTabId: this.tabs.active(),
      ...(opens.length > 0 ? { openRequests: opens } : {}),
    };
  }

  /** The far side's tabs, as the registry reflects them. */
  private async refresh(): Promise<void> {
    try {
      const answer = (await this.link.request({ op: "tabs" })) as { tabs?: BrowserTab[] };
      if (Array.isArray(answer.tabs)) this.tabs.replace(answer.tabs);
      this.ready = true;
      this.refreshed = true;
    } catch {
      // A far side that cannot answer its tab list is not ready; the next handshake tries again.
    }
  }

  /**
   * Reads the far side's tab list once, before the first action. A tab that already existed
   * when this service was made would otherwise be missed: the far side reports its tabs as
   * events, and a service that was built after them has already missed those.
   *
   * A far side that has not said hello yet is greeted here first: the shell may have come up
   * after the service was built, and without the greeting the browser would stay
   * "unavailable" for the rest of the process's life.
   */
  private async ensureTabs(): Promise<void> {
    if (this.refreshed) return;
    if (!this.link.connected) await this.handshake();
    if (this.refreshed || !this.link.connected) return;
    if (this.refreshing === null) {
      this.refreshing = this.refresh().finally(() => {
        this.refreshing = null;
      });
    }
    await this.refreshing;
  }

  private onLinkEvent(event: BrowserLinkEvent): void {
    switch (event.kind) {
      case "tab":
        this.tabs.upsert(event.tab);
        this.announce();
        return;
      case "tab-closed":
        this.tabs.remove(event.tabId);
        this.announce();
        return;
      case "tab-crashed":
        this.tabs.markCrashed(event.tabId, event.reason);
        this.announce();
        return;
      case "open-request": {
        // A popup the page asked for: the far side could not open it as a tab itself, so it
        // asks the server to have one created.
        const request = this.tabs.requestOpen(event.url, {
          activate: event.background !== true,
          openerTabId: event.openerTabId,
        });
        void this.link
          .request({ op: "open-tab", url: event.url, activate: event.background !== true })
          .catch(() => undefined);
        // The panel has to learn there is something to open, or the request waits for a poll
        // that may never come.
        this.announce();
        void request;
        return;
      }
      default:
        return;
    }
  }

  /** The backend this service drives, and whether it can be driven now. */
  private backendInfo(): BrowserBackendInfo {
    const backend: BrowserBackend = this.link.backend;
    const connected = this.link.connected;
    return {
      backend,
      available: connected,
      ...(connected ? {} : { reason: "not_desktop" as const }),
    };
  }

  /** The tab an action applies to: the one named, or the active one. */
  private resolveTab(tabId?: number): BrowserTab {
    const tab = tabId !== undefined ? this.tabs.get(tabId) : this.tabs.current();
    if (tab === undefined) {
      throw new HttpError(
        404,
        "no_such_tab",
        tabId !== undefined
          ? `Tab ${tabId} is not open.`
          : 'No tab is open. Open one with browser_read action="open" first.',
      );
    }
    return tab;
  }

  async status(): Promise<BrowserStatus> {
    await this.ensureTabs();
    return this.statusSync();
  }

  async open(
    url: string,
    options: { newTab?: boolean; tabId?: number } = {},
  ): Promise<BrowserStatus> {
    await this.ensureTabs();
    if (!this.link.connected) {
      throw new HttpError(
        503,
        "browser_unavailable",
        "The agent browser cannot be driven right now.",
      );
    }
    if (options.tabId !== undefined) {
      const tab = this.resolveTab(options.tabId);
      await this.actions.navigate(tab.id, url);
      this.tabs.activate(tab.id);
      return this.status();
    }
    if (this.link.capabilities.createsTabs) {
      await this.link.request({ op: "open-tab", url, activate: true });
    } else {
      // The far side cannot create tabs (the Web App's `<webview>` does): the request is
      // recorded and answered when that tab claims it.
      this.tabs.requestOpen(url, { activate: true });
      await this.link.request({ op: "open-tab", url, activate: true }).catch(() => undefined);
      // A window has to learn there is something to open.
      this.announce();
    }
    return this.status();
  }

  async close(tabId?: number): Promise<BrowserStatus> {
    await this.ensureTabs();
    const tab = this.resolveTab(tabId);
    await this.link.request({ op: "close-tab", tabId: tab.id });
    this.tabs.remove(tab.id);
    this.announce();
    return this.status();
  }

  async scan(options: { tabId?: number; textOnly?: boolean } = {}): Promise<BrowserScanResult> {
    await this.ensureTabs();
    const tab = this.resolveTab(options.tabId);
    this.tabs.activate(tab.id);
    const result = await this.actions.scan(tab.id, {
      ...(options.textOnly !== undefined ? { textOnly: options.textOnly } : {}),
      ...(this.scanMaxChars !== undefined ? { maxChars: this.scanMaxChars } : {}),
    });
    return {
      tab: this.tabs.get(tab.id) ?? tab,
      content: result.content,
      ...(result.truncated ? { truncated: true } : {}),
    };
  }

  async act(request: BrowserActRequest): Promise<BrowserExecResult> {
    await this.ensureTabs();
    const tab = this.resolveTab(request.tabId);
    this.tabs.activate(tab.id);

    switch (request.action) {
      case "click": {
        if (request.selector === undefined || request.selector === "") {
          throw new HttpError(422, "invalid_request", "A click needs a selector.");
        }
        return this.actions.click(
          tab.id,
          { selector: request.selector },
          { acceptDialogs: request.acceptDialogs === true },
        );
      }
      case "type": {
        if (request.text === undefined) {
          throw new HttpError(422, "invalid_request", "Typing needs text.");
        }
        return this.actions.type(tab.id, {
          text: request.text,
          acceptDialogs: request.acceptDialogs === true,
        });
      }
      case "exec": {
        if (request.script === undefined || request.script.trim() === "") {
          throw new HttpError(422, "invalid_request", "An exec needs a script.");
        }
        return this.guardedExec(tab, request.script, request.acceptDialogs === true);
      }
    }
  }

  async screenshot(options: { tabId?: number } = {}): Promise<BrowserScreenshot> {
    await this.ensureTabs();
    const tab = this.resolveTab(options.tabId);
    this.tabs.activate(tab.id);
    return this.actions.screenshot(tab.id);
  }

  /**
   * A tab the page created for an open request claims it. The first claim wins; a second
   * window claiming the same request is told it is a duplicate, and the tab it made is
   * closed by the window that made it.
   */
  claim(tabId: number, requestId: string): "claimed" | "duplicate" | "unknown" {
    const outcome = this.tabs.claim(tabId, requestId);
    // A claimed request is no longer pending, so every window must stop offering it.
    this.announce();
    return outcome;
  }

  /**
   * The tab the user is looking at, or null when the window shows none. It is what the panel
   * draws, and the server keeps it so a page that is not in front is not mistaken for a
   * closed one.
   */
  setOnScreen(tabId: number | null): void {
    this.onScreenTabId = tabId;
  }

  /** The tab the user is looking at, or null. */
  onScreen(): number | null {
    return this.onScreenTabId;
  }

  /**
   * Focuses a tab: the user pressing a tab in the strip, or the agent naming one. The tab
   * becomes the active one, so the browser the agent is using is the one on screen.
   */
  async activate(tabId?: number): Promise<BrowserStatus> {
    await this.ensureTabs();
    const tab = this.resolveTab(tabId);
    this.tabs.activate(tab.id);
    await this.link.request({ op: "activate-tab", tabId: tab.id }).catch(() => undefined);
    this.announce();
    return this.status();
  }

  /** Goes to a URL in a tab. */
  async navigate(url: string, tabId?: number): Promise<BrowserStatus> {
    await this.ensureTabs();
    const tab = this.resolveTab(tabId);
    this.tabs.activate(tab.id);
    await this.actions.navigate(tab.id, url);
    return this.status();
  }

  /**
   * An exec with the origin guard on: the tab's requests are intercepted while the script
   * runs, and the ones that leave the page's origin are failed. The page's own requests are
   * let through, so a script that fetches its own API still works.
   */
  private async guardedExec(
    tab: BrowserTab,
    script: string,
    acceptDialogs: boolean,
  ): Promise<BrowserExecResult> {
    const origin = originOf(tab.url);
    /** The requests the far side paused that have not been answered yet. */
    const pending = new Set<string>();
    const stop = this.driver.onCdpEvent(tab.id, (method, params) => {
      if (method !== FETCH_PAUSED_EVENT) return;
      const requestId = params.requestId;
      if (typeof requestId !== "string") return;
      pending.add(requestId);
      const request = params.request;
      const url =
        typeof request === "object" && request !== null && "url" in request
          ? (request as { url?: unknown }).url
          : undefined;
      const sameOrigin = origin !== null && typeof url === "string" && originOf(url) === origin;
      void this.driver
        .cdp(tab.id, sameOrigin ? "Fetch.continueRequest" : "Fetch.failRequest", {
          requestId,
          ...(sameOrigin ? {} : { errorReason: "BlockedByClient" }),
        })
        .then(
          () => pending.delete(requestId),
          () => pending.delete(requestId),
        );
    });

    try {
      await this.driver.cdp(tab.id, "Fetch.enable", { patterns: [{ urlPattern: "*" }] }, 10_000, [
        FETCH_PAUSED_EVENT,
      ]);
    } catch {
      // The far side cannot intercept. A script that could reach the network must not run
      // unguarded, so this says so rather than running it anyway.
      stop();
      throw new HttpError(
        501,
        "exec_guard_unavailable",
        "This browser cannot block cross-origin requests, so a script that could reach the " +
          'network is not run. Use browser_act action="click" or action="type" instead.',
      );
    }

    try {
      return await this.actions.exec(tab.id, script, { acceptDialogs });
    } finally {
      // The interception is turned off **before** the handler is removed: a request the far
      // side pauses while the interception is going away still has to be answered, and a
      // handler that is already gone would leave the page waiting on a request that never
      // comes.
      await this.driver
        .cdp(tab.id, "Fetch.disable", {}, 5_000, undefined, [FETCH_PAUSED_EVENT])
        .catch(() => undefined);
      stop();
      for (const requestId of pending) {
        void this.driver
          .cdp(tab.id, "Fetch.failRequest", { requestId, errorReason: "BlockedByClient" })
          .catch(() => undefined);
      }
    }
  }
}
