/**
 * Petdex pet window preload script.
 *
 * Exposes a small, typed surface (`window.pet`) to BOTH the main chat window
 * (which calls `open` / `close` on toggle flips) and the floating pet window
 * itself (which can persist its drag-released position).
 *
 * Sandbox note: with `sandbox: true` the preload runs in a restricted context
 * but can still import the `electron` module for `contextBridge` / `ipcRenderer`.
 * Anything beyond that (Node built-ins, network APIs, …) is intentionally
 * blocked.
 *
 * Build note: this file is bundled to CommonJS (`dist/preload.cjs`) by
 * tsup.preload.config.ts. A sandboxed renderer refuses an ESM preload outright,
 * so it must not be folded back into the ESM build in tsup.config.ts.
 */
import { contextBridge, ipcRenderer } from "electron";

/**
 * The installer's answers, seeded into localStorage before any page script runs.
 *
 * ## Why preload, and why synchronously
 *
 * This is the only point guaranteed to be earlier than the web app's own scripts. The main process
 * used to do it with `executeJavaScript` on `dom-ready`, which is too late in two independent ways,
 * and both of them made a language, a theme and a model chosen in the installer silently do
 * nothing:
 *
 *  1. The window navigates to `/api/auth/claim?token=…`, which 302s to the app. `dom-ready` fires
 *     for the *resolved* document — after the React root has mounted and the locale/theme stores
 *     have read `localStorage` for their initial state. A write there fills a key nobody reads
 *     again this load: the user sees the default, and the value would only surface on the *next*
 *     launch, if ever.
 *  2. `executeJavaScript` returns a promise the call site did not await, so the write raced the
 *     mount even on a frame where the timing happened to work.
 *
 * ## Why the values arrive as an argument, not over IPC
 *
 * A preload that awaits `ipcRenderer.invoke` yields to the event loop, and the document's scripts
 * get their turn in that gap — which is the same race, just relocated. Electron runs the preload
 * synchronously during navigation setup, so the seed has to be synchronous too: the values ride
 * in on `additionalArguments`, and this block is plain top-level code that runs to completion
 * before the document loads.
 */
const SEED_ARG_PREFIX = "--jiumate-setup-seed=";
const seedArg = process.argv.find((a) => a.startsWith(SEED_ARG_PREFIX));
if (seedArg !== undefined) {
  try {
    const seed = JSON.parse(seedArg.slice(SEED_ARG_PREFIX.length)) as Record<string, string>;
    for (const [key, value] of Object.entries(seed)) {
      try {
        localStorage.setItem(key, value);
      } catch {
        // Blocked or full storage is not a reason to fail the launch; the app opens on defaults.
      }
    }
    // The pre-paint appearance cache has to agree with the store, or the first paint uses the old
    // one and the theme visibly snaps a frame later.
    try {
      const prev = localStorage.getItem("jiumate.skin.bootstrap");
      if (prev) {
        const cached = JSON.parse(prev) as Record<string, unknown>;
        const theme = localStorage.getItem("jiumate.theme");
        const mode = localStorage.getItem("jiumate.mode");
        if (theme !== null) cached.skin = theme;
        if (mode !== null) cached.dark = mode === "dark";
        localStorage.setItem("jiumate.skin.bootstrap", JSON.stringify(cached));
      }
    } catch {
      // A malformed cache is not worth failing over: the store re-derives it on mount.
    }
  } catch {
    // Unparseable seed (a hand-edited profile, say): the app starts on its own defaults.
  }
}

/**
 * The installer's model choice, handed to the web app.
 *
 * Not localStorage and not a `store` applied at mount: the default model is project-scoped
 * (`PUT /api/projects/:id/models/default`), and at first launch no Project exists yet — so there is
 * nothing to write it onto. The web app therefore holds it and applies it the moment a Project
 * appears (see web/src/lib/setup-model.ts).
 *
 * Exposed on `window.jiumateSetup` rather than as its own bridge, because it is not a capability
 * the page asks for — it is a handover that happens once, whether or not the page ever looks at it.
 */
