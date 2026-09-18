/**
 * System tray for the desktop pet.
 *
 * Mirrors OpenBitFun's tray entry: while the pet is enabled the app keeps an icon
 * in the notification area whose menu hides or shows the pet, brings the main
 * window back, and quits.
 *
 * The tray exists only while the pet does. This app's quit semantics are
 * "closing the main window quits, unless the pet window is still open" (see
 * `main.ts`), and a tray that outlived the pet would silently turn that into a
 * background app the user never asked for. So the renderer — which owns the
 * `enablePet` pref — reports the state here, and this module creates or destroys
 * the icon to match.
 *
 * The menu itself is a thin relay. Both the checked state and the pref it toggles
 * live in the renderer, so a click asks the renderer to flip `enablePet` rather
 * than writing anything from here.
 */
import { Menu, Tray, app, ipcMain, nativeImage } from "electron";
import { petTrayLabels } from "./pet-tray-labels.js";

/** Tray icons are drawn at this size; the source asset is a full app icon. */
const TRAY_ICON_SIZE = 16;

export interface PetTrayDeps {
  /** Tray icon file, or null when the build has none (the tray is then skipped). */
  iconPath: string | null;
  /** Ask the renderer to flip `enablePet`. */
  onTogglePet: () => void;
  /** Bring the main window to the front. */
  onShowMain: () => void;
  /** Quit the app (the embedded server shuts down through the usual path). */
  onQuit: () => void;
}

let tray: Tray | null = null;
let enabled = false;

function buildMenu(deps: PetTrayDeps): Menu {
  const s = petTrayLabels(app.getLocale());
  return Menu.buildFromTemplate([
    {
      id: "toggle_desktop_pet",
      label: s.pet,
      type: "checkbox",
      checked: enabled,
      click: () => deps.onTogglePet(),
    },
    { type: "separator" },
    { label: s.showMain, click: () => deps.onShowMain() },
    { label: s.quit, click: () => deps.onQuit() },
  ]);
}

function trayIcon(iconPath: string) {
  const image = nativeImage.createFromPath(iconPath);
  // A 1024px app icon would otherwise be handed to the shell at full size.
  return image.isEmpty() ? image : image.resize({ width: TRAY_ICON_SIZE, height: TRAY_ICON_SIZE });
}

/**
 * Create, refresh or drop the tray so it matches `next`. Safe to call on every
 * prefs change: the icon is only rebuilt when the checked state actually moves.
 */
export function syncPetTray(next: boolean, deps: PetTrayDeps): void {
  const changed = next !== enabled;
  enabled = next;

  if (!next) {
    if (tray !== null) process.stdout.write("[shell] pet tray hidden\n");
    tray?.destroy();
    tray = null;
    return;
  }
  if (deps.iconPath === null) return;

  if (tray === null) {
    const icon = trayIcon(deps.iconPath);
    if (icon.isEmpty()) return;
    const labels = petTrayLabels(app.getLocale());
    tray = new Tray(icon);
    tray.setToolTip(labels.tooltip);
    tray.setContextMenu(buildMenu(deps));
    process.stdout.write(
      `[shell] pet tray shown (${labels.pet} / ${labels.showMain} / ${labels.quit})\n`,
    );
    return;
  }
  if (changed) tray.setContextMenu(buildMenu(deps));
}

export function destroyPetTray(): void {
  tray?.destroy();
  tray = null;
  enabled = false;
}

/** Register the renderer → shell half of the tray relay. Idempotent per process. */
export function wirePetTrayIpc(deps: PetTrayDeps): void {
  ipcMain.handle("pet:setEnabled", (_event, payload: unknown) => {
    if (typeof payload !== "boolean") {
      throw new Error("pet:setEnabled requires a boolean");
    }
    syncPetTray(payload, deps);
  });
}
