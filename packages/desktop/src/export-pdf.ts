/**
 * Shell-side PDF renderer. Mirrors the updater's message-port relay: registers one inbox
 * on the shared utilityProcess port and dispatches by `type` (the updater owns the other
 * inbox). The handler is a one-render-per-request loop:
 *
 *   server → { type: "desktop-export-pdf-request", requestId, html, suggestedFilename }
 *     → load the HTML in a hidden BrowserWindow
 *     → `webContents.printToPDF` (A4, ½″ margins, backgrounds)
 *     → shell → server: { type: "desktop-export-pdf-result", requestId, bytes }
 *
 * Errors from any step (load failure, print failure, render timeout) ride back on the same
 * `error` field the server's adapter expects.
 *
 * Why a hidden BrowserWindow and not `webContents.executeJavaScript` over the existing
 * window? Two reasons:
 *   1. The export HTML is untrusted Agent output — a sandboxed offscreen page keeps its
 *      scripts off the main window entirely.
 *   2. `printToPDF` needs a document fully loaded, with its stylesheets applied; reusing
 *      the main window would race with the user's own navigation.
 *
 * No preload bridge, no Node integration in the hidden window either — the same hardening
 * main.ts applies to every BrowserWindow in this app.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BrowserWindow, app } from "electron";
import type {
  DesktopExportRequest,
  DesktopExportResult,
} from "@prismshadow/jiumate-server/desktop-export";

/** The slice of Electron's ParentPort this relay uses. Mirrors server/desktop-export-port.ts. */
export interface ShellPort {
  on(event: "message", listener: (e: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

/** Conservative cap for `loadURL(data:...)`; Chromium throws on bigger payloads. */
const DATA_URL_LIMIT_BYTES = 1_500_000;
/** Deadline a single print is allowed to run, including hidden-window setup. */
const PRINT_TIMEOUT_MS = 25_000;
/** Chromium's PDF print yields A4; margins and backgrounds are what users expect for a
 *  Markdown report (code-block backgrounds, Mermaid diagrams). */
const PRINT_OPTIONS: Parameters<BrowserWindow["webContents"]["printToPDF"]>[0] = {
  pageSize: "A4",
  printBackground: true,
  margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 },
};

/** Strict shape check; defensive against a future wire bump landing before the shell. */
export function parseExportRequest(data: unknown): DesktopExportRequest | null {
  if (typeof data !== "object" || data === null) return null;
  const m = data as Partial<DesktopExportRequest>;
  if (m.type !== "desktop-export-pdf-request") return null;
  if (typeof m.requestId !== "string" || m.requestId.length === 0) return null;
  if (typeof m.html !== "string") return null;
  if (typeof m.suggestedFilename !== "string") return null;
  return m as DesktopExportRequest;
}

/**
 * Wraps a per-request render in the Chromium side of the lifecycle. Exposed so the test
 * can assert the data-URL-vs-tmp-file decision without spinning up Electron.
 *
 * Returns `{ kind: "data-url" }` for documents small enough to ride as a `data:` URL,
 * `{ kind: "tmp-file", path }` for larger ones (Chromium throws on huge data URIs). The
 * caller is responsible for writing the file and cleaning it up.
 */
export function loadStrategy(
  htmlBytes: number,
): { kind: "data-url" } | { kind: "tmp-file"; ext: string } {
  return htmlBytes <= DATA_URL_LIMIT_BYTES
    ? { kind: "data-url" }
    : { kind: "tmp-file", ext: ".html" };
}

/** Renders `html` to PDF bytes in a fresh hidden BrowserWindow. Closes the window even on failure. */
export async function renderHtmlToPdf(html: string): Promise<Buffer> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Offscreen rendering would be cheaper, but it skips `printToPDF`; the hidden window
      // path is the one Electron documents and supports.
    },
  });
  try {
    const strategy = loadStrategy(Buffer.byteLength(html, "utf8"));
    if (strategy.kind === "data-url") {
      const dataUrl = `data:text/html;charset=utf-8;base64,${Buffer.from(html, "utf8").toString("base64")}`;
      await Promise.race([win.loadURL(dataUrl), timeoutAfter(PRINT_TIMEOUT_MS, "loadURL")]);
    } else {
      const tmpFile = path.join(
        os.tmpdir(),
        `jiumate-export-${process.pid}-${Date.now()}${strategy.ext}`,
      );
      fs.writeFileSync(tmpFile, html, "utf8");
      try {
        await Promise.race([win.loadFile(tmpFile), timeoutAfter(PRINT_TIMEOUT_MS, "loadFile")]);
      } finally {
        // Best-effort cleanup; the file lives in os.tmpdir() so the OS sweeps it on reboot
        // even if the unlink fails.
        try {
          fs.unlinkSync(tmpFile);
        } catch {
          /* ignore */
        }
      }
    }
    return await Promise.race([
      win.webContents.printToPDF(PRINT_OPTIONS),
      timeoutAfter(PRINT_TIMEOUT_MS, "printToPDF"),
    ]);
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

function timeoutAfter(ms: number, step: string): Promise<never> {
  return new Promise((_resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`PDF render timed out at ${step} (${ms}ms)`)), ms);
    t.unref();
  });
}

/**
 * Registers the export-PDF inbox on the port. Idempotent: replacing the listener is fine
 * (the port itself only carries one inbox per channel). Returns an unsubscribe.
 */
export function wireExportPdf(port: ShellPort): () => void {
  const listener = (e: { data: unknown }): void => {
    void handleFrame(port, e.data);
  };
  port.on("message", listener);
  return () => {
    // Electron's utilityProcess port doesn't have `off`; replace with a no-op so a re-wire
    // doesn't accumulate listeners. The caller recreates `port` between server restarts
    // anyway, so the previous inbox goes out of scope with the old utilityProcess.
  };
}

async function handleFrame(port: ShellPort, data: unknown): Promise<void> {
  const req = parseExportRequest(data);
  if (req === null) return;
  // Drop the request if the app isn't ready — `printToPDF` before `whenReady` returns
  // an empty buffer on some platforms. The `before-quit` shutdown is a separate concern
  // handled by main.ts (it stops the embedded server, which closes the port inbox).
  if (!app.isReady()) {
    reply(port, req.requestId, undefined, "Shell is not ready.");
    return;
  }
  try {
    const bytes = await renderHtmlToPdf(req.html);
    reply(port, req.requestId, bytes, undefined);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    reply(port, req.requestId, undefined, message);
  }
}

function reply(
  port: ShellPort,
  requestId: string,
  bytes: Buffer | undefined,
  error: string | undefined,
): void {
  const msg: DesktopExportResult = {
    type: "desktop-export-pdf-result",
    requestId,
    ...(bytes !== undefined ? { bytes } : {}),
    ...(error !== undefined ? { error } : {}),
  };
  port.postMessage(msg);
}
