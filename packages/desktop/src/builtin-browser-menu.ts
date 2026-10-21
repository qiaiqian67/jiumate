/**
 * The guest context menu: which entries it offers, when each is enabled, and what an entry
 * does. The part that touches Electron is only the last function; the menu's shape is pure, so
 * it is unit-tested without a running app.
 */
import type { ContextMenuParams, WebContents } from "electron";

/** The locale a guest's menu is drawn in: the Web App's, as the tray follows it. */
export type GuestLocale = string;

/** What a guest menu entry does. No action means a separator. */
export type GuestMenuAction =
  | "back"
  | "forward"
  | "reload"
  | "open-link"
  | "copy-link"
  | "copy-image-address"
  | "cut"
  | "copy"
  | "paste"
  | "select-all"
  | "inspect"
  | "devtools";

/** One entry of the menu. No `action` and no `label` means a separator. */
export interface GuestMenuItem {
  action?: GuestMenuAction;
  label?: string;
  enabled?: boolean;
}

/** What one context menu entry needs to know about the guest it was opened in. */
export interface GuestMenuState {
  linkURL: string;
  srcURL: string;
  mediaType: string;
  isEditable: boolean;
  selectionText: string;
  canGoBack: boolean;
  canGoForward: boolean;
}

/** The labels, in the two languages the app ships. */
const LABELS = {
  en: {
    back: "Back",
    forward: "Forward",
    reload: "Reload",
    openLink: "Open link in new tab",
    copyLink: "Copy link address",
    copyImage: "Copy image address",
    cut: "Cut",
    copy: "Copy",
    paste: "Paste",
    selectAll: "Select all",
    inspect: "Inspect element",
    devtools: "Developer tools",
  },
  zh: {
    back: "后退",
    forward: "前进",
    reload: "重新加载",
    openLink: "在新标签页打开链接",
    copyLink: "复制链接地址",
    copyImage: "复制图片地址",
    cut: "剪切",
    copy: "复制",
    paste: "粘贴",
    selectAll: "全选",
    inspect: "检查元素",
    devtools: "开发者工具",
  },
} as const;

/**
 * The menu a right-click in a guest offers. An entry that cannot act right now (back with no
 * history, copy with no selection) is present but disabled, so the menu does not jump around
 * under the pointer as the selection changes.
 */
export function guestContextMenu(locale: GuestLocale, state: GuestMenuState): GuestMenuItem[] {
  const t = locale.toLowerCase().startsWith("zh") ? LABELS.zh : LABELS.en;
  const hasSelection = state.selectionText !== "";
  const items: GuestMenuItem[] = [
    { action: "back", label: t.back, enabled: state.canGoBack },
    { action: "forward", label: t.forward, enabled: state.canGoForward },
    { action: "reload", label: t.reload },
  ];
  if (state.srcURL !== "") items.push({ action: undefined, label: "" });
  if (state.linkURL !== "") {
    items.push(
      { action: "open-link", label: t.openLink },
      { action: "copy-link", label: t.copyLink },
    );
  }
  if (state.mediaType.startsWith("image") && state.srcURL !== "") {
    items.push({ action: "copy-image-address", label: t.copyImage });
  }
  items.push({ action: undefined, label: "" });
  items.push(
    { action: "cut", label: t.cut, enabled: state.isEditable && hasSelection },
    { action: "copy", label: t.copy, enabled: hasSelection },
    { action: "paste", label: t.paste, enabled: state.isEditable },
    { action: "select-all", label: t.selectAll, enabled: hasSelection },
  );
  items.push({ action: undefined, label: "" });
  items.push({ action: "inspect", label: t.inspect }, { action: "devtools", label: t.devtools });
  return items;
}

/**
 * Runs an entry's action against the guest. The clipboard entries write the URL they were
 * offered with, so a link copied from a menu that has since closed still copies that link.
 */
export function runGuestMenuAction(
  guest: WebContents,
  action: GuestMenuAction,
  params: ContextMenuParams,
  emitOpenRequest: (url: string, openerTabId: number, background: boolean) => void,
  writeClipboard: (text: string) => void,
): void {
  if (guest.isDestroyed()) return;
  switch (action) {
    case "back":
      guest.navigationHistory.goBack();
      return;
    case "forward":
      guest.navigationHistory.goForward();
      return;
    case "reload":
      guest.reload();
      return;
    case "open-link":
      emitOpenRequest(params.linkURL, guest.id, true);
      return;
    case "copy-link":
      writeClipboard(params.linkURL);
      return;
    case "copy-image-address":
      writeClipboard(params.srcURL);
      return;
    case "cut":
      guest.cut();
      return;
    case "copy":
      guest.copy();
      return;
    case "paste":
      guest.paste();
      return;
    case "select-all":
      guest.selectAll();
      return;
    case "inspect":
      guest.inspectElement(params.x, params.y);
      return;
    case "devtools":
      guest.openDevTools();
      return;
  }
}
