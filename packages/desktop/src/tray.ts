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
 * ## Why the pet tray is a separate module
 *
 * `pet-tray.ts` exists only while the floating pet is enabled, and its menu carries the pet's
 * checkbox. Folding the two together would mean this tray appeared and disappeared with the pet —
 * the opposite of what a tray is for here — and would put a checkbox about one feature in a menu
 * that has to stay up regardless. Two Tray objects rather than one shared menu: Windows renders
 * each as its own notification-area entry, and the pet's checkbox has no meaning on a menu that
 * outlives the pet.
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

function trayIcon(iconPath: string) {
  const image = nativeImage.createFromPath(iconPath);
  // A 1024px app icon would otherwise be handed to the shell at full size.
  return image.isEmpty() ? image : image.resize({ width: TRAY_ICON_SIZE, height: TRAY_ICON_SIZE });
}

const ACTION_LABELS: Record<TrayActionId, (l: ReturnType<typeof appTrayLabels>) => string> = {
  "new-chat": (l) => l.newChat,
  settings: (l) => l.settings,
  quit: (l) => l.quit,
};

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
  if (item.kind === "action") {
    return {
      label: ACTION_LABELS[item.id](labels),
      click: () => {
        if (item.id === "new-chat") deps.onNewChat();
        else if (item.id === "settings") deps.onSettings();
        else deps.onQuit();
      },
    };
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
      buildTrayMenu({ rows: recent, labels: appTrayLabels(app.getLocale()) }).map((i) =>
        toTemplate(i, currentDeps as AppTrayDeps),
      ),
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

export function destroyAppTray(): void {
  tray?.destroy();
  tray = null;
  recent = [];
  currentDeps = null;
}