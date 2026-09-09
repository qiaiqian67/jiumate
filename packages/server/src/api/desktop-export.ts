/**
 * Shell↔server message-port wire shapes for "render this HTML to a PDF" requests.
 *
 * The server has no `webContents`, so PDF export cannot be a server-side transformation
 * even when Pandoc is installed. Instead, the page pre-renders Markdown to a self-contained
 * HTML document (Mermaid already inlined as SVG, KaTeX CSS linked) and POSTs it here; this
 * module hands it to the desktop shell, which loads it into a hidden `BrowserWindow` and
 * calls `printToPDF`, then posts the resulting bytes back. The two messages are paired by
 * a per-request `requestId` so a render that races another (e.g. two exports at once, or a
 * `before-quit` that flushes a half-finished one) cannot mis-deliver its result.
 *
 * The transport is the same utilityProcess `parentPort` the updater uses
 * (services/desktop-update-port.ts); the shell's `port.on("message", ...)` handler
 * dispatches by `type`. Both shapes import from this file so the two sides ship with the
 * same contract.
 */
import type { Buffer } from "node:buffer";

/**
 * Server → shell: render `html` to a PDF and return the bytes. `requestId` is a UUID
 * generated per request so the response can be matched even if the shell's inbox has been
 * seeing other traffic in the meantime.
 */
export interface DesktopExportRequest {
  type: "desktop-export-pdf-request";
  requestId: string;
  /**
   * A self-contained HTML document. The shell wraps it in a hidden BrowserWindow as a
   * `data:` URL (or a temp file if it exceeds the ~2MB data-URI limit; the shell owns
   * that decision).
   */
  html: string;
  /**
   * Suggested output filename (the source Markdown's basename). Echoed back in the result
   * so the server can set `Content-Disposition: attachment; filename=…` on the response.
   */
  suggestedFilename: string;
}

/**
 * Shell → server: the PDF bytes for a previously-sent request. `error` is set instead of
 * `bytes` when the print failed (e.g. a parse error in Mermaid SVG that the browser noticed,
 * or the render overran the shell's own deadline).
 */
export interface DesktopExportResult {
  type: "desktop-export-pdf-result";
  requestId: string;
  bytes?: Buffer;
  error?: string;
}
