/**
 * A fake far side for the browser tests: it answers the link's commands the way a shell or an
 * extension would — one result per command, tab events pushed as they happen — and its CDP
 * answers come from a handler each test supplies.
 */
import type {
  BrowserBackend,
  BrowserBackendCapabilities,
  BrowserTab,
} from "@prismshadow/jiumate-core/interfaces";
import type { BrowserCommand, BrowserLink, BrowserLinkEvent } from "../../src/browser/link.js";
import { BrowserLinkError } from "../../src/browser/link.js";

export type CdpHandler = (
  tabId: number,
  method: string,
  params: Record<string, unknown> | undefined,
) => unknown;

/** A tab as the far side reports it. */
export function tab(id: number, patch: Partial<BrowserTab> = {}): BrowserTab {
  return {
    id,
    url: `https://example.test/${id}`,
    title: `Page ${id}`,
    loading: false,
    canGoBack: false,
    canGoForward: false,
    ...patch,
  };
}

/** A Runtime.evaluate answer carrying `value`, as CDP returns one by value. */
export function evaluated(value: unknown): unknown {
  return value === undefined
    ? { result: { type: "undefined" } }
    : { result: { type: typeof value, value } };
}

/** The expression a Runtime.evaluate command carries. */
export function expressionOf(params: Record<string, unknown> | undefined): string {
  return typeof params?.expression === "string" ? params.expression : "";
}

export class FakeLink implements BrowserLink {
  readonly backend: BrowserBackend = "builtin";
  capabilities: BrowserBackendCapabilities = {
    createsTabs: false,
    throttles: true,
    cookieStore: true,
  };
  connected = true;
  readonly tabs = new Map<number, BrowserTab>();
  readonly commands: BrowserCommand[] = [];
  /** Answers `cdp`; throw to make the far side refuse the command with that message. */
  cdp: CdpHandler = () => ({});
  /** The CDP events the far side relays per tab, as the union of what every command asked for. */
  readonly relayed = new Map<number, Set<string>>();
  /** What each command asked to be relayed, in order — the sequence the protocol is about. */
  readonly relayLog: { tabId: number; events: string[]; unrelayEvents: string[] }[] = [];
  /** The requests the far side pauses once the interception is on. */
  pausedRequests: { requestId: string; url: string }[] = [];

  private readonly listeners = new Set<(event: BrowserLinkEvent) => void>();
  private readonly connectListeners = new Set<() => Promise<void> | void>();
  private readonly disconnectListeners = new Set<() => void>();

  async request(command: BrowserCommand, _timeoutMs?: number): Promise<unknown> {
    this.commands.push(command);
    switch (command.op) {
      case "hello":
        return { version: 1 };
      case "tabs":
        return { tabs: [...this.tabs.values()] };
      case "open-tab": {
        const created = tab(100 + this.tabs.size, { url: command.url });
        this.tabs.set(created.id, created);
        this.event({ kind: "tab", tab: created });
        return { tabId: created.id };
      }
      case "close-tab": {
        this.tabs.delete(command.tabId);
        this.event({ kind: "tab-closed", tabId: command.tabId });
        return {};
      }
      case "activate-tab":
        return {};
      case "cdp": {
        if (!this.tabs.has(command.tabId)) {
          throw new BrowserLinkError("refused", "no_such_tab");
        }
        if (this.tabs.get(command.tabId)?.crashed !== undefined) {
          throw new BrowserLinkError("refused", "tab_crashed");
        }
        const relayed = this.relayed.get(command.tabId) ?? new Set<string>();
        this.relayLog.push({
          tabId: command.tabId,
          events: command.events ?? [],
          unrelayEvents: command.unrelayEvents ?? [],
        });
        for (const event of command.events ?? []) relayed.add(event);
        for (const event of command.unrelayEvents ?? []) relayed.delete(event);
        this.relayed.set(command.tabId, relayed);
        try {
          const result = await this.cdp(command.tabId, command.method, command.params);
          if (command.method === "Fetch.enable") this.pauseRequests(command.tabId);
          return result;
        } catch (err) {
          // The far side refuses a command; the link's contract says so in its own error type.
          throw new BrowserLinkError("refused", err instanceof Error ? err.message : String(err));
        }
      }
    }
  }

  async handshake(): Promise<boolean> {
    return this.connected;
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

  dispose(): void {
    this.listeners.clear();
  }

  /** A frame from the far side. */
  event(event: BrowserLinkEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }

  /**
   * The far side pauses the requests it was asked to intercept, as `Fetch` does. They are
   * raised as the interception is turned on, which is while the script that asked for it is
   * still running — a request paused after the script ended would be answered by nobody.
   */
  private pauseRequests(tabId: number): void {
    for (const request of this.pausedRequests) {
      this.event({
        kind: "cdp-event",
        tabId,
        method: "Fetch.requestPaused",
        params: { requestId: request.requestId, request: { url: request.url } },
      });
    }
  }

  /** A tab appears. */
  show(t: BrowserTab): void {
    this.tabs.set(t.id, t);
    this.event({ kind: "tab", tab: t });
  }

  /** A tab is gone. */
  close(tabId: number): void {
    this.tabs.delete(tabId);
    this.event({ kind: "tab-closed", tabId });
  }

  /** A tab's renderer died. */
  crash(tabId: number, reason = "crashed"): void {
    const crashed = { ...this.tabs.get(tabId)!, loading: false, crashed: reason };
    this.tabs.set(tabId, crashed);
    this.event({ kind: "tab-crashed", tabId, reason, exitCode: 9 });
    this.event({ kind: "tab", tab: crashed });
  }
}
