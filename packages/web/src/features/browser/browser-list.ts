/**
 * The agent browser's state in this window, as a tiny module-level store — the same shape as
 * terminal-list.ts, and for the same reason: the dock's tab strips and the browser panel
 * both read one list, and neither should own it.
 *
 * The server is the source of truth, and it PUSHES: `browser_state` arrives on the user
 * channel (GET /api/events) the moment a tab appears, closes or crashes, or a page is asked
 * for that a window has yet to open. So this store does not poll — it listens. A pull
 * (`GET /api/browser/status`) is the catch-up: the state a push carried is the same shape,
 * so a window that missed one (it was reconnecting) reads the whole thing and catches up.
 *
 * The one thing this store does not own is the `<webview>` element. Only the page can create
 * one, and only the page knows which element shows which tab — see browser-guests.ts.
 */
import type { BrowserStatus, BrowserTab } from "@prismshadow/jiumate-core/interfaces";

/** The tab the agent is using, or null when there is none. */
let activeTabId: number | null = null;
/** The live tabs, in the far side's order. */
let tabs: BrowserTab[] = [];
/** The open requests a window has yet to answer. */
let openRequests: BrowserStatus["openRequests"] = [];
/** Whether the backend can be driven now, and why not when it cannot. */
let available = false;
let reason: string | undefined;
let fingerprint = "";
let version = 0;
const listeners = new Set<() => void>();

function commit(next: {
  tabs: BrowserTab[];
  activeTabId: number | null;
  openRequests: BrowserStatus["openRequests"];
  available: boolean;
  reason?: string;
}): void {
  const nextFingerprint = JSON.stringify([
    next.tabs,
    next.activeTabId,
    next.openRequests,
    next.available,
    next.reason,
  ]);
  if (nextFingerprint === fingerprint) return;
  tabs = next.tabs;
  activeTabId = next.activeTabId;
  openRequests = next.openRequests ?? [];
  available = next.available;
  reason = next.reason;
  fingerprint = nextFingerprint;
  // A counter rather than the fingerprint itself: the panel's snapshot is a string, and a
  // long JSON of every tab would be compared on every render. The counter changes exactly
  // when the state did — including when a tab's title changed, which a count would miss.
  version += 1;
  for (const listener of [...listeners]) listener();
}

/**
 * A counter that changes whenever the state did. `useSyncExternalStore` wants a snapshot
 * whose identity is stable between changes; the counter is that.
 */
export function browserStateVersion(): number {
  return version;
}

/** The live tabs, in the far side's order. */
export function liveTabs(): BrowserTab[] {
  return tabs;
}

/** The tab the agent is using, or null when there is none. */
export function currentTabId(): number | null {
  return activeTabId;
}

/** One tab by id, or undefined. */
export function tabById(tabId: number): BrowserTab | undefined {
  return tabs.find((tab) => tab.id === tabId);
}

/** The open requests waiting to be claimed by a window that creates their tabs. */
export function pendingOpenRequests(): NonNullable<BrowserStatus["openRequests"]> {
  return openRequests ?? [];
}

/** Whether the backend can be driven now. */
export function browserAvailable(): boolean {
  return available;
}

/** Why the backend cannot be driven, when the server said so. */
export function browserUnavailableReason(): string | undefined {
  return reason;
}

/**
 * Takes the server's state, whether it arrived as a push or as the answer to a pull.
 */
export function noteBrowserState(state: BrowserStatus): void {
  commit({
    tabs: state.tabs ?? [],
    activeTabId: state.activeTabId ?? null,
    openRequests: state.openRequests,
    available: state.available,
    ...(state.reason !== undefined ? { reason: state.reason } : {}),
  });
}

/**
 * Subscribes to the state. Returns the unsubscribe. The caller opens the event stream that
 * carries the pushes; this only hands out the change notifications.
 */
export function subscribeBrowserState(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
