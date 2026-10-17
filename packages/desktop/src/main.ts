/**
 * Desktop shell main process.
 *
 * RUNTIME LAYER — MECHANISM ONLY (see packages/server/src/hmr/README.md). The
 * shell boots and hosts; it does not implement product behavior. It is also
 * the least updatable code in the system — a change here reaches users only
 * through a new installer — so a capability that could instead be delivered
 * by a platform push must be. A rejected example: adding a preload bridge so
 * the web UI could open DevTools, when the shell's own View menu already
 * does it.
 *
 * One window over the embedded server: fork jiumate-server as a utilityProcess on the
 * shared data root (JIUMATE_HOME or ~/.jiumate/data), learn its port (last launch's when
 * still free, so origin-scoped localStorage preferences survive restarts), and load
 * `http://localhost:<port>/api/auth/claim?token=…` — the one-shot token lands
 * the window signed in as admin. The window is a plain browser environment (no preload,
 * no node integration); every capability flows through the server's HTTP API.
 *
 * Attach mode: when a live server (e.g. `jiumate web`) already owns the data root, the
 * window loads that instance instead — normal login page, deliberate degradation.
 *
 * Dev isolation: an unpackaged run takes a dev-suffixed identity (own userData, and with
 * it the single-instance lock and sticky port) and defaults to the ~/.jiumate/dev-data
 * root, so it runs beside an installed release build (see app-identity.ts).
 *
 * Smoke hook (JIUMATE_DESKTOP_SMOKE=1): after the first load settles, print a
 * `DESKTOP-SMOKE-RESULT {json}` line (+ screenshot when JIUMATE_DESKTOP_SMOKE_SHOT is
 * set) and quit through the regular quit path, exercising the graceful server stop.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { resolveRoot } from "@prismshadow/jiumate-core";
import { liveServerLock } from "@prismshadow/jiumate-server/lock";
import { appIdentity, desktopDataRoot } from "./app-identity.js";
import { readSetupAnswers, seedStorage } from "./setup-import.js";
import { webDistEntry, webDistFor } from "./web-dist.js";
import { resolveTrayIcon, resolveWindowIcon } from "./app-icon.js";
import { installCliCommand, ensureCliCommand, currentCliInstallKind } from "./cli-install.js";
import { applyLoginShellEnv } from "./login-shell-env.js";
import { installAppMenu } from "./menu.js";
import { startEmbeddedServer, stopEmbeddedServer } from "./server-process.js";
import type { EmbeddedServer } from "./server-process.js";
import { getUpdaterStatus, handleUpdaterCommand, initUpdater, onUpdaterStatus } from "./updater.js";
import { parseUpdaterCommand, updaterStatusMessage } from "./updater-status.js";
import { wireExportPdf } from "./export-pdf.js";
import { createPetWindow, isPetWindowOpen, type PetWindowHandle } from "./pet-window.js";
import { registerThemePicker } from "./theme-picker.js";
import { registerWorkspacePicker } from "./workspace-picker.js";
import {
  destroyAppTray,
  ensureAppTray,
  setPetEnabled,
  setTrayRecent,
  type AppTrayDeps,
  type TrayRecentRow,
} from "./tray.js";
import {
  desktopLoginUrl,
  isAppUrl,
  isLocalSurfaceUrl,
  MAX_SERVER_RESTARTS,
  restartDelayMs,
} from "./util.js";

// Identity first: the name decides the userData directory, which also keys the
// single-instance lock requested below — a dev (unpackaged) run takes a dev-suffixed
// identity so it runs beside an installed release build instead of quitting into its
// window (#292; see app-identity.ts).
const identity = appIdentity(app.isPackaged);

/**
 * Height of the page-drawn title bar, in CSS pixels.
 *
 * Duplicated on purpose rather than shared: the desktop package is a separate build from the web
 * app and cannot import its stylesheet, and the renderer cannot import a constant from the main
 * process either (its preload is sandboxed). The web side's copy lives in styles.css as
 * `--jiumate-titlebar-height`; if one changes, the other has to follow, because a mismatch shows up
 * as content tucked under the window buttons.
 */
