/**
 * The tab registry: what the far side reports (its `tab` / `tab-closed` events, and the full
 * list it answers after each handshake), which tab is active, and the tabs that were asked for
 * but do not exist yet.
 *
 * The far side is the truth about which tabs exist; this is its reflection plus two facts it
 * does not have. The active tab is the last one the agent used or the user focused, and falls
 * back to the most recently created one. An open request is a tab the server asked for (a
 * popup the far side turned into a request): the page creates it, learns its id, and claims the
 * request with it — the first claim wins, and a second window's claim is a duplicate it should
 * remove.
 */
import { randomUUID } from "node:crypto";
import type { BrowserTab } from "@jiumate/core/interfaces";

/** How long an unclaimed open request stays claimable. */
const OPEN_REQUEST_TTL_MS = 60_000;

export interface OpenRequest {
  requestId: string;
  url: string;
  /** Whether the tab becomes the active one once it exists. */
  activate: boolean;
  /** The tab whose popup (or "Open link in new tab") this is. */
  openerTabId?: number;
  createdAt: number;
  /** The tab that claimed it; null until then. */
  claimedTabId: number | null;
}

interface OpenState extends OpenRequest {
  waiters: Set<(tabId: number | null) => void>;
}

export type ClaimOutcome = "claimed" | "duplicate" | "unknown";

/** How the registry reports a tab that is not there. */
export class UnknownTabError extends Error {
  constructor(readonly tabId: number) {
    super(`Tab ${tabId} is not open.`);
    this.name = "UnknownTabError";
  }
}

export class TabRegistry {
  /** The tabs the far side reports, by id. */
  private readonly tabs = new Map<number, BrowserTab>();
  /** The id of the active tab; null when there is none. */
  private activeTabId: number | null = null;
  /** The open requests waiting to be claimed. */
  private readonly opens = new Map<string, OpenState>();
  /** The order the tabs were created in, so "the most recent" is defined without a timestamp. */
  private readonly order: number[] = [];

  /** Replaces the whole list, as the far side answers it after a handshake. */
  replace(tabs: BrowserTab[]): void {
    this.tabs.clear();
    this.order.length = 0;
    for (const tab of tabs) this.tabs.set(tab.id, tab);
    this.order.push(...tabs.map((tab) => tab.id));
    if (this.activeTabId !== null && !this.tabs.has(this.activeTabId)) this.activeTabId = null;
  }

  /** One tab, or undefined. */
  get(tabId: number): BrowserTab | undefined {
    return this.tabs.get(tabId);
  }

  /** Every tab, in the order the far side listed them. */
  list(): BrowserTab[] {
    return this.order
      .map((id) => this.tabs.get(id))
      .filter((tab): tab is BrowserTab => tab !== undefined);
  }

  /** The ids of every tab. */
  ids(): number[] {
    return [...this.tabs.keys()];
  }

  /** The active tab's id, or null. */
  active(): number | null {
    return this.activeTabId;
  }

  /**
   * Makes a tab the active one — every agent action names a tab and makes it the active one,
   * so the browser the user is looking at is the one the agent is using. Falls back to the
   * most recently created tab when the id is not one of ours.
   */
  activate(tabId: number): BrowserTab {
    const tab = this.tabs.get(tabId);
    if (tab === undefined) throw new UnknownTabError(tabId);
    this.activeTabId = tabId;
    return tab;
  }

  /** The active tab, or the most recently created one, or undefined when there is none. */
  current(): BrowserTab | undefined {
    if (this.activeTabId !== null) {
      const tab = this.tabs.get(this.activeTabId);
      if (tab !== undefined) return tab;
    }
    for (let i = this.order.length - 1; i >= 0; i--) {
      const tab = this.tabs.get(this.order[i]!);
      if (tab !== undefined) return tab;
    }
    return undefined;
  }

  /** A tab appeared (or changed). */
  upsert(tab: BrowserTab): void {
    if (!this.tabs.has(tab.id)) this.order.push(tab.id);
    this.tabs.set(tab.id, tab);
  }

