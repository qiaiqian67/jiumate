/**
 * The backend router: whichever browser the user chose, the tools talk to this.
 *
 * The choice is the user's, and it can change while the server runs. So the router holds
 * both links and picks one per call: the built-in one when the desktop shell is there and
 * the user asked for it, the headless one otherwise.
 *
 * The router is a `BrowserLink` like any other, so the driver, the actions, the scripts and
 * the tools are unchanged by the choice. What it adds is the ability to answer for a
 * backend that is not there: a server with no shell still has the headless browser, and a
 * user who has not chosen anything still gets the one that is available.
 */
import type { BrowserBackend } from "@jadelau/core/interfaces";
import type { BrowserCommand, BrowserLink, BrowserLinkEvent } from "./link.js";
import { BrowserLinkError } from "./link.js";

export interface BackendRouterOptions {
  /** The desktop shell's browser; null without a shell. */
  builtin: BrowserLink | null;
  /** The headless browser; always available in principle — it starts on first use. */
  headless: () => BrowserLink;
  /** Which backend the user chose; the router falls back when it is not there. */
  chosen: () => BrowserBackend;
  /** Whether the desktop shell is there at all. */
  hasDesktop: () => boolean;
}

/**
 * Picks the backend for each call.
 *
 * The choice is honoured when it can be: `builtin` needs the shell, and `chrome` is not
 * implemented yet, so either falls back to what is there. The fallback is never a failure —
 * a browser that works beats the one the user asked for not working.
 */
export class BackendRouter implements BrowserLink {
  private readonly listeners = new Set<(event: BrowserLinkEvent) => void>();
  private readonly connectListeners = new Set<() => Promise<void> | void>();
  private readonly disconnectListeners = new Set<() => void>();
  private readonly unsubscribes: (() => void)[] = [];
  private routed: BrowserLink | null = null;

  constructor(private readonly opts: BackendRouterOptions) {}

  get backend(): BrowserBackend {
    return this.current().backend;
  }

  get capabilities(): BrowserLink["capabilities"] {
    return this.current().capabilities;
  }

  get connected(): boolean {
    return this.current().connected;
  }

  get canDrive(): boolean {
    return this.current().canDrive;
  }

  /** The link a call goes to. */
  private current(): BrowserLink {
    const wanted = this.opts.chosen();
    if (wanted === "builtin" && this.opts.builtin !== null) {
      return this.opts.builtin;
    }
    if (wanted === "chrome") {
      // Not implemented yet: the built-in one is the closest thing that works.
      if (this.opts.builtin !== null) return this.opts.builtin;
    }
    if (wanted === "headless") {
      return this.headless();
    }
    // Nothing was chosen, or the one that was chosen is not there: the headless browser is
    // the one that works everywhere.
    if (this.opts.builtin === null || !this.opts.hasDesktop()) {
      return this.headless();
    }
    return this.opts.builtin;
  }

  /** The headless link, created once and kept. */
  private headless(): BrowserLink {
    if (this.routed === null) {
      this.routed = this.opts.headless();
      this.attach(this.routed);
    }
    return this.routed;
  }

  /** Listens to a link's events, so the router relays whichever one is in use. */
  private attach(link: BrowserLink): void {
    this.unsubscribes.push(
      link.onEvent((event) => {
        for (const listener of [...this.listeners]) {
          try {
            listener(event);
          } catch {
            // A listener's failure is its own.
          }
        }
      }),
    );
    this.unsubscribes.push(
      link.onConnect(() => {
        for (const listener of [...this.connectListeners]) {
          try {
            void listener();
          } catch {
            // A listener's failure is its own.
          }
        }
      }),
    );
    this.unsubscribes.push(
      link.onDisconnect(() => {
        for (const listener of [...this.disconnectListeners]) {
          try {
            listener();
          } catch {
            // A listener's failure is its own.
          }
        }
      }),
    );
  }

  async request(command: BrowserCommand, timeoutMs?: number): Promise<unknown> {
    const link = this.current();
    // The first call to the headless browser starts it; that takes longer than a normal
    // command, so the timeout is the generous one.
    const limit = link === this.routed ? Math.max(timeoutMs ?? 0, 40_000) : timeoutMs;
    return link.request(command, limit);
  }

  async handshake(force = false): Promise<boolean> {
    const link = this.current();
    const ok = await link.handshake(force);
    if (!ok) {
      // The link that failed may not be the one that would work: try the other before
      // giving up, because "no browser" and "that browser is broken" are different answers.
      const other = link === this.opts.builtin ? this.headless() : this.opts.builtin;
      if (other === null) return false;
      return other.handshake(force);
    }
    return true;
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
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.unsubscribes.length = 0;
    this.listeners.clear();
    this.connectListeners.clear();
    this.disconnectListeners.clear();
    this.routed?.dispose();
    this.routed = null;
  }
}

/** The link's own way of saying "there is no browser". */
export function noBrowserError(reason: string): BrowserLinkError {
  return new BrowserLinkError("refused", reason);
}