const TITLE_BAR_HEIGHT = 32;
app.setName(identity.name);
// Windows toasts (the web app's task-completion notifications) need the AppUserModelID
// of the installed shortcuts; electron-builder stamps them with the appId. Keep the
// release value in sync with electron-builder.yml. Dev runs stamp the dev-suffixed id
// so their taskbar/toast identity never claims the installed app's.
if (process.platform === "win32") app.setAppUserModelId(identity.appUserModelId);

let win: BrowserWindow | null = null;
let petHandle: PetWindowHandle | null = null;
let server: EmbeddedServer | null = null;
/** App origin (embedded or attached); null until boot resolves. */
let appOrigin: string | null = null;
let quitting = false;
let stopPromise: Promise<void> | null = null;
let restartAttempts = 0;

// app.name, not a literal: a dev run raises this box while the installed build may be
// running beside it, and a dialog titled "JiuMate" cannot be attributed to either.
function fatal(context: string, err: unknown): void {
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
  dialog.showErrorBox(app.name, `${context}\n\n${detail}`);
  app.exit(1);
}

/**
 * Bring the main window to the front. The floating pet is a separate window, so
 * a click on the pet — or on one of its bubbles — can only ask the shell to
 * raise the app; it has no router or session store of its own.
 *
 * `show()` comes before `restore()` in effect, because the window is usually *hidden* rather than
 * minimized now that the close button hides it — `restore()` alone would leave it invisible, and
 * a tray click or a second launch would look like it did nothing.
 */
function focusMain(): void {
  if (win === null || win.isDestroyed()) return;
  win.show();
  if (win.isMinimized()) win.restore();
  win.focus();
}

/**
 * The tray's "show desktop pet" checkbox. Both the checked state and the `enablePet` pref it flips
 * live in the renderer, so a click is a relay rather than a write. The app can outlive the main
 * window while the pet is open, and then there is nothing left that could write the pref — so the
 * window is brought back first.
 */
function requestPetToggle(): void {
  if (win === null || win.isDestroyed()) {
    if (appOrigin !== null) createWindow(`${appOrigin}/`);
    return;
  }
  win.webContents.send("pet:toggle-requested");
}

// Registered once, next to the tray it feeds. Kept out of `createWindow` because a window can be
// created more than once (macOS activate, a server restart) and re-registering a handle would throw.
wireTrayIpc();

/**
 * The app tray's relay.
 *
 * The three navigation actions are all "show the window, then tell the renderer to route". The
 * shell owns no router, so it cannot navigate itself: it hands the renderer a path and lets the
 * page do what it would do if the user had clicked the same thing in the UI. That is also what
 * keeps a tray click and an in-app click on the same target genuinely identical, rather than two
 * paths that have to be kept in step.
 */
function appTrayDeps(): AppTrayDeps {
  return {
    iconPath: resolveTrayIcon(app.getAppPath()),
    onShowMain: focusMain,
    onOpenSession: (sessionId) => routeTo(`/chat/${encodeURIComponent(sessionId)}`),
    onTogglePet: requestPetToggle,
    onNewChat: () => routeTo("/chat"),
    onSettings: () => routeTo("/settings"),
    // Quit through the same path as File → Quit, so the tray's Quit stops the embedded server
    // instead of killing the process with the server still up.
    onQuit: quitApp,
  };
}

/** Bring the window forward and ask the renderer to navigate to `path`. */
function routeTo(path: string): void {
  focusMain();
  win?.webContents.send("tray:navigate", path);
}

/**
 * The renderer pushing its recent-conversation list into the tray menu.
 *
 * Registered here rather than beside the tray because it is the one place that knows both sides:
 * the tray takes the rows, the renderer sends them. Idempotent per process, like every other
 * `ipcMain.handle` in this file.
 */
