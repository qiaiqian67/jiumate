/**
 * Preload bridge for the AI companion floating window.
 *
 * Exposes a small, typed surface (`window.companion`) to both the main chat window
 * and the companion window itself. The companion window's `open` / `close` /
 * `move` reach the main process via `ipcRenderer.invoke`; the main window only
 * needs `open` and `savePosition` (a persist-then-close helper used when the user
 * disables the companion via a control inside the floating window).
 *
 * Sandbox note: with `sandbox: true` the preload runs in a restricted context but
 * can still import the `electron` module for `contextBridge` / `ipcRenderer`.
 * Anything beyond that (Node built-ins, network APIs, …) is intentionally blocked.
 */
import { contextBridge, ipcRenderer } from "electron";

/** Two-element position. Mirror of `companionFloatingPosition` in `UiPrefs`. */
export interface FloatingPosition {
  x: number;
  y: number;
}

/** Methods exposed to the renderer. Typed here so web code can import the type
 *  without pulling in electron. The `typeof api` below is what the renderer sees. */
const api = {
  /** Open the floating companion window at the saved position, or at the default
   *  location when no position is provided (or the value fails validation). */
  open: (savedPos?: FloatingPosition | null): Promise<void> =>
    ipcRenderer.invoke("companion:open", savedPos ?? null),
  /** Close the floating window — the placement stays in `ui_prefs` so a re-open
   *  restores the position. */
  close: (): Promise<void> => ipcRenderer.invoke("companion:close"),
  /** Move the window to an absolute screen position (rejects non-finite values). */
  move: (pos: FloatingPosition): Promise<void> => ipcRenderer.invoke("companion:move", pos),
  /** Read the current screen position, or null if the window isn't open. */
  getPosition: (): Promise<FloatingPosition | null> => ipcRenderer.invoke("companion:getPosition"),
  /** Persist the current position into `ui_prefs` so the next open restores here. */
  savePosition: (): Promise<{ x: number; y: number } | null> =>
    ipcRenderer.invoke("companion:savePosition"),
};

contextBridge.exposeInMainWorld("companion", api);

/** The shape exposed to the renderer. The web side augments `Window` with this. */
export type CompanionBridge = typeof api;