  /** A tab is gone. */
  remove(tabId: number): void {
    this.tabs.delete(tabId);
    const at = this.order.indexOf(tabId);
    if (at >= 0) this.order.splice(at, 1);
    if (this.activeTabId === tabId) this.activeTabId = null;
  }

  /** A tab's renderer went away: the tab stays, but it carries the crash until it is reloaded. */
  markCrashed(tabId: number, reason: string): void {
    const tab = this.tabs.get(tabId);
    if (tab === undefined) return;
    this.tabs.set(tabId, { ...tab, crashed: reason });
  }

  /** Records an open request, so the tab that answers it can claim it. */
  requestOpen(url: string, opts: { activate: boolean; openerTabId?: number }): OpenRequest {
    const request: OpenRequest = {
      requestId: randomUUID(),
      url,
      activate: opts.activate,
      ...(opts.openerTabId !== undefined ? { openerTabId: opts.openerTabId } : {}),
      createdAt: Date.now(),
      claimedTabId: null,
    };
    this.opens.set(request.requestId, { ...request, waiters: new Set() });
    this.expireOpens();
    return request;
  }

  /**
   * The open request a newly created tab answers. The first claim wins; a second window
   * claiming the same request is a duplicate and is told so.
   *
   * A claimed request leaves the pending list at once: the tab exists now, so a panel that
   * is still asking has nothing left to do for it. It is not deleted outright, though — the
   * request stays as the record of what the tab was opened for, and a late second claim is
   * still told it is a duplicate rather than "unknown".
   */
  claim(tabId: number, requestId: string): ClaimOutcome {
    const state = this.opens.get(requestId);
    if (state === undefined) return "unknown";
    if (state.claimedTabId !== null) return "duplicate";
    state.claimedTabId = tabId;
    if (state.activate) this.activeTabId = tabId;
    for (const waiter of state.waiters) waiter(tabId);
    return "claimed";
  }

  /**
   * Waits for an open request to be claimed, and answers the tab's id — or null when the
   * request expired or was never claimed.
   */
  waitForClaim(requestId: string, timeoutMs: number): Promise<number | null> {
    const state = this.opens.get(requestId);
    if (state === undefined) return Promise.resolve(null);
    if (state.claimedTabId !== null) return Promise.resolve(state.claimedTabId);
    return new Promise<number | null>((resolve) => {
      const waiter = (tabId: number | null): void => {
        clearTimeout(timer);
        this.opens.delete(requestId);
        resolve(tabId);
      };
      const timer = setTimeout(() => {
        state.waiters.delete(waiter);
        this.opens.delete(requestId);
        resolve(null);
      }, timeoutMs);
      state.waiters.add(waiter);
    });
  }

  /** The open requests a tab asked for since a moment in time (its popups). */
  opensFrom(openerTabId: number, since: number): OpenRequest[] {
    const found: OpenRequest[] = [];
    for (const state of this.opens.values()) {
      if (state.openerTabId === openerTabId && state.createdAt >= since) found.push(state);
    }
    return found;
  }

  /**
   * Every open request still waiting to be claimed. This is how a panel learns there is
   * something to create: the server records the request and waits, because only a page can
   * make the `<webview>` element the guest is hosted in. A request nobody claims expires on
   * its own, so this list is never stale — it is bounded by time rather than by a sweep.
   *
   * A claimed request is not among them: its tab exists, so there is nothing left to create.
   */
  pendingOpens(): OpenRequest[] {
    return [...this.opens.values()]
      .filter((state) => state.claimedTabId === null)
      .map((state) => ({
        requestId: state.requestId,
        url: state.url,
        activate: state.activate,
        ...(state.openerTabId !== undefined ? { openerTabId: state.openerTabId } : {}),
        createdAt: state.createdAt,
        claimedTabId: state.claimedTabId,
      }));
  }

  /** Drops the open requests nobody claimed in time. */
  private expireOpens(): void {
    const cutoff = Date.now() - OPEN_REQUEST_TTL_MS;
    for (const [id, state] of this.opens) {
      if (state.createdAt < cutoff) {
        this.opens.delete(id);
        for (const waiter of state.waiters) waiter(null);
      }
    }
  }
}