function wireTrayIpc(): void {
  ipcMain.handle("tray:setRecent", (_event, payload: unknown) => {
    if (!Array.isArray(payload)) {
      throw new Error("tray:setRecent requires an array");
    }
    // Validated rather than cast: the payload crosses a context boundary, so a shape the menu
    // cannot render has to be dropped here rather than becoming a blank row in the notification
    // area. `label` falls back to the id so a row is still openable.
    const rows = payload.flatMap((raw): TrayRecentRow[] => {
      if (typeof raw !== "object" || raw === null) return [];
      const row = raw as Record<string, unknown>;
      if (typeof row.sessionId !== "string" || row.sessionId === "") return [];
      return [
        {
          sessionId: row.sessionId,
          label: typeof row.label === "string" && row.label !== "" ? row.label : row.sessionId,
          kindLabel: typeof row.kindLabel === "string" ? row.kindLabel : "",
        },
      ];
    });
    setTrayRecent(rows);
  });

  /*
   * The pet's enabled state, reported so the tray's checkbox can show it.
   *
   * This used to create and destroy a second Tray. It now only records the value: the app tray is
   * already up, and a checkbox that appears and disappears with a feature is worse than one that is
   * always there and sometimes unticked.
   */
  ipcMain.handle("pet:setEnabled", (_event, payload: unknown) => {
    if (typeof payload !== "boolean") {
      throw new Error("pet:setEnabled requires a boolean");
    }
    setPetEnabled(payload);
  });

  /*
   * The title bar is the page's (see the `titleBarStyle` note in createWindow), so the page needs
   * to know when the window is maximized: Windows swaps the caption buttons to "restore" and grows
   * them, and without this the bar would keep the wrong right-hand inset.
   */
  ipcMain.handle("titlebar:isMaximized", (event) => {
    const target = BrowserWindow.fromWebContents(event.sender);
    return target?.isMaximized() ?? false;
  });
}

/** Forward maximize / unmaximize to the renderer, which draws the title bar. */
function wireTitleBarEvents(target: BrowserWindow): void {
  const send = () => {
    if (target.isDestroyed()) return;
    target.webContents.send("titlebar:maximizeChanged", target.isMaximized());
  };
  target.on("maximize", send);
  target.on("unmaximize", send);
  // `enter-full-screen` / `leave-full-screen` too: a maximized window that goes full-screen keeps
  // `isMaximized()` true on Windows, but the caption buttons are replaced by their own full-screen
  // row, so the inset the page reserved is no longer the right one.
  target.on("enter-full-screen", send);
  target.on("leave-full-screen", send);
}

/**
 * Quit for real: from the tray menu, the app menu, or the OS.
 *
 * The `quitting` flag is what makes this distinguishable from the window's close button, which
 * only hides (see the `close` handler in createWindow). It is set here rather than read from
 * `before-quit` because the tray's Quit is a *request* to quit, and the window close handler has to
 * be able to tell it apart from the user clicking the X.
 */
function quitApp(): void {
  quitting = true;
  app.quit();
}

