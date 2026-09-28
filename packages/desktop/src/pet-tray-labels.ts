/**
 * Tray menu copy, split out of `pet-tray.ts` so it can be unit-tested.
 *
 * The tray lives in the main process, which has no UI dictionary and no locale
 * provider — the renderer owns both. OpenBitFun resolves the same problem the same
 * way: the tray picks its labels from the OS locale. That makes this a pure
 * `locale → strings` mapping, which is all a test needs.
 */

export interface PetTrayLabels {
  tooltip: string;
  /** The checkable "show desktop pet" item. */
  pet: string;
  showMain: string;
  quit: string;
}

const ZH: PetTrayLabels = {
  tooltip: "JiuMate",
  pet: "显示桌面宠物",
  showMain: "显示主窗口",
  quit: "退出",
};

const EN: PetTrayLabels = {
  tooltip: "JiuMate",
  pet: "Show desktop pet",
  showMain: "Show main window",
  quit: "Quit",
};

/** Labels for an Electron locale tag (`app.getLocale()`, e.g. "zh-CN", "en-US"). */
export function petTrayLabels(locale: string): PetTrayLabels {
  return locale.toLowerCase().startsWith("zh") ? ZH : EN;
}
