/**
 * The `workspace:*` IPC surface: the OS's own directory chooser, for picking a Workspace
 * directory on the machine the desktop app runs on.
 *
 * ## Why its own namespace rather than reusing `theme:pickFolder`
 *
 * That channel exists and does exactly the mechanical work (open a directory dialog, return
 * the path or null on cancel). Reusing it would mean the window that opens says
 * "Import theme directory" when the user asked for a workspace — the title and the button
 * label are the user's only clue about what the dialog is about to change, and they would be
 * lying. The channel names are cheap; the strings are not.
 *
 * ## Why it exists at all in the desktop shell
 *
 * A browser cannot ask the OS for a directory. It can only type a path, and that path is
 * resolved on the SERVER. So on the desktop app — where server and person share one
 * filesystem — the native picker is the only control that can name a directory the user
 * actually has. In a plain browser this channel simply does not exist, and the caller hides
 * the entry rather than offering a button that cannot work (see `workspace-select.tsx`).
 *
 * Idempotent registration for the same reason as `theme-picker.ts`: `main.ts` can reach this
 * from two paths, and `ipcMain.handle` throws on a duplicate channel.
 */
import { app, dialog, ipcMain } from "electron";
import { workspacePickerLabels } from "./workspace-picker-labels.js";

/** The channel the renderer's `window.workspace.pickFolder()` invokes. */
export const WORKSPACE_PICK_CHANNEL = "workspace:pickFolder";

let registered = false;

/**
 * Ask the OS for a directory. Resolves to null when the user cancels — the caller reads that
 * as "nothing happened", not as an error (the same contract `theme:pickFolder` has).
 *
 * No parent window, deliberately: matching theme-picker's reasoning, passing the wrong one
 * makes the dialog modal against the wrong surface (on macOS it would attach as a sheet to a
 * window that may not be focused).
 */
export function registerWorkspacePicker(): void {
  if (registered) return;
  registered = true;
  ipcMain.handle(WORKSPACE_PICK_CHANNEL, async () => {
    const labels = workspacePickerLabels(app.getLocale());
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
export function resetWorkspacePickerForTest(): void {
  registered = false;
}