function createWindow(url: string): void {
  // Linux window/taskbar icon (and Windows dev runs); packaged Windows uses the exe
  // resources and macOS its bundle icns, so those ignore it (see app-icon.ts).
  const iconPath = resolveWindowIcon(app.getAppPath(), process.platform);
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    show: false,
    autoHideMenuBar: true,
    ...(iconPath !== null ? { icon: iconPath } : {}),
    /*
     * The title bar is drawn by the page, not by Windows.
     *
     * With the default frame it is a native control: Windows paints it in the system accent colour
     * and no CSS can reach it. That is why it stayed pale while the rest of the window followed the
     * selected theme — the sidebar behind it was already themed, and this one strip was not.
     *
     * `hidden` removes the frame (so there is no native bar at all); `titleBarOverlay` keeps the
     * minimise / maximise / close buttons but positions them over the page, which is what lets the
     * strip be themed like everything else. The height is what the renderer reserves space for, so
     * the two have to agree — see TITLE_BAR_HEIGHT in the web app's styles.
     *
     * Windows-only: on macOS this is a different mechanism entirely (the traffic lights live in the
     * frame), and on Linux the overlay support varies by toolkit. Both keep the native bar rather
     * than losing their window controls.
     */
    ...(process.platform === "win32"
      ? {
          titleBarStyle: "hidden" as const,
          titleBarOverlay: {
            color: "#00000000",
            symbolColor: "#6b7280",
            height: TITLE_BAR_HEIGHT,
          },
        }
      : {}),
    webPreferences: {
      // Same hardening as before, plus the pet preload bridge. The bridge
      // exposes only `window.pet.open / close / savePosition` — enough for the
      // chat window to open the floating pet window when the user enables it
      // and to ask the pet window to close on toggle flips. No Node, no IPC
      // beyond the pet namespace.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // `.cjs`, not `.js`: a sandboxed renderer loads the preload as CommonJS and this
      // package is `"type": "module"` (see tsup.preload.config.ts).
      preload: path.join(__dirname, "preload.cjs"),
      // The installer's answers, handed to the preload synchronously. See setupSeedArg for why this
      // travels as an argument rather than over IPC or on `dom-ready`.
      additionalArguments: setupSeedArg(),
    },
  });
  win.once("ready-to-show", () => win?.show());
  // Only where the title bar is the page's. On macOS and Linux the frame is native, so there is
  // nothing for the renderer to adjust and the events would be dead weight.
  if (process.platform === "win32") wireTitleBarEvents(win);
  win.on("closed", () => {
    win = null;
  });
  // The close button hides the window instead of destroying it; the tray is how it comes back.
  //
  // `quitting` is what tells the two apart: the tray's Quit sets it before calling `app.quit()`, so
  // a real exit is never intercepted here and the window really goes. Without that flag this would
  // make the app unquittable — the window would survive its own Quit menu item.
  //
  // `before-quit` alone is not enough to distinguish them, because closing the last window does not
  // raise it (see `window-all-closed`): the two paths arrive at the same place by different routes.
  win.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    win?.hide();
  });
  // The tray goes up with the first window, not at app start: it is the window's home in the
  // notification area, and creating it before there is a window to hide would put an entry in the
  // tray with nothing behind it if startup then failed.
  ensureAppTray(appTrayDeps());
  // "Open in a new tab" (Workspace HTML previews) is an app-origin link that mints a
  // token and 302s to the preview origin — it needs the session cookie, so it must open
  // in a window of this app; handing it to the system browser would land on a 401.
  // Denying it outright (as this did at first) made the entry silently do nothing.
  // Genuinely external links still go to the system browser.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (isLocalSurfaceUrl(target, appOrigin)) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 1100,
          height: 800,
          autoHideMenuBar: true,
          ...(iconPath !== null ? { icon: iconPath } : {}),
          // Same hardening as the main window: the preview is Agent-written, untrusted
          // HTML and must never get Node.
          webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
        },
      };
    }
    void shell.openExternal(target);
    return { action: "deny" };
  });
  // The child lands on the preview origin after the redirect, so its policy is "stay
  // within this instance's loopback surface, everything else to the system browser" —
  // the main window's stricter app-origin-only rule would bounce the preview itself out.
  win.webContents.on("did-create-window", (child) => {
    child.webContents.setWindowOpenHandler(({ url: target }) => {
      if (isLocalSurfaceUrl(target, appOrigin)) return { action: "allow" };
      void shell.openExternal(target);
      return { action: "deny" };
    });
    child.webContents.on("will-navigate", (event, target) => {
      if (!isLocalSurfaceUrl(target, appOrigin)) {
        event.preventDefault();
        void shell.openExternal(target);
      }
    });
  });
  win.webContents.on("will-navigate", (event, target) => {
    if (!isAppUrl(target, appOrigin)) {
      event.preventDefault();
      void shell.openExternal(target);
    }
  });
  win.webContents.on("render-process-gone", () => win?.webContents.reload());
  armSmokeProbe(win);
  // The window's arguments already carry the installer's answers; nothing is injected here. See
  // setupSeedArg and the preload's own note for why that has to happen before navigation.
  void win.loadURL(url);
}