const MODEL_ARG_PREFIX = "--jiumate-setup-model=";
const modelArg = process.argv.find((a) => a.startsWith(MODEL_ARG_PREFIX));
contextBridge.exposeInMainWorld(
  "jiumateSetup",
  modelArg === undefined ? null : safeParseModel(modelArg.slice(MODEL_ARG_PREFIX.length)),
);

function safeParseModel(encoded: string): unknown {
  try {
    return JSON.parse(decodeURIComponent(encoded));
  } catch {
    // A hand-edited or truncated argument is not worth failing the launch over.
    return null;
  }
}

/** Two-element screen position. Mirror of `petWindowPosition` in `UiPrefs`. */
export interface FloatingPosition {
  x: number;
  y: number;
}

/** One recent conversation, as the tray menu shows it. */
export interface TrayRecentRow {
  sessionId: string;
  label: string;
  kindLabel: string;
}

/**
 * The tray menu's recent-conversation list, as `window.trayRecent`.
 *
 * A one-way push rather than a pull: the main process could fetch the list itself, but it has no
 * Project or Agent to ask about (those live in the renderer's stores), so the renderer sends the
 * rows it already has whenever they change.
 */
const trayRecentApi = {
  /** Replace the list the tray shows. */
  set: (rows: TrayRecentRow[]): Promise<void> => ipcRenderer.invoke("tray:setRecent", rows),
};

contextBridge.exposeInMainWorld("trayRecent", trayRecentApi);

export type TrayRecentBridge = typeof trayRecentApi;

/**
 * The tray's navigation requests, as `window.trayNavigate`.
 *
 * The shell has no router — it cannot navigate itself, and re-implementing the app's routing in
 * the main process would mean two places to keep in step with the URL structure. So a tray click
 * sends a path and the page navigates, which is also what makes a tray click and an in-app click on
 * the same target genuinely identical.
 */
const trayNavigateApi = {
  /** Subscribe to navigation requests; returns an unsubscribe function. */
  onNavigate: (listener: (path: string) => void): (() => void) => {
    const handler = (_event: unknown, path: unknown) => {
      // Only app-internal paths: the tray is the app's own UI, but the channel is a plain string
      // from the main process and a stray value should not be able to push the page off-origin.
      if (typeof path !== "string" || !path.startsWith("/")) return;
      listener(path);
    };
    ipcRenderer.on("tray:navigate", handler);
    return () => {
      ipcRenderer.removeListener("tray:navigate", handler);
    };
  },
};

contextBridge.exposeInMainWorld("trayNavigate", trayNavigateApi);

export type TrayNavigateBridge = typeof trayNavigateApi;

/**
 * The window's own chrome state, as `window.titleBar`.
 *
 * The title bar is drawn by the page (see web/src/components/layout/desktop-title-bar.tsx) so it
 * can follow the selected theme, with the native caption buttons floating over it. Two things the
 * page cannot know on its own:
 *
 *  - whether the window is maximized, which changes both the caption buttons' size and whether a
 *    sliver of page would show above the frame;
 *  - nothing else — dragging is `-webkit-app-region: drag` in CSS, no bridge needed.
 *
 * Desktop shell only; absent in a browser and on the platforms that keep a native title bar.
 */
const titleBarApi = {
  /** Whether the window is maximized right now. */
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke("titlebar:isMaximized"),
  /** Subscribe to maximize / unmaximize. Returns an unsubscribe function. */
  onMaximizeChanged: (listener: (maximized: boolean) => void): (() => void) => {
    const handler = (_event: unknown, value: unknown) => {
      if (typeof value === "boolean") listener(value);
    };
    ipcRenderer.on("titlebar:maximizeChanged", handler);
    return () => {
      ipcRenderer.removeListener("titlebar:maximizeChanged", handler);
    };
  },
};

contextBridge.exposeInMainWorld("titleBar", titleBarApi);

export type TitleBarBridge = typeof titleBarApi;

/** Content size the floating window should adopt (pet alone, or pet + bubble). */
export interface FloatingSize {
  width: number;
  height: number;
}

