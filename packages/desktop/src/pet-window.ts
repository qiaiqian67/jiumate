/**
 * Floating Petdex desktop pet window.
 *
 * Mirrors the former companion-window pattern (and OpenBitFun's frameless
 * pet shell): transparent always-on-top `BrowserWindow` hosting `/pet`,
 * with IPC `pet:open / close / move / resize / getPosition / savePosition /
 * pickPackage`.
 *
 * The window is content-sized. It opens at the base pet size and the page then
 * reports what it actually needs (`pet:resize`) — the pet alone when idle, the
 * pet plus its speech bubble when a session is running — the same protocol
 * OpenBitFun uses, and the reason the window can host a bubble at all.
 */
import {
  BrowserWindow,
  dialog,
  ipcMain,
  screen,
  type BrowserWindowConstructorOptions,
} from "electron";
import * as path from "node:path";

/** Pet footprint at scale 1; the page scales this with the user's size pref. */
const PET_WINDOW_BASE_WIDTH = 96;
const PET_WINDOW_BASE_HEIGHT = 104;
const PET_WINDOW_MIN_SIZE = 64;
/** Ceilings for the bubble-grown window, matching OpenBitFun's caps. */
const PET_WINDOW_MAX_WIDTH = 360;
const PET_WINDOW_MAX_HEIGHT = 240;
/** Gap between the pet and the bottom-right corner of the work area. */
const PET_WINDOW_MARGIN = 24;
/** Keeps a resize from parking the window flush against a screen edge. */
const PET_WINDOW_EDGE_MARGIN = 8;
const PET_WINDOW_TRANSPARENT_BG = "#00000000";

export interface PetWindowOptions {
  appOrigin: string;
  preloadDir: string;
  /**
   * Bring the main window to the front. The pet is a separate window with no
   * router of its own, so "click the pet to get back to the app" and "open this
   * bubble's session" both have to ask the shell to raise the main window.
   */
  focusMain?: () => void;
}

export interface PetWindowHandle {
  wireIpc(): void;
  isOpen(): boolean;
}

interface PositionResult {
  x: number;
  y: number;
}

interface SizeResult {
  width: number;
  height: number;
}

interface PetWindowState {
  win: BrowserWindow | null;
  preloadDir: string;
  appOrigin: string;
  focusMain?: (() => void) | undefined;
}

let openFlag = false;

export function isPetWindowOpen(): boolean {
  return openFlag;
}

function positionOk(value: unknown): value is PositionResult {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj["x"] === "number" &&
    Number.isFinite(obj["x"]) &&
    typeof obj["y"] === "number" &&
    Number.isFinite(obj["y"])
  );
}

/** Accept either `{ x, y }` or `{ position: { x, y } }` from the preload bridge. */
function coercePosition(payload: unknown): PositionResult | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;
  if (positionOk(obj)) return obj;
  if (positionOk(obj["position"])) return obj["position"];
  return null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

interface WorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

function clampToWorkAreas(
  pos: PositionResult,
  displays: readonly WorkArea[],
  primary: WorkArea,
): PositionResult {
  for (const a of displays) {
    const inside =
      pos.x >= a.x && pos.x <= a.x + a.width && pos.y >= a.y && pos.y <= a.y + a.height;
    if (inside) return pos;
  }
  return {
    x: Math.max(primary.x, primary.x + primary.width - PET_WINDOW_BASE_WIDTH - PET_WINDOW_MARGIN),
    y: Math.max(primary.y, primary.y + primary.height - PET_WINDOW_BASE_HEIGHT - PET_WINDOW_MARGIN),
  };
}

function clampToDisplays(pos: PositionResult): PositionResult {
  return clampToWorkAreas(
    pos,
    screen.getAllDisplays().map((d) => d.workArea),
    screen.getPrimaryDisplay().workArea,
  );
}

/**
 * Bottom-right of the primary work area — where a desktop pet belongs. The old
 * default was the top-left corner (0,0), which parked the pet on top of the
 * app's own title bar and read as "nothing happened" when the window was small.
 */
function defaultPetPosition(size: SizeResult): PositionResult {
  const area = screen.getPrimaryDisplay().workArea;
  return {
    x: area.x + area.width - size.width - PET_WINDOW_MARGIN,
    y: area.y + area.height - size.height - PET_WINDOW_MARGIN,
  };
}