/**
 * The installer's answers, as the command-line arguments the preload reads.
 *
 * Two arguments, because the two kinds of answer have different homes:
 *
 *  - `--jiumate-setup-seed` — appearance and language, which the web app keeps in localStorage and
 *    whose stores read at mount. The preload writes them before any page script runs.
 *  - `--jiumate-setup-model` — the model choice. It cannot be a localStorage key: the default
 *    model is project-scoped (`PUT /api/projects/:id/models/default`) and no project exists at
 *    first launch, so there is nothing for the shell to write it onto. The web app applies this one
 *    once a Project is available.
 *
 * The model answer used to be written to `setup-model.json` and nothing ever read it: the file was
 * the visible half of the bug, something clearly intended to be consumed with no consumer. It is
 * still written, purely so a diagnostic can see what was chosen.
 *
 * Read once per window. The window cannot get the values any other way — its preload is sandboxed
 * and has no `fs`, and asking over IPC would make the seed asynchronous, which is the race this
 * replaces (see preload.ts).
 */
function setupSeedArg(): string[] {
  const answers = readSetupAnswers(app.getPath("userData"));
  if (answers === null) return [];

  const model = {
    provider: answers.provider ?? null,
    model: answers.model ?? null,
    baseUrl: answers.baseUrl ?? null,
    skipModel: answers.skipModel ?? true,
    apiKey: answers.apiKey ?? null,
  };
  try {
    fs.writeFileSync(
      path.join(app.getPath("userData"), "setup-model.json"),
      JSON.stringify(model, null, 2),
      "utf8",
    );
  } catch (err) {
    process.stdout.write(`[setup] could not record the model choice: ${String(err)}\n`);
  }

  // URL-encoded because this travels as one argv entry, and an API key can contain characters that
  // would otherwise split it.
  const args = [`--jiumate-setup-model=${encodeURIComponent(JSON.stringify(model))}`];
  const seed = seedStorage(answers);
  // JSON rather than `key=value` pairs: a value containing a space or a quote would otherwise be
  // split by the shell-style argument parsing this has to survive.
  if (Object.keys(seed).length > 0) args.push(`--jiumate-setup-seed=${JSON.stringify(seed)}`);
  return args;
}

/**
 * Client-update relay over the utilityProcess port: forward the account-menu row's
 * check/install frames to the updater, push every status fold back (plus the current
 * snapshot now — the fresh child, restarts included, must not start blind). The
 * subscription dies with the child; the next start wires the next one.
 */
function wireUpdaterRelay(child: EmbeddedServer["child"]): void {
  child.on("message", (message: unknown) => {
    const action = parseUpdaterCommand(message);
    if (action !== null) handleUpdaterCommand(action);
  });
  const unsubscribe = onUpdaterStatus((status) => child.postMessage(updaterStatusMessage(status)));
  child.on("exit", () => unsubscribe());
  child.postMessage(updaterStatusMessage(getUpdaterStatus()));
}

