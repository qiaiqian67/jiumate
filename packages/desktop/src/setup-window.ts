/**
 * The first-run setup window.
 *
 * The NSIS/dmg installer puts the files on disk; this window is what the app shows
 * once, the first time it opens, to turn "installed" into "ready": pick a language, confirm
 * where its data lives, expose the bundled CLI, check the pieces the package carries, connect a
 * model, choose a look. It is a **separate `BrowserWindow`**, not a route in the main window —
 * the shell decides to show it (no marker on disk) and destroys it when the page reports
 * completion, so the main window never has to know a setup flow exists, and the marker it writes
 * is the only thing that makes the next launch skip it.
 *
 * Follows pet-window.ts for the shape (own window, own channel namespace, `preload.cjs` from
 * the tsup output dir) and theme-picker.ts for the IPC registration (namespaced channels,
 * idempotent `register` guard, `null` for "cancelled" rather than an error).
 *
 * **Frameless, because the reference design draws its own title bar** — brand mark, product
 * name, minimize/close. A native frame on top of that is two title bars; the window controls
 * are therefore the page's own, which means this module exposes them: `minimize` / `close`.
 * The page renders them only when the bridge exists, so the same build serves a plain browser
 * (`/setup` typed by hand) with a working layout and no dead buttons.
 */
import {
  BrowserWindow,
  dialog,
  ipcMain,
  app,
  type BrowserWindowConstructorOptions,
} from "electron";
import * as path from "node:path";
import fs from "node:fs";
import { installCliCommand, currentCliInstallKind } from "./cli-install.js";
import { readCliCommandState } from "./cli-link.js";
import { isSetupComplete as markerIsComplete, writeSetupMarker } from "./setup-marker.js";
import { DEV_PANDOC_DIR, PANDOC_RESOURCE_DIR, pandocBinaryName } from "./pandoc-path.js";
import { NODE_PTY_RELDIR } from "./pty-payload.js";

/** Channels the renderer's `window.setup` invokes. Namespaced like `pet:` and `theme:`. */
export const SETUP_MINIMIZE_CHANNEL = "setup:minimize";
export const SETUP_CLOSE_CHANNEL = "setup:close";
export const SETUP_PICK_DIR_CHANNEL = "setup:pickDataDir";
export const SETUP_INSTALL_CLI_CHANNEL = "setup:installCli";
export const SETUP_CLI_STATE_CHANNEL = "setup:cliState";
export const SETUP_COMPONENTS_CHANNEL = "setup:components";
export const SETUP_DONE_CHANNEL = "setup:done";

/** The wizard's own size, and the floor it may be dragged down to. */
const SETUP_WINDOW_WIDTH = 1024;
const SETUP_WINDOW_HEIGHT = 740;
const SETUP_MIN_WIDTH = 900;
const SETUP_MIN_HEIGHT = 620;

export interface SetupWindowOptions {
  appOrigin: string;
  preloadDir: string;
  /**
   * The shell's one-shot sign-in token, which this window redeems instead of the main window.
   *
   * The wizard is a full window on the app origin, so `/setup` sits behind the same auth guard
   * as every other route — but the token can only be spent once, and a wizard that let the main
   * window claim it would load `/setup` with no session and bounce to `/login`. So the wizard
   * takes the token: it navigates to the claim URL first (which sets the session cookie into the
   * shared session, visible to every window) and then on to `/setup`. The main window opens
   * afterwards against a cookie that is already there, and needs no token of its own.
   */
  loginToken: string;
  /** Open the main window and show it. Called once, after the page reports completion. */
  onDone: () => void;
  /** Open the main window without running the wizard (the "skip" affordances). */
  onSkip: () => void;
  /** Where the app's data root is, so the page can show it and the shell can offer to move it. */
  dataRoot: string;
}

export interface SetupWindowHandle {
  /** Idempotent; safe to call from either of main.ts's two boot paths. */
  wireIpc(): void;
  /** Open (or focus) the wizard window. */
  open(): void;
  isOpen(): boolean;
  /** True when a previous run wrote the marker — i.e. the wizard should be skipped. */
  isSetupComplete(): boolean;
}

