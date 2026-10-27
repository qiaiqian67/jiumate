/**
 * The seam under the browser driver: one link per backend, the same request/reply-and-events
 * contract whether the far side is the desktop shell (over Electron's utilityProcess port) or
 * the user's own Chrome (over a WebSocket the extension opens). The driver, the page scripts
 * and the actions speak only this.
 *
 * What differs between the two is declared, not discovered: `capabilities` says which commands
 * the far side answers (the shell throttles and holds a cookie store; the extension creates,
 * closes and focuses its own tabs), and the runtime branches on it.
 *
 * The protocol is deliberately small. A `cdp` command carries a raw CDP method, so the server
 * never has to learn a new verb for every browser capability: what the far side can do is
 * expressed as the CDP methods it answers.
 */
import type {
  BrowserBackend,
  BrowserBackendCapabilities,
  BrowserCookie,
  BrowserTab,
} from "@jadelau/core/interfaces";
import { HttpError } from "../http/errors.js";

/** One command sent to the far side. */
export type BrowserCommand =
  /** Reply: a hello naming the far side's version. An older shell never answers. */
  | { op: "hello" }
  /** Reply: `{ tabs: BrowserTab[] }`. */
  | { op: "tabs" }
  /**
   * Reply: the CDP method's result object. `events` names CDP events the far side relays for
   * this tab from then on, as `cdp-event`s; `unrelayEvents` names ones it stops relaying.
   *
   * Both are **additive**: the far side keeps the union of what every command asked for, so
   * two features that each want an event (the exec guard's request interception, the dialog
   * watcher's) do not take turns replacing each other's list. A command that wants no event
   * named leaves the set as it is.
   */
  | {
      op: "cdp";
      tabId: number;
      method: string;
      params?: Record<string, unknown>;
      events?: string[];
      unrelayEvents?: string[];
    }
  /** Reply: the tab that was created, or an error when the far side cannot create one. */
  | { op: "open-tab"; url: string; activate: boolean }
  /** Reply: `{}`. */
  | { op: "close-tab"; tabId: number }
  /** Reply: `{}`. */
  | { op: "activate-tab"; tabId: number }
  /**
   * Writes cookies into the browser's own store, so a page the user is signed in to opens
   * signed in. The far side answers how many it took.
   *
   * The cookies are the shell's shape (Electron's `CookiesSetDetails`), and the far side is
   * the only one that has a cookie store to write to: the server cannot reach it.
   */
  | { op: "set-cookies"; cookies: BrowserCookie[] }
  /**
   * Empties the browser's store. The user asks for it; there is no agent-side verb for it,
   * because it throws away the sign-ins the import brought.
   */
  | { op: "clear-data"; storages: string[] };

/** An event the far side relays back. */
export type BrowserLinkEvent =
  /** A tab exists now (or changed). */
  | { kind: "tab"; tab: BrowserTab }
  /** A tab is gone. */
  | { kind: "tab-closed"; tabId: number }
  /**
   * window.open / target=_blank inside a page (the shell denied it and asks for a tab
   * instead), or the context menu's "Open link in new tab". `background`: the tab should open
   * behind the current one, as a middle-click or that menu entry does in Chrome.
   */
  | { kind: "open-request"; url: string; openerTabId: number; background?: boolean }
  /** One of the tab's CDP events a `cdp` command's `events` asked for. */
  | { kind: "cdp-event"; tabId: number; method: string; params: Record<string, unknown> }
  /**
   * The tab's renderer went away (Electron's render-process-gone reason and exit code). The
   * tab stays; it carries `crashed` until the page is reloaded, and the far side refuses CDP
   * commands for it meanwhile.
   */
  | { kind: "tab-crashed"; tabId: number; reason: string; exitCode: number }
  /**
   * The far side's measurement of the pages' load: each tab's memory and CPU, and the pages'
   * memory together, a process shared by two tabs counted once. The built-in browser sends one
   * every few seconds while it has any guests; a backend that does not measure never sends
   * one, and the one empty measurement after the last tab closes clears the last of them.
   */
  | {
      kind: "metrics";
      tabs: { tabId: number; memoryKB: number; cpuPercent: number }[];
      totalKB: number;
    };

/**
 * Why a request did not produce a result: the far side refused it (`message` is its own error
 * — a CDP error text, or `no_such_tab`, `tab_crashed`, `tab_released`,
 * `keyboard_focus_failed`), it did not answer in time, or the link closed under it.
 */
export class BrowserLinkError extends Error {
  constructor(
    readonly kind: "refused" | "timeout" | "closed",
    message: string,
  ) {
    super(message);
    this.name = "BrowserLinkError";
  }
}

/** How the errors name the browser the agent drives. */
export function browserLabel(backend: BrowserBackend): string {
  return backend === "builtin" ? "the built-in browser" : "your Chrome";
}

/** The shell's capabilities: it cannot create tabs (the Web App's `<webview>` does). */
export const BUILTIN_CAPABILITIES: BrowserBackendCapabilities = {
  createsTabs: false,
  throttles: true,
  cookieStore: true,
};

/** The extension's capabilities: it creates, closes and focuses its own tabs. */
export const CHROME_CAPABILITIES: BrowserBackendCapabilities = {
  createsTabs: true,
  throttles: false,
  cookieStore: false,
};

/**
 * The link to one backend's far side. The driver, the page scripts and the actions speak only
 * this, so a second backend is a new implementation rather than a new code path.
 */
export interface BrowserLink {
  readonly backend: BrowserBackend;
  readonly capabilities: BrowserBackendCapabilities;
  /**
   * Whether the far side has answered `hello` and is there now.
   *
   * A link that has not started yet may still be drivable: the headless browser starts on
   * the first call that needs it. So "not connected" is not the same as "cannot be
   * driven" — `canDrive` is the question that matters.
   */
  readonly connected: boolean;
  /**
   * Whether this link can be driven at all — either it is running, or it will start when
   * it is needed.
   */
  readonly canDrive: boolean;
  /** Sends one command and resolves with the far side's result. */
  request(command: BrowserCommand, timeoutMs?: number): Promise<unknown>;
  /**
   * True once the far side has answered `hello`. The shell's is tried (again, with `force`);
   * an extension's runs when its socket opens, so this answers false while there is none.
   */
  handshake(force?: boolean): Promise<boolean>;
  /** Every validated event, in order. Returns the unsubscribe. */
  onEvent(listener: (event: BrowserLinkEvent) => void): () => void;
  /** Runs after each successful handshake (the runtime refreshes its tabs here). */
  onConnect(listener: () => Promise<void> | void): () => void;
  /** The far side went away (an extension's socket closed); never for the shell. */
  onDisconnect(listener: () => void): () => void;
  dispose(): void;
}

/**
 * 409 `tab_released`: the user took the tab back from the agent, so it is no longer ours to
 * drive. The tab leaves the registry and an action on it says so.
 */
export function tabReleasedError(tabId: number): HttpError {
  return new HttpError(
    409,
    "tab_released",
    `Tab ${tabId} was taken back by the user, so the agent cannot drive it any more.`,
  );
}