/** Starts (or restarts) the embedded server and points the window at the claim link. */
async function startServerAndWindow(dataRoot: string): Promise<void> {
  const webDist = webDistFor({
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    env: process.env,
  });
  // Checked here, not left to the server: a server with nothing to serve still starts,
  // and the window would open on a 404 with no line in the log naming the directory.
  if (webDist !== null && !fs.existsSync(webDistEntry(webDist))) {
    throw new Error(
      `The Web App is missing: ${webDistEntry(webDist)} does not exist. ` +
        `This build was packed without the web assets, or JIUMATE_WEB_DIST points elsewhere.`,
    );
  }
  const started = await startEmbeddedServer({
    dataRoot,
    webDist,
    portFile: path.join(app.getPath("userData"), "server-port"),
    preferredPortFile: path.join(app.getPath("userData"), "preferred-port"),
    log: (chunk) => process.stdout.write(`[server] ${chunk}`),
  });
  server = started;
  appOrigin = started.origin;
  wireUpdaterRelay(started.child);
  // The PDF-export inbox sits on the same utilityProcess port the updater uses. Both
  // relays filter by `type` discriminator before acting, so they coexist on one channel
  // and a crash in one does not affect the other.
  wireExportPdf(started.child);
  // A run that stays up for a minute is healthy: reset the restart budget so a crash
  // days later starts a fresh 1s/2s/4s ladder instead of hitting the cap immediately.
  const healthyTimer = setTimeout(() => {
    restartAttempts = 0;
  }, 60_000);
  started.child.on("exit", (code) => {
    clearTimeout(healthyTimer);
    void handleServerExit(dataRoot, code);
  });
  // Bring up the floating pet window plumbing now that the origin is known. The
  // IPC handlers stay inert until the chat window calls `window.pet.open`;
  // `__dirname` is the tsup output dir, where `preload.cjs` lives.
  if (petHandle === null) {
    petHandle = createPetWindow({
      appOrigin: started.origin,
      preloadDir: __dirname,
      focusMain,
    });
    petHandle.wireIpc();
  }
  registerThemePicker();
  registerWorkspacePicker();
  const url = desktopLoginUrl(started.origin, started.token);
  if (win === null) createWindow(url);
  else void win.loadURL(url);
}

/** Unexpected server death: restart with backoff; give up with an error dialog at the cap. */
async function handleServerExit(dataRoot: string, code: number): Promise<void> {
  if (quitting) return;
  server = null;
  if (restartAttempts >= MAX_SERVER_RESTARTS) {
    fatal(`The embedded server keeps exiting (last exit code ${code}).`, "Giving up.");
    return;
  }
  const wait = restartDelayMs(restartAttempts);
  restartAttempts += 1;
  process.stdout.write(`[shell] server exited (code ${code}); restarting in ${wait}ms\n`);
  await new Promise((resolve) => setTimeout(resolve, wait));
  if (quitting) return;
  try {
    await startServerAndWindow(dataRoot);
  } catch (err) {
    fatal("The embedded server could not be restarted.", err);
  }
}

async function boot(): Promise<void> {
  // Explicit JIUMATE_HOME wins; otherwise a release build shares the CLI's data root and
  // a dev run takes the repo's dev root (the rule, and why, live in app-identity.ts).
  const dataRoot = desktopDataRoot({
    envHome: process.env.JIUMATE_HOME,
    isPackaged: app.isPackaged,
    homedir: os.homedir(),
    releaseRoot: resolveRoot,
  });
  if (!app.isPackaged) {
    process.stdout.write(`[shell] dev instance '${app.name}' on data root ${dataRoot}\n`);
  }
  const existing = await liveServerLock(dataRoot);
  if (existing !== null) {
    // Attach mode: the one-shot token only works against a server this shell spawned,
    // so the window goes through the normal login page of the existing instance.
    appOrigin = `http://localhost:${existing.port}`;
    process.stdout.write(`[shell] attaching to the running server at ${appOrigin}\n`);
    if (petHandle === null) {
      petHandle = createPetWindow({
        appOrigin,
        preloadDir: __dirname,
        focusMain,
      });
      petHandle.wireIpc();
    }
    registerThemePicker();
    registerWorkspacePicker();
    createWindow(`${appOrigin}/`);
    return;
  }
  await startServerAndWindow(dataRoot);
}

