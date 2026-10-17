/**
 * Tray menu copy, split out of `tray.ts` so it can be unit-tested.
 *
 * The tray lives in the main process, which has no UI dictionary and no locale provider — the
 * renderer owns both. It resolves that the same way `pet-tray-labels.ts` does: by the OS locale,
 * which makes this a pure `locale → strings` mapping.
 *
 * These are deliberately the same words the pet tray uses for the two items both trays offer
 * (show the window, quit). Two menus sitting next to each other in the notification area, with
 * "显示主窗口" in one and "Show window" in the other, would read as two different apps.
 */

export interface AppTrayLabels {
  tooltip: string;
  /** Bring the main window back from the tray. */
  showMain: string;
  /** Bring the main window back and put the caret in it. */
  focusMain: string;
  /** Bring the floating pet window back, if it is hidden behind the chat window. */
  showPet: string;
  quit: string;
}

const ZH: AppTrayLabels = {
  tooltip: "JiuMate",
  showMain: "显示主窗口",
  focusMain: "显示并定位到主窗口",
  showPet: "显示桌面宠物",
  quit: "退出",
};

const EN: AppTrayLabels = {
  tooltip: "JiuMate",
  showMain: "Show main window",
  focusMain: "Show and focus main window",
  showPet: "Show desktop pet",
  quit: "Quit",
};

/** Labels for an Electron locale tag (`app.getLocale()`, e.g. "zh-CN", "en-US"). */
export function appTrayLabels(locale: string): AppTrayLabels {
  return locale.toLowerCase().startsWith("zh") ? ZH : EN;
}