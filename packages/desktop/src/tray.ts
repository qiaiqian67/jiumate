/**
 * The system tray for the chat window: the app's home in the notification area, and the reason
 * closing the window does not quit.
 *
 * ## Why this exists
 *
 * Closing the chat window used to quit the app (`window-all-closed` → `app.quit()`, minus the
 * macOS and floating-pet exceptions in main.ts). That is the wrong default for a chat client: the
 * window is where you read and write, not the process. Losing the window to a stray click on the X,
 * and with it the server it owns, is a worse outcome than a window still running where you left
 * it — and this app is a local server as much as a UI, so quitting tears down something the user
 * may not have realised was running.
 *
 * So the close button hides the window and the tray is how it comes back. The tray is created once,
 * for the whole session, and destroyed only on a real quit (`before-quit`), which is what keeps
 * "quit" and "close" distinguishable: Quit sets the quitting flag, so the `close` handler stops
 * intercepting and the app really exits.
 *
 * ## What is in the menu, and who decides
 *
 * The shape is decided by `tray-menu.ts` (pure, tested); this module turns it into a `Menu`. The
 * recent-conversation rows come from the renderer, which is the only side that knows about
 * Sessions, Projects and Agents — see tray-menu.ts for why the shell does not fetch them itself.
 *
 * ## One tray for the whole app, pet included
 *
 * The pet used to get a Tray of its own, created only while the pet was enabled. Two icons for one
 * app in the notification area is the sort of thing a user notices before they can say what is wrong
 * with it, and the two menus did not agree — the pet's had a checkbox the app's had no way to
 * reach. The pet toggle is now an item in this menu, and this tray's lifetime no longer has anything
 * to do with the pet (it never did depend on it; the *other* tray did).
 *
 * ## Why the pet tray was a separate module rather than a second one here
 *
 * It still is a separate module — `pet-tray-labels.ts` is gone with it, and the pet's own window,
 * tray relay and enable pref are untouched. What changed is that there is now one Tray object, so
 * the two menus cannot drift apart again.
 */
import { Menu, Tray, app, nativeImage } from "electron";
import { appTrayLabels } from "./tray-labels.js";
import {
  buildTrayMenu,
  type TrayActionId,
  type TrayMenuItem,
  type TrayRecentRow,
} from "./tray-menu.js";
export type { TrayRecentRow } from "./tray-menu.js";

/** Tray icons are drawn at this size; the source asset is a full app icon. */
const TRAY_ICON_SIZE = 16;

export interface AppTrayDeps {
  /** Tray icon file, or null when the build has none (the tray is then skipped). */
  iconPath: string | null;
  /** Bring the main window back, and focus it. */
  onShowMain: () => void;
  /** Open a Session by id: the window comes forward and the router does the rest. */
  onOpenSession: (sessionId: string) => void;
  /** Ask the renderer to flip `enablePet`. */
  onTogglePet: () => void;
  /** Start a new conversation in the current Project and Agent. */
  onNewChat: () => void;
  /** Open the settings page. */
  onSettings: () => void;
  /** Quit for real: stops the embedded server, then exits. */
  onQuit: () => void;
}

let tray: Tray | null = null;
/** The rows as last reported by the renderer. Kept so a re-open needs no new round trip. */
let recent: TrayRecentRow[] = [];
/** Whether the pet is on, as last reported. The renderer owns the pref; this only mirrors it. */
let petEnabled = false;

function trayIcon(iconPath: string) {
  const image = nativeImage.createFromPath(iconPath);
  // A 1024px app icon would otherwise be handed to the shell at full size.
  return image.isEmpty() ? image : image.resize({ width: TRAY_ICON_SIZE, height: TRAY_ICON_SIZE });
}

const ACTION_LABELS: Record<TrayActionId, (l: ReturnType<typeof appTrayLabels>) => string> = {
  "toggle-pet": (l) => l.pet,
  "new-chat": (l) => l.newChat,
  settings: (l) => l.settings,
  quit: (l) => l.quit,
};

/** Run the action behind a shell-owned entry. Shared by the plain and checkbox branches. */
function runAction(id: TrayActionId, deps: AppTrayDeps): void {
  if (id === "toggle-pet") deps.onTogglePet();
  else if (id === "new-chat") deps.onNewChat();
  else if (id === "settings") deps.onSettings();
  else deps.onQuit();
}