// --- app lifecycle ---------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    // focusMain rather than restore+focus: with close now hiding the window, the running instance
    // is usually alive but invisible, and `restore()` does not un-hide it — `show()` has to happen
    // or a second launch appears to do nothing at all.
    focusMain();
  });

  app.on("window-all-closed", () => {
    // macOS keeps the app alive in the Dock; elsewhere closing the window quits —
    // unless the floating pet window is still open, in which case the user
    // explicitly asked for it and we'd yank it away on every chat-window close.
    if (process.platform === "darwin") return;
    if (isPetWindowOpen()) return;
    app.quit();
  });

  app.on("activate", () => {
    // Both branches matter now that close hides rather than destroys: the window usually still
    // exists and only needs raising, and `win === null` is the rarer path (a real window close,
    // e.g. from the renderer). Routing both through focusMain means one rule for "bring it back".
    if (appOrigin === null) return;
    if (win !== null && !win.isDestroyed()) {
      focusMain();
      return;
    }
    if (isPetWindowOpen()) return;
    createWindow(`${appOrigin}/`);
  });

  // Quit path: stop the embedded server gracefully first (shutdown endpoint → kill),
  // then let the quit proceed. Attach mode has no child to stop.
  app.on("before-quit", (event) => {
    quitting = true;
    destroyAppTray();
    if (server !== null && stopPromise === null) {
      event.preventDefault();
      const running = server;
      server = null;
      stopPromise = stopEmbeddedServer(running).finally(() => app.quit());
    }
  });

  void app.whenReady().then(() =>
    (async () => {
      // GUI launches on macOS/Linux miss the login shell's exports (model API keys for
      // core's env fallback, the PATH the agent shell needs). Import them fill-missing
      // before anything reads process.env — boot() resolves JIUMATE_HOME from it, and
      // the forked server inherits it (#351).
      await applyLoginShellEnv({
        platform: process.platform,
        env: process.env,
        shell: process.env.SHELL,
        log: (line) => process.stdout.write(`[shell] ${line}\n`),
      });
      // Standard menu plus native desktop-only actions; the window gets no IPC channel.
      installAppMenu({
        includeCliInstall: currentCliInstallKind() !== null,
        onInstallCli: () => void installCliCommand(win),
      });
      initUpdater(() => win);
      await boot();
      // Install or repair the bundled 'jiumate' command. Runs every launch: that is what
      // carries it across an update and repairs a link a moved app left dangling. Skipped
      // in smoke mode — the macOS administrator prompt would hang the automated run.
      if (process.env.JIUMATE_DESKTOP_SMOKE !== "1") await ensureCliCommand();
    })().catch((err) => fatal(`${app.name} failed to start.`, err)),
  );
}

// --- smoke hook ------------------------------------------------------------

/** Render-settle delay before sampling the page in smoke mode. */
const SMOKE_SETTLE_MS = 2500;

function armSmokeProbe(target: BrowserWindow): void {
  if (process.env.JIUMATE_DESKTOP_SMOKE !== "1") return;
  target.webContents.once("did-finish-load", () => {
    setTimeout(() => {
      void (async () => {
        try {
          const result = {
            title: target.webContents.getTitle(),
            url: target.webContents.getURL(),
            origin: appOrigin,
            embedded: server !== null,
          };
          const shot = process.env.JIUMATE_DESKTOP_SMOKE_SHOT;
          if (shot) {
            const image = await target.webContents.capturePage();
            const { writeFileSync } = await import("node:fs");
            writeFileSync(shot, image.toPNG());
          }
          process.stdout.write(`DESKTOP-SMOKE-RESULT ${JSON.stringify(result)}\n`);
        } catch (err) {
          process.stdout.write(`DESKTOP-SMOKE-RESULT ${JSON.stringify({ error: String(err) })}\n`);
        } finally {
          app.quit();
        }
      })();
    }, SMOKE_SETTLE_MS);
  });
}