/** The CLI install state, shaped for the page: the five real outcomes plus the reason. */
export interface CliStatePayload {
  /** What kind of install this build is, or null for a dev run / deb (which ships /usr/bin). */
  kind: string | null;
  lastResult: "installed" | "current" | "foreign" | "deferred" | "failed" | null;
  detail: string | null;
  /** True once the user declined the macOS admin prompt — do not keep asking. */
  declined: boolean;
}

function cliStatePayload(): CliStatePayload {
  const state = readCliCommandState(app.getPath("userData"));
  return {
    kind: currentCliInstallKind(),
    lastResult: state.lastResult ?? null,
    detail: state.detail ?? null,
    declined: state.decision === "declined",
  };
}

/** One bundled component's real availability. */
export interface ComponentProbe {
  id: "git" | "pandoc" | "pty";
  ok: boolean;
  /** Absolute path when found, for the tooltip; null when not. */
  path: string | null;
}

/**
 * Where each bundled component lives, in the order electron-builder.yml's `extraResources` and
 * scripts/build-assets.mjs stage it. A packaged app puts git and pandoc under
 * `<resourcesPath>/…`, a dev run stages them under `<appPath>/dist/bin/…`, and node-pty is not an
 * extraResource at all — it is a collected dependency under `dist/node_modules`.
 *
 * The check is "is the file where the build said it would be", which is the only question the
 * wizard can answer honestly: it is not running `git --version`, because a binary that exists and
 * a binary that works are different claims and this page should make only the first one.
 */
function probeComponents(): ComponentProbe[] {
  const resourcesPath = app.isPackaged ? process.resourcesPath : null;
  const appPath = app.getAppPath();
  const find = (...candidates: string[]): string | null => {
    for (const c of candidates) {
      if (c !== "" && fs.existsSync(c)) return c;
    }
    return null;
  };

  const gitExe = process.platform === "win32" ? "git.exe" : "git";

  const pandocBin = pandocBinaryName(process.platform);
  const pandoc = find(
    ...(resourcesPath !== null ? [path.join(resourcesPath, PANDOC_RESOURCE_DIR, pandocBin)] : []),
    path.join(appPath, DEV_PANDOC_DIR, pandocBin),
  );

  const git = find(
    ...(resourcesPath !== null ? [path.join(resourcesPath, "git", "bin", gitExe)] : []),
    path.join(appPath, "dist", "bin", "git", "bin", gitExe),
  );

  // node-pty is not an extraResource: it is a collected dependency, staged into
  // dist/node_modules/node-pty (see pty-payload.ts's NODE_PTY_RELDIR), so it lives under the
  // app path in both forms rather than under resourcesPath.
  const pty = find(path.join(appPath, ...NODE_PTY_RELDIR));

  return [
    { id: "git", ok: git !== null, path: git },
    { id: "pandoc", ok: pandoc !== null, path: pandoc },
    { id: "pty", ok: pty !== null, path: pty },
  ];
}

function buildOptions(o: SetupWindowOptions): BrowserWindowConstructorOptions {
  void o; // kept in the signature so the caller reads the same shape as pet-window's
  const iconPath = resolveWindowIconLocal();
  return {
    width: SETUP_WINDOW_WIDTH,
    height: SETUP_WINDOW_HEIGHT,
    minWidth: SETUP_MIN_WIDTH,
    minHeight: SETUP_MIN_HEIGHT,
    show: false,
    autoHideMenuBar: true,
    // The page draws its own title bar (the reference design's), so no native frame.
    frame: false,
    backgroundColor: "#0b0a0c",
    ...(iconPath !== null ? { icon: iconPath } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // `.cjs` because a sandboxed renderer refuses an ESM preload (see tsup.preload.config.ts).
      preload: path.join(o.preloadDir, "preload.cjs"),
    },
  };
}

/**
 * Linux/Windows taskbar icon. Kept local rather than imported from app-icon.ts so this module
 * does not drag the packaged-resource lookup into the wizard path; a wrong-or-missing icon on
 * the wizard window is cosmetic, and the main window still sets its own.
 */
function resolveWindowIconLocal(): string | null {
  try {
    if (process.platform === "win32") {
      return path.join(app.getAppPath(), "dist", "..", "build", "icon.png");
    }
  } catch {
    return null;
  }
  return null;
}

