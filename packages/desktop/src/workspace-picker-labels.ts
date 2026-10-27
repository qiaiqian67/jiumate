/**
 * The native folder picker for choosing a Workspace directory.
 *
 * Separate from `theme-picker-labels.ts` and from `pet:pickPackage`'s dialog for the same
 * reason those are separate from each other: a system dialog's title and button label are the
 * only thing telling the user what the dialog is about to do, so a shared one would say
 * "Import theme" (or "Petdex package") to someone who asked for a workspace.
 *
 * "Open" rather than "Import": nothing is imported here. The user is naming a directory that
 * already exists and will now be worked in, which is what the verb "open" already means to
 * someone in a file dialog.
 */

export interface WorkspacePickerLabels {
  title: string;
  /** The confirm button. Electron's default is "Open" here, which is already right. */
  button: string;
}

const ZH: WorkspacePickerLabels = {
  title: "打开本地文件夹",
  button: "打开",
};

const EN: WorkspacePickerLabels = {
  title: "Open local folder",
  button: "Open",
};

/** Labels for an Electron locale tag (`app.getLocale()`, e.g. "zh-CN", "en-US"). */
export function workspacePickerLabels(locale: string): WorkspacePickerLabels {
  return locale.toLowerCase().startsWith("zh") ? ZH : EN;
}