/**
 * Fit a resized window inside a work area. Unlike `clampToWorkAreas`, which only
 * asks whether the top-left is on a known display, this one keeps the whole
 * window on screen, because a bubble can push the width past the right edge.
 */
function fitToWorkAreas(
  pos: PositionResult,
  size: SizeResult,
  displays: readonly WorkArea[],
  primary: WorkArea,
): PositionResult {
  const areas = displays.length > 0 ? displays : [primary];
  let host = primary;
  let bestOverlap = -1;
  for (const a of areas) {
    const overlapX = Math.min(pos.x + size.width, a.x + a.width) - Math.max(pos.x, a.x);
    const overlapY = Math.min(pos.y + size.height, a.y + a.height) - Math.max(pos.y, a.y);
    const overlap = Math.max(0, overlapX) * Math.max(0, overlapY);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      host = a;
    }
  }
  return {
    x: clamp(
      pos.x,
      host.x + PET_WINDOW_EDGE_MARGIN,
      host.x + host.width - size.width - PET_WINDOW_EDGE_MARGIN,
    ),
    y: clamp(
      pos.y,
      host.y + PET_WINDOW_EDGE_MARGIN,
      host.y + host.height - size.height - PET_WINDOW_EDGE_MARGIN,
    ),
  };
}

function fitToDisplays(pos: PositionResult, size: SizeResult): PositionResult {
  return fitToWorkAreas(
    pos,
    size,
    screen.getAllDisplays().map((d) => d.workArea),
    screen.getPrimaryDisplay().workArea,
  );
}

/** Test-only: sanitise an IPC position payload without touching Electron. */
export function positionForTest(payload: unknown): PositionResult | null {
  return coercePosition(payload);
}

/**
 * Test-only: clamp a position against a caller-supplied display list. The real
 * `screen` API isn't available under Node, so tests feed the work areas directly
 * (the first entry is the fallback "primary" when none is passed).
 */
export function clampToDisplaysForTest(
  pos: PositionResult,
  displays: readonly WorkArea[],
  primary: WorkArea = displays[0] ?? { x: 0, y: 0, width: 1920, height: 1080 },
): PositionResult {
  return clampToWorkAreas(pos, displays, primary);
}

/** Test-only: the size-aware fit used by the resize path. */
export function fitToDisplaysForTest(
  pos: PositionResult,
  size: SizeResult,
  displays: readonly WorkArea[],
  primary: WorkArea = displays[0] ?? { x: 0, y: 0, width: 1920, height: 1080 },
): PositionResult {
  return fitToWorkAreas(pos, size, displays, primary);
}

/** Test-only: the bottom-right default for a given work area and size. */
export function defaultPetPositionForTest(area: WorkArea, size: SizeResult): PositionResult {
  return {
    x: area.x + area.width - size.width - PET_WINDOW_MARGIN,
    y: area.y + area.height - size.height - PET_WINDOW_MARGIN,
  };
}

function openPetWindow(state: PetWindowState, payload: unknown): void {
  const size = {
    width: PET_WINDOW_BASE_WIDTH,
    height: PET_WINDOW_BASE_HEIGHT,
  };
  const saved = coercePosition(payload);
  const finalPos = clampToDisplays(saved ?? defaultPetPosition(size));

  if (state.win !== null && !state.win.isDestroyed()) {
    // Already open: leave the geometry alone. Re-applying the saved position here
    // undoes a drag the user has not released yet, and fights the resize anchor
    // that keeps the pet in its corner when a bubble grows the window.
    if (!state.win.isVisible()) state.win.show();
    openFlag = true;
    return;
  }

  const win = new BrowserWindow(buildOptions(state, finalPos));
  state.win = win;
  openFlag = true;
  win.on("closed", () => {
    state.win = null;
    openFlag = false;
  });
  win.once("ready-to-show", () => {
    win.show();
  });
  void win.loadURL(`${state.appOrigin}/pet`);
}

function closePetWindow(state: PetWindowState): void {
  if (state.win === null) return;
  if (!state.win.isDestroyed()) state.win.close();
  state.win = null;
  openFlag = false;
}

function movePetWindow(state: PetWindowState, payload: PositionResult): void {
  const win = state.win;
  if (win === null || win.isDestroyed()) return;
  win.setPosition(Math.round(payload.x), Math.round(payload.y));
}