const api = {
  /** Open the floating pet window at the saved position, or at the default
   *  location when no position is provided (or the value fails validation). */
  open: (savedPos?: FloatingPosition | null): Promise<void> =>
    ipcRenderer.invoke("pet:open", savedPos ?? null),
  /** Close the floating window — the toggle stays in `ui_prefs` so a re-open
   *  restores the position. */
  close: (): Promise<void> => ipcRenderer.invoke("pet:close"),
  /** Move the window to an absolute screen position (rejects non-finite values). */
  move: (pos: FloatingPosition): Promise<void> => ipcRenderer.invoke("pet:move", pos),
  /** Resize the window to fit its content. The shell keeps the bottom-right
   *  corner fixed, so a bubble grows up and to the left of the pet. */
  resize: (size: FloatingSize): Promise<void> => ipcRenderer.invoke("pet:resize", size),
  /** Screen-space cursor position, for the pet's look-at-cursor frames. */
  cursor: (): Promise<FloatingPosition> => ipcRenderer.invoke("pet:cursor"),
  /** Raise the main window (pet click, or opening a bubble's session). */
  focusMain: (): Promise<void> => ipcRenderer.invoke("pet:focusMain"),
  /** Read the current screen position, or null if the window isn't open. */
  getPosition: (): Promise<FloatingPosition | null> => ipcRenderer.invoke("pet:getPosition"),
  /** Persist the current position into `ui_prefs` so the next open restores here. */
  savePosition: (): Promise<FloatingPosition | null> => ipcRenderer.invoke("pet:savePosition"),
  /** Native folder picker for importing a Petdex package directory. */
  pickPackage: (): Promise<string | null> => ipcRenderer.invoke("pet:pickPackage"),
  /**
   * Report the `enablePet` pref so the shell can create or drop the tray icon. The
   * tray exists only while the pet does — see `pet-tray.ts`.
   */
  setEnabled: (enabled: boolean): Promise<void> => ipcRenderer.invoke("pet:setEnabled", enabled),
  /**
   * Listen for the tray's "show desktop pet" click. The pref lives in the renderer,
   * so the shell can only ask for the flip; returns an unsubscribe function.
   */
  onToggleRequested: (listener: () => void): (() => void) => {
    const handler = () => listener();
    ipcRenderer.on("pet:toggle-requested", handler);
    return () => {
      ipcRenderer.removeListener("pet:toggle-requested", handler);
    };
  },
};

contextBridge.exposeInMainWorld("pet", api);

/** The shape exposed to the renderer. The web side augments `Window` with this. */
export type PetBridge = typeof api;

/**
 * The theme import picker, exposed as `window.theme`.
 *
 * Its own bridge rather than a method on `pet`: the two have nothing to do with each other, and
 * a name that said `pet` next to a theme import would be the same confusion the Appearance page
 * was just cleaned of.
 */
const themeApi = {
  /**
   * Native folder picker for importing a theme directory. Resolves to null when the user
   * cancels, so the caller can treat "cancelled" and "chose nothing" identically.
   */
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke("theme:pickFolder"),
};

contextBridge.exposeInMainWorld("theme", themeApi);

/** The shape exposed to the renderer. The web side augments `Window` with this. */
export type ThemeBridge = typeof themeApi;

/**
 * The native folder picker for choosing a Workspace directory, as `window.workspace`.
 *
 * Its own bridge for the same reason `theme` has one: a method on `theme` named
 * `pickWorkspaceFolder` would put a workspace call under a name that says "theme", and the two
 * will want different dialog copy anyway.
 */
const workspaceApi = {
  /**
   * Open the OS directory chooser. Resolves to null when the user cancels, so the caller can
   * treat "cancelled" and "chose nothing" identically.
   *
   * Optional on the web side: in a plain browser this bridge does not exist, and the renderer
   * hides the entry rather than showing a control that cannot work.
   */
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke("workspace:pickFolder"),
};

contextBridge.exposeInMainWorld("workspace", workspaceApi);

/** The shape exposed to the renderer. The web side augments `Window` with this. */
export type WorkspaceBridge = typeof workspaceApi;
