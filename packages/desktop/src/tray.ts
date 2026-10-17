/**
 * The system tray for the chat window: the app's home in the notification area, and the reason
 * closing the window does not quit.
 *
 * ## Why this exists
 *
 * Closing the chat window used to quit the app (`window-all-closed` → `app.quit()`, minus the
 * macOS and floating-pet exceptions in main.ts). That is the wrong default for a chat client: the
 * window is where you read and write, not the process. Losing the window to a stray click on the
 * X, and with it the server it owns, is a worse outcome than a window that is still running where
 * you left it — and the app is a local server as much as a UI, so quitting tears down something
 * the user may not have realised was running.
 *
 * So the window's close button hides it and the tray is how it comes back. The tray is created
 * once, for the whole session, and destroyed only on a real quit (`before-quit`), which is what
 * keeps "quit" and "close" distinguishable: the menu's Quit sets the quitting flag, so the
 * `close` handler stops intercepting and the app really exits.
 *
 * ## Why the pet tray is a separate module
 *
 * `pet-tray.ts` exists only while the floating pet is enabled, and its menu carries the pet's
 * checkbox. Folding the two together would mean the app tray appeared and disappeared with the
 * pet — the opposite of what the tray is for here — and would put a checkbox about one feature in
 * a menu that must stay up regardless. Two Tray objects rather than one shared menu: Windows
 * renders each as its own notification-area entry, and the pet's checkbox has no meaning on a menu
 * that outlives the pet.
 */
import { Menu, Tray, app, nativeImage } from "electron";
import { appTrayLabels } from "./tray-labels.js";

/** Tray icons are drawn at this size; the source asset is a full app icon. */
const TRAY_ICON_SIZE = 16;

export interface AppTrayDeps {
  /** Tray icon file, or null when the build has none (the tray is then skipped). */
  iconPath: string | null;
  /** Bring the main window back, and focus it. */
  onShowMain: () => void;
  /** Bring the floating pet window back. */
  onShowPet: () => void;
  /** Quit for real: stops the embedded server, then exits. */
  onQuit: () => void;
}

let tray: Tray | null = null;

function trayIcon(iconPath: string) {
  const image = nativeImage.createFromPath(iconPath);
  // A 1024px app icon would otherwise be handed to the shell at full size.
  return image.isEmpty() ? image : image.resize({ width: TRAY_ICON_SIZE, height: TRAY_ICON_SIZE });
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
  if (tray !== null) return;
  if (deps.iconPath === null) return;

  const icon = trayIcon(deps.iconPath);
  if (icon.isEmpty()) {
    process.stdout.write("[shell] app tray skipped: the icon would not load\n");
    return;
  }

  const labels = appTrayLabels(app.getLocale());
  const menu = Menu.buildFromTemplate([
    { label: labels.focusMain, click: () => deps.onShowMain() },
    { label: labels.showPet, click: () => deps.onShowPet() },
    { type: "separator" },
    { label: labels.quit, click: () => deps.onQuit() },
  ]);

  tray = new Tray(icon);
  tray.setToolTip(labels.tooltip);
  tray.setContextMenu(menu);
  // Left-clicking the icon should bring the window back — that is what a user expects from a chat
  // app's tray icon, and the menu alone would make a single click do nothing.
  tray.on("click", () => deps.onShowMain());
  process.stdout.write(`[shell] app tray shown (${labels.showMain} / ${labels.quit})\n`);
}

export function destroyAppTray(): void {
  tray?.destroy();
  tray = null;
}