export function createSetupWindow(options: SetupWindowOptions): SetupWindowHandle {
  let win: BrowserWindow | null = null;
  let registered = false;
  /**
   * Whether the wizard has already reported an ending. Both the close channel and the window's
   * own `close` event want to report a skip, and closing the window is exactly what the channel
   * does — so without this the exit would run twice: once closing a window the second call no
   * longer owns, and once more for nothing. Also stops a skip from arriving after a done.
   */
  let settled = false;

  const isSetupComplete = (): boolean => markerIsComplete(app.getPath("userData"));

  const settle = (how: "done" | "skip"): void => {
    if (settled) return;
    settled = true;
    if (how === "done") options.onDone();
    else options.onSkip();
  };

  const wireIpc = (): void => {
    if (registered) return;
    registered = true;
    // Window controls. The page is frameless, so it has to ask for these.
    ipcMain.handle(SETUP_MINIMIZE_CHANNEL, () => {
      win?.minimize();
    });
    ipcMain.handle(SETUP_CLOSE_CHANNEL, () => {
      // Closing mid-wizard is a skip, not a completion: no marker is written, so the wizard
      // asks again next launch. That is the honest reading of "I did not finish" — and it is
      // why this is a close rather than a done.
      if (win !== null && !win.isDestroyed()) win.close();
      settle("skip");
    });
    ipcMain.handle(SETUP_PICK_DIR_CHANNEL, async () => {
      const result = await dialog.showOpenDialog({
        title: "Choose a data folder",
        properties: ["openDirectory", "createDirectory"],
        defaultPath: options.dataRoot,
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      return result.filePaths[0] ?? null;
    });
    ipcMain.handle(SETUP_INSTALL_CLI_CHANNEL, async () => installCliCommand(win));
    ipcMain.handle(SETUP_CLI_STATE_CHANNEL, () => cliStatePayload());
    // Read on mount, same as the CLI state: the page reports what is already on disk rather than
    // re-running a check to discover it.
    ipcMain.handle(SETUP_COMPONENTS_CHANNEL, () => probeComponents());
    ipcMain.handle(SETUP_DONE_CHANNEL, (_e, payload: unknown) => {
      const lang =
        typeof payload === "object" &&
        payload !== null &&
        typeof (payload as { lang?: unknown }).lang === "string"
          ? (payload as { lang: string }).lang
          : undefined;
      if (!writeSetupMarker(app.getPath("userData"), lang)) {
        // A wizard that cannot record itself shows again next launch. Not fatal — the app works
        // either way — but it is worth a line in the log, because otherwise the only symptom is
        // a user reporting they keep seeing the setup screen.
        process.stdout.write(`[setup] could not write the completion marker\n`);
      }
      // `destroy` rather than `close`: the `close` event would report a skip, and this window
      // has just reported a done.
      if (win !== null && !win.isDestroyed()) win.destroy();
      win = null;
      settle("done");
    });
  };

  const open = (): void => {
    if (win !== null && !win.isDestroyed()) {
      if (!win.isVisible()) win.show();
      win.focus();
      return;
    }
    // Reopening after an ending (the user typed /setup again) is a fresh run, so the guard
    // resets with the window.
    settled = false;
    win = new BrowserWindow(buildOptions(options));
    win.on("closed", () => {
      win = null;
    });
    win.once("ready-to-show", () => win?.show());
    // Closing by any route — the page's own control, the OS, Alt-F4 — is a skip. Registered on
    // `close` rather than `closed` so the window still exists to be asked about, and so the
    // one-shot guard can suppress the duplicate.
    win.on("close", () => {
      settle("skip");
    });
    // Two navigations, and the first one matters: the claim endpoint sets the session cookie and
    // redirects to `/`, which would be the chat page. `/setup` is behind the same guard, so the
    // cookie has to exist before the wizard's own URL is requested — hence claim-then-navigate
    // rather than navigating straight to `/setup` and hoping the guard lets it through.
    void win
      .loadURL(
        `${options.appOrigin}/api/auth/claim?token=${encodeURIComponent(options.loginToken)}`,
      )
      .then(() => win?.loadURL(`${options.appOrigin}/setup`));
  };

  return {
    wireIpc,
    open,
    isOpen: () => win !== null && !win.isDestroyed(),
    isSetupComplete,
  };
}