/**
 * One entry in Electron's template shape.
 *
 * Annotated explicitly because the submenu branch recurses through `Menu.buildFromTemplate`, which
 * makes the return type circular; without this the compiler infers `any` and the whole menu stops
 * being checked.
 */
function toTemplate(item: TrayMenuItem, deps: AppTrayDeps): Electron.MenuItemConstructorOptions {
  const labels = appTrayLabels(app.getLocale());
  if (item.kind === "separator") return { type: "separator" };
  if (item.kind === "heading") {
    // A heading is not clickable. `enabled: false` is what greys it; without it Windows still
    // highlights the row on hover and a click lands on nothing.
    return { label: item.label, enabled: false };
  }
  if (item.kind === "submenu") {
    return {
      label: item.label,
      submenu: Menu.buildFromTemplate(item.items.map((i) => toTemplate(i, deps))),
    };
  }
  if (item.kind === "checkbox") {
    return {
      label: item.label,
      type: "checkbox",
      // Deliberately NOT flipped optimistically. The pref lives in the renderer and the renderer is
      // the only side that can write it — a local flip that the write then failed would leave the
      // tick claiming something untrue until the next report. It moves when the state comes back,
      // which is the same round trip the separate pet tray had.
      checked: item.checked,
      click: () => runAction(item.id, deps),
    };
  }
  if (item.kind === "action") {
    return { label: ACTION_LABELS[item.id](labels), click: () => runAction(item.id, deps) };
  }
  // The placeholder row carries no id, so there is nothing to open — clicking it must do nothing
  // rather than navigating to an empty session id.
  if (item.sessionId === "") return { label: item.label, enabled: false };
  return { label: item.label, click: () => deps.onOpenSession(item.sessionId) };
}

/** The deps `refresh` needs. Set once by `ensureAppTray`, kept so a refresh needs no argument. */
let currentDeps: AppTrayDeps | null = null;

function refresh(): void {
  // Both are set together by `ensureAppTray`, so there is no state where the tray exists without
  // its deps. Checked anyway because a null here would throw inside a menu rebuild, which surfaces
  // as a tray that silently stops updating.
  if (tray === null || currentDeps === null) return;
  tray.setContextMenu(
    Menu.buildFromTemplate(
      buildTrayMenu({
        rows: recent,
        labels: appTrayLabels(app.getLocale()),
        petEnabled,
      }).map((i) => toTemplate(i, currentDeps as AppTrayDeps)),
    ),
  );
}

/**
 * Create the tray if it is not already there. Idempotent, so it is safe to call from both window
 * creation and the pet's enable path.
 *
 * A no-op when the build has no icon, or when the icon file will not load: an app with no tray is
 * still usable, it just quits on close as it did before. That fallback is why this returns quietly
 * rather than throwing.
 */
export function ensureAppTray(deps: AppTrayDeps): void {
  currentDeps = deps;
  if (tray !== null) return;
  if (deps.iconPath === null) return;

  const icon = trayIcon(deps.iconPath);
  if (icon.isEmpty()) {
    process.stdout.write("[shell] app tray skipped: the icon would not load\n");
    return;
  }

  const labels = appTrayLabels(app.getLocale());
  tray = new Tray(icon);
  tray.setToolTip(labels.tooltip);
  refresh();
  // Left-clicking the icon should bring the window back — that is what a user expects from a chat
  // app's tray icon, and the menu alone would make a single click do nothing.
  tray.on("click", () => deps.onShowMain());
  process.stdout.write(`[shell] app tray shown (${labels.recent} / ${labels.quit})\n`);
}

/**
 * Replace the recent-conversation list.
 *
 * Called by the renderer whenever the list changes, so the menu a user sees is the list they can
 * see in the sidebar. Ignoring empty reports matters: the renderer pushes this on mount, and a
 * load still in flight would otherwise blank a menu that was already correct.
 */
export function setTrayRecent(rows: readonly TrayRecentRow[]): void {
  recent = rows.slice(0, 30);
  refresh();
}

/**
 * Mirror the pet's on/off state into the menu's checkbox.
 *
 * This only records what the renderer already decided — the pref is the renderer's, and it reports
 * the change here. Nothing in this module turns the pet on or off; the click relays back the same way
 * it did when the pet had a tray of its own.
 */
export function setPetEnabled(next: boolean): void {
  if (next === petEnabled) return;
  petEnabled = next;
  refresh();
}

export function destroyAppTray(): void {
  tray?.destroy();
  tray = null;
  recent = [];
  petEnabled = false;
  currentDeps = null;
}