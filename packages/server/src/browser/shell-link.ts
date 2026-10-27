/**
 * The link to the desktop shell's built-in browser: one command per round trip over the
 * utilityProcess `parentPort` the desktop app shares with the server, and the shell's events
 * relayed back.
 *
 * Wire shape: a command goes out as `{ type: "desktop-browser-command", id, command }` and the
 * shell answers with `{ type: "desktop-browser-reply", id, ok, result }` or `{ ..., ok: false,
 * error }`. The shell's own events arrive as `{ type: "desktop-browser-event", event }`. The
 * `id` is generated here, so a reply from a previous round cannot fulfil a fresh request.
 *
 * The shell is the far side: it owns the `<webview>` guests and runs their CDP. This link does
 * not know how — it sends a command and waits for the answer.
 */
import { randomUUID } from "node:crypto";
import type { BrowserBackend, BrowserBackendCapabilities } from "@jadelau/core/interfaces";
import { BrowserLinkError } from "./link.js";
import type { BrowserCommand, BrowserLink, BrowserLinkEvent } from "./link.js";

/** The slice of Electron's ParentPort this link uses. */
export interface ShellPort {
  on(event: "message", listener: (e: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

/** How long a command may take before the link gives up on it. */
const DEFAULT_COMMAND_TIMEOUT_MS = 35_000;

interface PendingCommand {
  resolve: (result: unknown) => void;
  reject: (err: BrowserLinkError) => void;
  timer: NodeJS.Timeout;
}

/** A command as it travels to the shell. */
export interface BrowserCommandMessage {
  type: "desktop-browser-command";
  id: string;
  command: BrowserCommand;
}

/** The shell's answer to one command. */
export interface BrowserReplyMessage {
  type: "desktop-browser-reply";
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

/** The shell's event. */
export interface BrowserEventMessage {
  type: "desktop-browser-event";
  event: BrowserLinkEvent;
}

/** Whether a frame is the shell's answer to a command. */
export function parseBrowserReply(data: unknown): BrowserReplyMessage | null {
  if (typeof data !== "object" || data === null) return null;
  const m = data as Partial<BrowserReplyMessage>;
  if (m.type !== "desktop-browser-reply") return null;
  if (typeof m.id !== "string") return null;
  if (typeof m.ok !== "boolean") return null;
  if (m.error !== undefined && typeof m.error !== "string") return null;
  return m as BrowserReplyMessage;
}

/** Whether a frame is one of the shell's events. */
export function parseBrowserEvent(data: unknown): BrowserEventMessage | null {
  if (typeof data !== "object" || data === null) return null;
  const m = data as Partial<BrowserEventMessage>;
  if (m.type !== "desktop-browser-event") return null;
  if (typeof m.event !== "object" || m.event === null) return null;
  return m as BrowserEventMessage;
}

export interface ShellLinkOptions {
  backend: BrowserBackend;
  capabilities: BrowserBackendCapabilities;
  /** Sends one message to the shell. */
  send: (message: BrowserCommandMessage) => void;
  timeoutMs?: number;
}

export class ShellLink implements BrowserLink {
  readonly backend: BrowserBackend;
  readonly capabilities: BrowserBackendCapabilities;
  connected = false;
  /**
   * Whether the shell's browser can be driven.
   *
   * The shell may not have started yet — the desktop app starts it and the port is wired
   * later — so "not connected yet" is not "cannot be driven". The browser is reported as
   * unavailable until the shell answers, but a call is not refused for that.
   */
  readonly canDrive = true;

  private readonly send: (message: BrowserCommandMessage) => void;
  private readonly timeoutMs: number;
  private readonly pending = new Map<string, PendingCommand>();
  private readonly listeners = new Set<(event: BrowserLinkEvent) => void>();
  private readonly connectListeners = new Set<() => Promise<void> | void>();
  private readonly disconnectListeners = new Set<() => void>();

  constructor(opts: ShellLinkOptions) {
    this.backend = opts.backend;
    this.capabilities = opts.capabilities;
    this.send = opts.send;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  }

  /**
   * Starts listening on the port. The port arrives after this link was made (index.ts hands it
   * over once the shell's message channel exists), so the listener is registered here rather
   * than in the constructor.
   */
  listen(port: ShellPort): void {
    port.on("message", (e) => this.receive(e.data));
  }

  private receive(data: unknown): void {
    const reply = parseBrowserReply(data);
    if (reply !== null) {
      const entry = this.pending.get(reply.id);
      if (entry === undefined) return;
      this.pending.delete(reply.id);
      clearTimeout(entry.timer);
      if (reply.ok) {
        entry.resolve(reply.result);
        return;
      }
      entry.reject(
        new BrowserLinkError("refused", reply.error ?? "The browser refused the command."),
      );
      return;
    }
    const event = parseBrowserEvent(data);
    if (event !== null) {
      for (const listener of [...this.listeners]) listener(event.event);
    }
  }

  async request(command: BrowserCommand, timeoutMs?: number): Promise<unknown> {
    const id = randomUUID();
    const deadline = timeoutMs ?? this.timeoutMs;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new BrowserLinkError("timeout", `The browser did not answer in ${deadline}ms.`));
      }, deadline);
      timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      this.send({ type: "desktop-browser-command", id, command });
    });
  }

  async handshake(force = false): Promise<boolean> {
    if (this.connected && !force) return true;
    try {
      await this.request({ op: "hello" }, 5_000);
      this.connected = true;
      for (const listener of [...this.connectListeners]) await listener();
      return true;
    } catch {
      this.connected = false;
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

  /** The shell went away: everything in flight fails, and the listeners are told. */
  drop(): void {
    this.connected = false;
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new BrowserLinkError("closed", "The browser's link closed."));
    }
    this.pending.clear();
    for (const listener of [...this.disconnectListeners]) listener();
  }

  dispose(): void {
    this.drop();
    this.listeners.clear();
    this.connectListeners.clear();
    this.disconnectListeners.clear();
  }
}
