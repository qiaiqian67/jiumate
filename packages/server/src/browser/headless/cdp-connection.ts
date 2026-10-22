/**
 * A raw CDP client over a WebSocket: the protocol Chrome speaks, nothing more.
 *
 * It is the same wire the built-in browser's shell speaks, but the socket here is ours — the
 * browser is ours too, and it is not on the other end of the desktop app's port. So a command
 * goes straight out and the answer comes straight back, with no shell in between.
 *
 * The socket is the browser's own debugger endpoint: Chrome is started with
 * `--remote-debugging-port=0` and writes the port it took into `DevToolsActivePort` in its
 * user-data directory. That is how a client finds a browser it launched without guessing a
 * port and racing another process for it.
 */
import { WebSocket } from "ws";

/** One CDP message, as it travels. */
interface CdpMessage {
  id?: number;
  method?: string;
  params?: unknown;
  sessionId?: string;
  result?: unknown;
  error?: { code: number; message: string; data?: string };
}

/** A CDP event, as the far side reports it. */
export interface CdpEvent {
  method: string;
  params: Record<string, unknown>;
  /** The session the event belongs to; undefined for the browser's own events. */
  sessionId?: string;
}

/** A CDP command's failure. */
export class CdpError extends Error {
  readonly code: number;
  readonly data: string | undefined;
  constructor(code: number, message: string, data?: string) {
    super(message);
    this.name = "CdpError";
    this.code = code;
    this.data = data;
  }
}

/** How long a command may take before it is given up on. */
const DEFAULT_TIMEOUT_MS = 30_000;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * A connection to one browser's CDP endpoint.
 *
 * It is deliberately thin: it sends commands and reports events. What the commands *mean* is
 * the driver's business, and what a page does with them is the page's.
 */
export class CdpConnection {
  private readonly socket: WebSocket;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Set<(event: CdpEvent) => void>();
  private nextId = 1;
  private closed = false;
  private closeReason: string | null = null;

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.on("message", (data: Buffer) => this.onMessage(data.toString("utf8")));
    socket.on("close", () => this.onClose("The browser's connection closed."));
    socket.on("error", (err: Error) => this.onClose(err.message));
  }

  /** Opens a connection to a browser's debugger endpoint. */
  static async connect(url: string, timeoutMs = 15_000): Promise<CdpConnection> {
    const socket = new WebSocket(url, {
      perMessageDeflate: false,
      maxPayload: 256 * 1024 * 1024,
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("The browser did not answer in time."));
        socket.close();
      }, timeoutMs);
      timer.unref?.();
      socket.once("open", () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once("error", (err: Error) => {
        clearTimeout(timer);
        reject(err);
      });
    });
    return new CdpConnection(socket);
  }

  /** Whether the connection is still usable. */
  get isOpen(): boolean {
    return !this.closed;
  }

  /** Sends one command and resolves with its result. */
  async send(
    method: string,
    params: Record<string, unknown> = {},
    options: { sessionId?: string; timeoutMs?: number } = {},
  ): Promise<unknown> {
    if (this.closed) {
      throw new CdpError(-1, this.closeReason ?? "The browser's connection is closed.");
    }
    const id = this.nextId++;
    const message: Record<string, unknown> = { id, method, params };
    if (options.sessionId !== undefined) message["sessionId"] = options.sessionId;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CdpError(-1, `The browser did not answer ${method} in ${timeoutMs}ms.`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.socket.send(JSON.stringify(message));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /** Every event the browser reports, in order. Returns the unsubscribe. */
  onEvent(listener: (event: CdpEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Closes the connection; every command in flight fails. */
  close(): void {
    this.onClose("The browser's connection was closed.");
    try {
      this.socket.close();
    } catch {
      // Already gone.
    }
  }
  private onMessage(text: string): void {
    let message: CdpMessage;
    try {
      message = JSON.parse(text) as CdpMessage;
    } catch {
      return;
    }
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (pending === undefined) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error !== undefined) {
        pending.reject(new CdpError(message.error.code, message.error.message, message.error.data));
        return;
      }
      pending.resolve(message.result);
      return;
    }
    if (message.method === undefined) return;
    const event: CdpEvent = {
      method: message.method,
      params: (message.params ?? {}) as Record<string, unknown>,
      ...(message.sessionId !== undefined ? { sessionId: message.sessionId } : {}),
    };
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // A listener's failure is its own; the connection stays.
      }
    }
  }

  private onClose(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.closeReason = reason;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new CdpError(-1, reason));
    }
    this.pending.clear();
  }
}
