/**
 * Floating AI companion window — independent, frameless, transparent, always-on-top
 * `BrowserWindow` that hosts the web app at `/companion`. Loaded by `main.ts` over
 * an IPC bridge (`window.companion`); this module owns the Electron side:
 *
 * - The `companionWin` reference (single instance per shell; re-opening the same
 *   surface focuses the existing one).
 * - IPC handlers for `companion:open / close / move / getPosition / savePosition /
 *   notifyPrefsChange`, with NaN/Infinity guards so a buggy drag handler can't
 *   push the window off screen.
 * - The `window-all-closed` rule relaxes from "every closed window quits the app"
 *   to "no window quits the app" — closing the chat window must not yank the
 *   companion away, and vice versa.
 *
 * The companion window reuses the same loopback origin as the chat window
 * (a `/companion` sub-route) so the `linsight_session` cookie is automatically
 * shared. No new claim token, no new auth path.
 *
 * Persistence is the renderer's job, not the shell's: the shell is window-only
 * and never reaches into `ui_prefs`. Position persistence happens in the
 * companion window (it reads the position via `getPosition`, then PATCHes prefs
 * via `/api/me/prefs`). Placement changes that should close the floating window
 * arrive via `notifyPrefsChange` from the chat window.
 */
import { BrowserWindow, ipcMain, screen } from "electron";
import path from "node:path";

export interface CompanionWindowDeps {
  /** The main chat window's origin, used as the URL base for `/companion`. */
  appOrigin: string;
  /** The directory `preload.js` lives in after tsup runs. */
  preloadDir: string;
}

const WINDOW_WIDTH = 220;
const WINDOW_HEIGHT = 220;

/** Round and sanitise a candidate position. Rejects NaN, ±Infinity, and
 *  non-finite numbers so a buggy caller can't throw Electron into a confused state.
 *  Returns null when the value isn't usable; callers fall back to a default.
 *
 *  Exported (under a `_ForTest` suffix) so the unit test can pin the rejection
 *  rules without booting Electron. Production callers use the unexported helper. */
function sanitisePosition(raw: unknown): { x: number; y: number } | null {
  if (raw === null || typeof raw !== "object") return null;
  const x = (raw as { x?: unknown }).x;
  const y = (raw as { y?: unknown }).y;
  if (typeof x !== "number" || typeof y !== "number") return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: Math.round(x), y: Math.round(y) };
}

/** Test-only re-export. Not part of the production surface; consumed by
 *  test/companion-window.test.ts so the sanitisation rules can be pinned without
 *  booting Electron. */
export const sanitisePositionForTest = sanitisePosition;

/** Clamp a saved position to whichever display's workArea it most likely belongs
 *  to. A user who unplugged their second monitor between sessions would otherwise
 *  land on an invisible coordinate and see nothing. */
function clampToDisplays(pos: { x: number; y: number }): { x: number; y: number } {
  const displays = screen.getAllDisplays();
  for (const d of displays) {
    const a = d.workArea;
    const inside =
      pos.x >= a.x && pos.x <= a.x + a.width && pos.y >= a.y && pos.y <= a.y + a.height;
    if (inside) return pos;
  }
  // Fall back to the primary display's bottom-right corner with a sensible margin,
  // so the pet appears immediately rather than off-screen.
  const primary = screen.getPrimaryDisplay().workArea;
  return {
    x: Math.max(primary.x, primary.x + primary.width - WINDOW_WIDTH - 24),
    y: Math.max(primary.y, primary.y + primary.height - WINDOW_HEIGHT - 24),
  };
}

/** Test-only re-export that takes an explicit list of displays instead of calling
 *  Electron's `screen` API. Used by test/companion-window.test.ts to pin the
 *  clamping behaviour without mocking the entire `electron` module. */
export function clampToDisplaysForTest(
  pos: { x: number; y: number },
  displays: ReadonlyArray<{ workArea: { x: number; y: number; width: number; height: number } }>,
): { x: number; y: number } {
  for (const d of displays) {
    const a = d.workArea;
    const inside =
      pos.x >= a.x && pos.x <= a.x + a.width && pos.y >= a.y && pos.y <= a.y + a.height;
    if (inside) return pos;
  }
  const primary = displays[0]?.workArea ?? { x: 0, y: 0, width: 1920, height: 1080 };
  return {
    x: Math.max(primary.x, primary.x + primary.width - WINDOW_WIDTH - 24),
    y: Math.max(primary.y, primary.y + primary.height - WINDOW_HEIGHT - 24),
  };
}

