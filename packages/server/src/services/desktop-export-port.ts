/**
 * Server-side adapter that hands a "render this HTML to PDF" request to the desktop shell
 * over the utilityProcess `parentPort` and waits for the result. The shell owns the
 * `BrowserWindow` and the `printToPDF` call; the server just packages the request and
 * surfaces the result.
 *
 * Wire shape: {@link DesktopExportRequest} / {@link DesktopExportResult}
 * (api/desktop-export.ts). One `requestId` per call, generated here; the shell echoes it
 * back, so a result from a previous round of the port's `on("message", ...)` listener
 * cannot accidentally fulfil a fresh request.
 *
 * Non-desktop: the port is null (`shellPortOf` returns null under plain Node — see
 * services/desktop-update-port.ts:51-56), the export route answers 503
 * `pdf_unavailable_in_cli`. There is no "fake" client in tests — the constructor takes
 * a `send` callback so unit tests can script the round trip.
 */
import { randomUUID } from "node:crypto";
import { HttpError } from "../http/errors.js";
import type { DesktopExportRequest, DesktopExportResult } from "../api/desktop-export.js";

/** The slice of Electron's ParentPort this relay uses. Mirrors desktop-update-port.ts. */
export interface ShellPort {
  on(event: "message", listener: (e: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

/** The deadline a single PDF render is allowed to run, including hidden-window setup. */
const DEFAULT_PRINT_TIMEOUT_MS = 30_000;

interface PendingRequest {
  resolve: (bytes: Buffer) => void;
  reject: (err: HttpError) => void;
  timer: NodeJS.Timeout;
}

/** Strict shape check; defensive against a future wire bump landing before the shell. */
export function parseExportResult(data: unknown): DesktopExportResult | null {
  if (typeof data !== "object" || data === null) return null;
  const m = data as Partial<DesktopExportResult>;
  if (m.type !== "desktop-export-pdf-result") return null;
  if (typeof m.requestId !== "string") return null;
  if (m.bytes !== undefined && !(m.bytes instanceof Uint8Array || Buffer.isBuffer(m.bytes))) {
    return null;
  }
  if (m.error !== undefined && typeof m.error !== "string") return null;
  return m as DesktopExportResult;
}

export class DesktopExportPort {
  private readonly pending = new Map<string, PendingRequest>();

  constructor(
    private readonly send: (msg: DesktopExportRequest) => void,
    private readonly timeoutMs: number = DEFAULT_PRINT_TIMEOUT_MS,
  ) {}

  /**
   * Register the port's `message` listener. Idempotent: subsequent calls replace the
   * listener (the port itself only ever has one inbox). The caller is the same place that
   * called `wireShellUpdatePort` — both adapters share the port.
   */
  attachMessageListener(port: ShellPort): void {
    port.on("message", (e) => {
      const result = parseExportResult(e.data);
      if (result === null) return;
      this.receive(result);
    });
  }

  /**
   * Ask the shell to print `html` to PDF. Resolves with the bytes (already a Buffer — the
   * shell posts a `Uint8Array` over the message port, which lands as a Buffer). Rejects
   * with `HttpError` 504 on timeout, 502 on a shell-reported error, or any other error
   * propagated by the underlying port.
   */
  async printHtmlToPdf(html: string, suggestedFilename: string): Promise<Buffer> {
    const requestId = randomUUID();
    return new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new HttpError(504, "pdf_render_timeout", "PDF render took too long."));
      }, this.timeoutMs);
      timer.unref();
      this.pending.set(requestId, { resolve, reject, timer });
      this.send({ type: "desktop-export-pdf-request", requestId, html, suggestedFilename });
    });
  }

  /** Whether a request is in flight. Surfaced on the capabilities endpoint. */
  hasInflight(): boolean {
    return this.pending.size > 0;
  }

  /** Inflight count, for tests. */
  inflightCount(): number {
    return this.pending.size;
  }

  private receive(result: DesktopExportResult): void {
    const entry = this.pending.get(result.requestId);
    if (entry === undefined) return;
    this.pending.delete(result.requestId);
    clearTimeout(entry.timer);
    if (result.error !== undefined) {
      entry.reject(new HttpError(502, "pdf_render_failed", result.error));
      return;
    }
    if (result.bytes === undefined) {
      entry.reject(
        new HttpError(502, "pdf_render_failed", "Shell returned no bytes and no error."),
      );
      return;
    }
    entry.resolve(Buffer.from(result.bytes));
  }
}
