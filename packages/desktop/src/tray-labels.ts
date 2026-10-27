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
  /** Section heading above the recent-conversation list. */
  recent: string;
  /** Submenu holding the conversations that did not fit above. */
  more: string;
  /** The checkable "show desktop pet" item. */
  pet: string;
  newChat: string;
  settings: string;
  quit: string;
  /** Placeholder when the renderer has not reported any conversation yet. */
  noRecent: string;
}

const ZH: AppTrayLabels = {
  tooltip: "JiuMate",
  recent: "最近任务",
  more: "更多",
  pet: "显示桌面宠物",
  newChat: "新对话",
  settings: "设置",
  quit: "退出",
  noRecent: "（暂无对话）",
};

const EN: AppTrayLabels = {
  tooltip: "JiuMate",
  recent: "Recent",
  more: "More",
  pet: "Show desktop pet",
  newChat: "New chat",
  settings: "Settings",
  quit: "Quit",
  noRecent: "(no conversations)",
};

/** Labels for an Electron locale tag (`app.getLocale()`, e.g. "zh-CN", "en-US"). */
export function appTrayLabels(locale: string): AppTrayLabels {
  return locale.toLowerCase().startsWith("zh") ? ZH : EN;
}
