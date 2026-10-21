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
  on(event: "message", listener: (e: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

/**
 * Lets the main window's page host browser guests, and runs one frame from the server if it is
 * a browser command. Returns the relay's teardown, which replaces this port's listener rather
 * than removing it — Electron's port has no `off`, and the caller recreates the port between
 * server restarts anyway.
 */
export function wireBuiltinBrowser(
  port: ShellPort,
  window: () => BrowserWindow | null,
): () => void {
  const shell: BuiltinBrowserShell = createBuiltinBrowserShell({
    post: (message) => port.postMessage(message),
    // The guests speak the Web App's language, as the tray menu beside them does.
    locale: () => app.getLocale(),
    log: (line) => console.log(`[desktop] ${line}`),
  });

  const hostWindow = window();
  if (hostWindow !== null) shell.host(hostWindow);

  const listener = (e: { data: unknown }): void => {
    try {
      shell.handle(e.data);
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