function getPetWindowPosition(state: PetWindowState): PositionResult | null {
  const win = state.win;
  if (win === null || win.isDestroyed()) return null;
  const pos = win.getPosition();
  return { x: pos[0] ?? 0, y: pos[1] ?? 0 };
}

/**
 * Content-driven resize. The bottom-right corner is the anchor: growing for a
 * bubble has to extend up and to the left, or the pet itself would walk off the
 * screen edge it is parked against.
 */
function resizePetWindow(state: PetWindowState, payload: SizeResult): void {
  const win = state.win;
  if (win === null || win.isDestroyed()) return;
  const size = {
    width: Math.round(clamp(payload.width, PET_WINDOW_MIN_SIZE, PET_WINDOW_MAX_WIDTH)),
    height: Math.round(clamp(payload.height, PET_WINDOW_MIN_SIZE, PET_WINDOW_MAX_HEIGHT)),
  };
  const [currentWidth = size.width, currentHeight = size.height] = win.getSize();
  if (Math.abs(currentWidth - size.width) < 1 && Math.abs(currentHeight - size.height) < 1) return;

  const [currentX = 0, currentY = 0] = win.getPosition();
  // On Windows, `resizable: false` makes the window's minimum track size follow its
  // current size (queried as max(min, current)), so a plain `setSize` can only grow —
  // a bubble could appear but never leave. Re-enabling resizing for the call and
  // disabling it again re-pins that minimum to the new, smaller size. Keeping the
  // window non-resizable is deliberate: the pet is ~100px wide and its edge would
  // otherwise steal the drag.
  win.setResizable(true);
  win.setSize(size.width, size.height);
  win.setResizable(false);
  const next = fitToDisplays(
    { x: currentX + currentWidth - size.width, y: currentY + currentHeight - size.height },
    size,
  );
  win.setPosition(Math.round(next.x), Math.round(next.y));
}

function coerceSize(payload: unknown): SizeResult | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;
  const width = finiteNumber(obj["width"]);
  const height = finiteNumber(obj["height"]);
  if (width === null || height === null) return null;
  return { width, height };
}

function buildOptions(state: PetWindowState, pos: PositionResult): BrowserWindowConstructorOptions {
  return {
    width: PET_WINDOW_BASE_WIDTH,
    height: PET_WINDOW_BASE_HEIGHT,
    x: pos.x,
    y: pos.y,
    show: false,
    transparent: true,
    frame: false,
    backgroundColor: PET_WINDOW_TRANSPARENT_BG,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    hasShadow: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // CommonJS, matching the main window: a sandboxed renderer cannot load an ESM
      // preload (see tsup.preload.config.ts).
      preload: path.join(state.preloadDir, "preload.cjs"),
    },
  };
}

async function pickPetPackage(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: "Import Petdex package",
    properties: ["openDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0] ?? null;
}

export function createPetWindow(options: PetWindowOptions): PetWindowHandle {
  const state: PetWindowState = {
    win: null,
    preloadDir: options.preloadDir,
    appOrigin: options.appOrigin,
    focusMain: options.focusMain,
  };

  return {
    isOpen(): boolean {
      return state.win !== null && !state.win.isDestroyed();
    },
    wireIpc(): void {
      ipcMain.handle("pet:open", (_event, payload: unknown) => {
        openPetWindow(state, payload);
      });

      ipcMain.handle("pet:close", () => {
        closePetWindow(state);
      });

      ipcMain.handle("pet:move", (_event, payload: unknown) => {
        if (!positionOk(payload)) {
          throw new Error("pet:move requires { x: number, y: number }");
        }
        movePetWindow(state, payload);
      });

      ipcMain.handle("pet:resize", (_event, payload: unknown) => {
        const size = coerceSize(payload);
        if (size === null) {
          throw new Error("pet:resize requires { width: number, height: number }");
        }
        resizePetWindow(state, size);
      });

      ipcMain.handle("pet:getPosition", () => getPetWindowPosition(state));

      // Screen-space pointer, so the pet can look at the cursor. The renderer
      // knows its own window position, so it derives the offset itself.
      ipcMain.handle("pet:cursor", () => {
        const point = screen.getCursorScreenPoint();
        return { x: point.x, y: point.y };
      });

      ipcMain.handle("pet:focusMain", () => {
        state.focusMain?.();
      });

      ipcMain.handle("pet:savePosition", () => getPetWindowPosition(state));

      ipcMain.handle("pet:pickPackage", () => pickPetPackage());
    },
  };
}
