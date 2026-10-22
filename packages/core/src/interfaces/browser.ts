/**
 * The agent browser, as the `browser_read` / `browser_act` tools see it.
 *
 * A browser is a host surface rather than a file: the tabs belong to the desktop app's browser
 * panel, and which backend drives them is a user preference. So the tools own no state and
 * touch no disk — they call the `BrowserPort` their host injected, and a host with no browser
 * surface reports that rather than failing with an errno.
 *
 * Read and write are separate ports on purpose. Reading a page is what an agent does constantly
 * and it changes nothing, so it rides the approval flow as `r`. Clicking, typing and running
 * script in a page act on the user's behalf — a click can submit an order — so those are `rw`
 * and go through approval. One tool with one permission would force the frequent read to carry
 * the weight of the rare write.
 *
 * What differs between backends (the desktop's built-in browser, the user's own Chrome) is
 * declared through `BrowserBackendCapabilities` rather than discovered: the tools branch on it
 * the same way the runtime does, and neither tool picks a backend — that is the user's choice.
 */

// ---------------------------------------------------------------------------
// Backends
// ---------------------------------------------------------------------------

/** The browser an agent drives. */
export type BrowserBackend = "builtin" | "chrome";

/**
 * What a backend's link can do. The desktop shell cannot create tabs (the Web App's `<webview>`
 * does, and the server only asks) and throttles and measures its guests; the Chrome extension
 * creates, closes and focuses tabs itself and has no cookie store the server may touch.
 */
export interface BrowserBackendCapabilities {
  /** `open`, `close` and focusing a named tab are answered here (chrome). */
  createsTabs: boolean;
  /** `throttle` and the load measurements (builtin). */
  throttles: boolean;
  /** `set_cookies` / `clear_data` (builtin). */
  cookieStore: boolean;
}

/**
 * Why the agent browser cannot be driven. Built-in: not under the desktop shell, a shell too old
 * to host it, or no app window to host a new tab.
 */
export type BrowserUnavailableReason = "not_desktop" | "shell_unsupported" | "no_window";

/** One backend as the status action lists it for the model. */
export interface BrowserBackendInfo {
  backend: BrowserBackend;
  available: boolean;
  reason?: BrowserUnavailableReason;
}

/**
 * One tab of the agent browser. Built-in: a guest page, `id` its webContents id. Chrome: a tab
 * the extension drives, `id` Chrome's tab id.
 */
export interface BrowserTab {
  id: number;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /**
   * Present while the page's renderer is gone, with the shell's reason (`crashed`, `oom`, …): an
   * action on such a tab fails until the page is reloaded.
   */
  crashed?: string;
}

/** Whether the browser can be driven now, and what it holds. */
export interface BrowserStatus {
  available: boolean;
  reason?: BrowserUnavailableReason;
  backend: BrowserBackend;
  backends: BrowserBackendInfo[];
  tabs: BrowserTab[];
  activeTabId: number | null;
  /**
   * The open requests a window has yet to answer. A request is a page someone asked for
   * (the agent, or a popup inside a page) that only a page can create: the guest is hosted
   * in a `<webview>` element, and the Web App's browser panel is what makes one. Until it
   * does, the request waits here and expires on its own.
   */
  openRequests?: BrowserOpenRequest[];
}

/**
 * One page that was asked for and has no tab yet. The panel creates a `<webview>` for it,
 * learns the guest's id, and claims it; a second window claiming the same request is told it
 * made a duplicate, and removes the element it made.
 */
export interface BrowserOpenRequest {
  requestId: string;
  url: string;
  /** Whether the tab becomes the active one once it exists. */
  activate: boolean;
  /** The tab whose popup (or "Open link in new tab") asked for it. */
  openerTabId?: number;
  /** When the request was recorded, as epoch milliseconds. */
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Action results
// ---------------------------------------------------------------------------

/** A page read: simplified HTML, or plain text with `text_only`. */
export interface BrowserScanResult {
  tab: BrowserTab;
  content: string;
  truncated?: boolean;
}

/** A dialog the page opened during an act, which the call answered so the page would not block. */
export interface BrowserDialog {
  type: "alert" | "confirm" | "prompt" | "beforeunload";
  message: string;
  accepted: boolean;
}

/** What an act on the page produced. */
export interface BrowserExecResult {
  status: "success" | "failed";
  tabId: number;
  /** The script's JSON-safe return value (exec only). */
  value?: unknown;
  error?: string;
  /** The page navigated or reloaded while the script ran. */
  reloaded?: boolean;
  /** Tabs opened while the call ran (popups, target=_blank). */
  newTabs?: { id: number; url: string }[];
  /** Text that appeared during the call and may be gone again (toasts, flashes). */
  transients?: string[];
  diff?: { changed: number; topChange?: string };
  /**
   * A note for the model about what to do next, when the action's own result is not enough:
   * that a popup opened and is listed under `newTabs`, or that nothing on the page changed.
   */
  suggestion?: string;
  /** click only: where the trusted click landed. */
  clicked?: { x: number; y: number; tag?: string; text?: string };
  /** The page's dialogs the call answered, in order. */
  dialogs?: BrowserDialog[];
}

/** A screenshot of the tab's current viewport. */
export interface BrowserScreenshot {
  mime: "image/png";
  /** Base64, without the data URL prefix — the tools build the `data:` URL for `ToolResult.images`. */
  data: string;
}

// ---------------------------------------------------------------------------
// The port
// ---------------------------------------------------------------------------

/** Which tab an action applies to, and what it does. */
export interface BrowserActRequest {
  action: "click" | "type" | "exec";
  /** Defaults to the active tab. */
  tabId?: number;
  /** click: the CSS selector to click, or the text to match. */
  selector?: string;
  /** type: the text to enter. */
  text?: string;
  /** exec: the script to run in the page; its return value comes back as `value`. */
  script?: string;
  /** Whether the page's alert/confirm/prompt dialogs are accepted rather than dismissed. */
  acceptDialogs?: boolean;
}

/**
 * Host-provided control over the agent browser, injected by hosts that have one (the Web
 * server). Absent in SDK/CLI standalone use and anywhere without a browser surface — the tools
 * then report that the browser cannot be driven rather than failing.
 *
 * Every call that acts on a page names a tab (the active one included) and makes it the active
 * one, so the browser the user is looking at is the one the agent is using.
 */
export interface BrowserPort {
  /** Whether a backend can be driven now, and which one, and what tabs it holds. */
  status(): Promise<BrowserStatus>;
  /** Navigates a tab and waits for the load; opens one when the backend creates its own tabs. */
  open(url: string, options?: { newTab?: boolean; tabId?: number }): Promise<BrowserStatus>;
  /** Closes a tab, or the active one. */
  close(tabId?: number): Promise<BrowserStatus>;
  /** Reads a page as simplified HTML, or as plain text with `text_only`. */
  scan(options?: { tabId?: number; textOnly?: boolean }): Promise<BrowserScanResult>;
  /** Clicks, types or runs script in a page. */
  act(request: BrowserActRequest): Promise<BrowserExecResult>;
  /** The tab's current viewport. */
  screenshot(options?: { tabId?: number }): Promise<BrowserScreenshot>;
}
