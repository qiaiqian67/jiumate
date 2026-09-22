/**
 * The `theme:*` IPC surface.
 *
 * One channel, registered against the **main** window rather than the floating pet window:
 * the import control lives on the Appearance settings page, which the main window hosts.
 * `pet-window.ts` registers its own channels on the same `ipcMain` singleton, so the two do
 * not collide as long as the channel names stay namespaced.
 */
import { app, dialog, ipcMain } from "electron";
import { themePickerLabels } from "./theme-picker-labels.js";

/** The channel the renderer's `window.theme.pickFolder()` invokes. */
export const THEME_PICK_CHANNEL = "theme:pickFolder";

/**
 * Idempotent, because the caller is not guarded the way the pet window is: `main.ts` reaches
 * this from two paths (cold start and a re-launch after a failed start) and only one of them is
 * behind a null check. `ipcMain.handle` throws on a duplicate channel, so a second call has to
 * be a no-op rather than a crash.
 */
let registered = false;

/**
 * Ask the OS for a directory. Returns null when the user cancels, which the renderer reads as
 * "nothing happened" rather than as an error — the same contract `pet:pickPackage` has.
 *
 * `showOpenDialog` without a parent window is deliberate: this can be called from either
 * window, and passing the wrong one makes the dialog modal against the wrong surface (on macOS
 * it would attach as a sheet to a window that may not be focused).
 */
export function registerThemePicker(): void {
  if (registered) return;
  registered = true;
  ipcMain.handle(THEME_PICK_CHANNEL, async () => {
    const labels = themePickerLabels(app.getLocale());
    const result = await dialog.showOpenDialog({
      title: labels.title,
      buttonLabel: labels.button,
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0] ?? null;
  });
}

/** Test seam: lets a unit test register again after resetting the module. */
export function resetThemePickerForTest(): void {
  registered = false;
}