export interface CompanionWindowHandle {
  /** IPC handlers are registered here; call exactly once at startup. */
  wireIpc(): void;
  /** Open (or focus) the floating window at the given position, or the default
   *  (primary display bottom-right) when null. */
  open(savedPos?: { x: number; y: number } | null): Promise<void>;
  /** Close the floating window (no-op if it's already closed). */
  close(): Promise<void>;
  /** `true` when the window is open and visible. */
  isOpen(): boolean;
}

/** Module-level so `window-all-closed` in main.ts can check it without holding the
 *  handle. main.ts imports `isCompanionWindowOpen` for that check. */
let openFlag = false;

export function isCompanionWindowOpen(): boolean {
  return openFlag;
}

export function createCompanionWindow(deps: CompanionWindowDeps): CompanionWindowHandle {
  let companionWin: BrowserWindow | null = null;

  /** Open a new BrowserWindow if none exists; otherwise focus the existing one.
   *  The window is frameless + transparent so the SVG pet shows on the user's
   *  desktop without a chrome border, and always-on-top so it sits over the chat
   *  window when desired. */
  async function openWindow(savedPos?: { x: number; y: number } | null): Promise<void> {
    if (companionWin !== null && !companionWin.isDestroyed()) {
      companionWin.show();
      companionWin.focus();
      return;
    }
    const finalPos = clampToDisplays(savedPos ?? { x: 0, y: 0 });

    companionWin = new BrowserWindow({
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
      x: finalPos.x,
      y: finalPos.y,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: path.join(deps.preloadDir, "preload.js"),
      },
    });
    companionWin.once("ready-to-show", () => {
      openFlag = true;
      companionWin?.show();
    });
    companionWin.on("closed", () => {
      openFlag = false;
      companionWin = null;
    });
    // The companion window shouldn't open sub-windows of its own; deny any
    // `window.open` from the page and let only same-origin links through (the
    // pet itself never opens them, but the SPA router might restore a session).
    companionWin.webContents.setWindowOpenHandler(({ url: target }) => {
      if (target.startsWith(deps.appOrigin)) return { action: "allow" };
      return { action: "deny" };
    });
    void companionWin.loadURL(`${deps.appOrigin}/companion`);
  }

  async function closeWindow(): Promise<void> {
    if (companionWin !== null && !companionWin.isDestroyed()) {
      companionWin.close();
    }
  }

  function wireIpc(): void {
    ipcMain.handle("companion:open", (_event, savedPos?: unknown) => {
      // The chat window may pass the position straight from prefs; sanitise here so
      // a malformed payload can't move the window off-screen.
      void openWindow(sanitisePosition(savedPos));
    });
    ipcMain.handle("companion:close", () => closeWindow());
    ipcMain.handle("companion:move", (_event, rawPos) => {
      const pos = sanitisePosition(rawPos);
      if (pos === null || companionWin === null || companionWin.isDestroyed()) return;
      companionWin.setPosition(pos.x, pos.y, false);
    });
    ipcMain.handle("companion:getPosition", () => {
      if (companionWin === null || companionWin.isDestroyed()) return null;
      const [x, y] = companionWin.getPosition();
      return { x, y };
    });
    ipcMain.handle("companion:savePosition", () => {
      // The renderer is the source of truth for persistence; we just return the
      // current screen position. The renderer then PUTs `companionFloatingPosition`
      // via /api/me/prefs.
      if (companionWin === null || companionWin.isDestroyed()) return null;
      const [x, y] = companionWin.getPosition();
      return { x, y };
    });
    // Chat window tells the shell that prefs changed; the shell reacts (close
    // when placement is no longer "floating"). The chat window itself reads the
    // userId from /api/me so the shell never has to.
    ipcMain.on("companion:notifyPrefsChange", (_event, payload: unknown) => {
      const placement =
        payload !== null && typeof payload === "object" && "companionPlacement" in payload
          ? (payload as { companionPlacement?: unknown }).companionPlacement
          : undefined;
      if (placement !== "floating") {
        void closeWindow();
      }
    });
  }

  return {
    wireIpc,
    open: openWindow,
    close: closeWindow,
    isOpen: () => openFlag,
  };
}
