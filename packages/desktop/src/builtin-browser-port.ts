/**
 * The agent browser's inbox on the utilityProcess port the embedded server shares with the
 * updater relay. Every frame the server sends is offered to the browser shell, and whatever
 * the shell produces goes straight back — the shell is main-process code and cannot be the
 * one to listen here.
 *
 * The port carries the updater's and the exporter's frames too, so this only ever acts on the
 * ones its `type` names, and a crash in one relay does not affect the others.
 */
import { app } from "electron";
import type { BrowserWindow } from "electron";
import { createBuiltinBrowserShell } from "./builtin-browser.js";
import type { BuiltinBrowserShell } from "./builtin-browser.js";

/** The slice of the utilityProcess port this relay uses. */
export interface ShellPort {
  on(event: "message", listener: (message: unknown) => void): void;
  postMessage(message: unknown): void;
}

/**
 * Lets the main window's page host browser guests, and runs one frame from the server if it is
 * a browser command. Returns the relay's teardown, which replaces this port's listener rather
 * than removing it — Electron's port has no `off`, and the caller recreates the port between
 * server restarts anyway.
 *
 * `onWindow` is called with the window that may host guests, as soon as there is one. The
 * relay is wired while the server is still starting and the window comes after it, so the
 * host cannot be found by asking: the caller has to say when it exists. A shell that never
 * learned about the window refuses every guest — and the refusal says nothing about the
 * window being the reason, so the browser just stays empty.
 */
export function wireBuiltinBrowser(
  port: ShellPort,
  onWindow: (host: (win: BrowserWindow) => void) => void,
): () => void {
  const shell: BuiltinBrowserShell = createBuiltinBrowserShell({
    post: (message) => port.postMessage(message),
    // The guests speak the Web App's language, as the tray menu beside them does.
    locale: () => app.getLocale(),
    log: (line) => console.log(`[desktop] ${line}`),
  });

  // The host window is named as soon as it exists: the relay is wired while the server is
  // still starting, and the window comes after it. A shell that never learned about the
  // window refuses every guest, and the browser stays empty with nothing to say why.
  onWindow((win) => shell.host(win));

  const listener = (message: unknown): void => {
    try {
      // The utilityProcess port hands over the frame itself, not a `{ data }` wrapper: the
      // server's side of the same port is Electron's `process.parentPort`, which DOES wrap
      // it. The two are not the same object, so the shape each one delivers is its own.
      shell.handle(message);
    } catch (err) {
      // A throw here would take down the main process on a frame from the server; the shell
      // reports its own failures as replies, so anything reaching here is a bug worth a line.
      console.error(
        `[desktop] builtin browser: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };
  port.on("message", listener);
  // Electron's port has no `off`, so the teardown swaps in a no-op listener rather than
  // removing this one; the caller recreates the port between server restarts anyway, so the
  // previous inbox goes out of scope with the old utilityProcess.
  return () => {
    port.on("message", () => {});
  };
}
