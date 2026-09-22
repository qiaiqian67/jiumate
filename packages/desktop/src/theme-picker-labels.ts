/**
 * The native folder picker for importing a theme.
 *
 * Separate from `pet:pickPackage` rather than shared with it. That one's dialog title says
 * "Petdex package" and its bridge is `window.pet`; reusing either would put the wrong words in a
 * system dialog and the wrong name in the API. Generalizing both is a bigger change than adding
 * a second picker, and the two will want different copy anyway.
 *
 * The picker returns a **path**, not the folder's contents. The renderer hands that path to
 * `POST /api/skins/import`, which reads it server-side — the same shape the pet import uses, and
 * the reason nothing crosses the IPC boundary but a string. It also means the picker is only an
 * affordance: a user on the plain browser can still type the path.
 */

export interface ThemePickerLabels {
  title: string;
  /** The confirm button. Electron defaults to "Open", which reads wrong for an import. */
  button: string;
}

const ZH: ThemePickerLabels = {
  title: "导入主题文件夹",
  button: "导入",
};

const EN: ThemePickerLabels = {
  title: "Import theme folder",
  button: "Import",
};

/** Labels for an Electron locale tag (`app.getLocale()`, e.g. "zh-CN", "en-US"). */
export function themePickerLabels(locale: string): ThemePickerLabels {
  return locale.toLowerCase().startsWith("zh") ? ZH : EN;
}
