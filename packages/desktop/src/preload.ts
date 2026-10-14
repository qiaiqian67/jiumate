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

/** Two-element screen position. Mirror of `petWindowPosition` in `UiPrefs`. */
export interface FloatingPosition {
  x: number;
  y: number;
}

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
 * The first-run setup wizard, exposed as `window.setup`.
 *
 * Its own bridge for the same reason `theme` has one: these are unrelated surfaces, and a name
 * that said `pet` or `theme` next to "which folder holds my data" would be the same confusion.
 *
 * **Window controls are here because the wizard's window is frameless** (setup-window.ts): the
 * page draws its own title bar, so it has to ask the shell to minimize or close. The whole
 * bridge is absent in a plain browser, which is what lets the same page render a working layout
 * with no dead buttons when someone types /setup by hand.
 */
const setupApi = {
  /** Minimize the wizard window. */
  minimize: (): Promise<void> => ipcRenderer.invoke("setup:minimize"),
  /**
   * Close the wizard window, which the shell reads as a skip: it writes no completion marker,
   * so the wizard asks again next launch. Distinct from `done` on purpose — "I did not finish"
   * and "I am done" are different answers and get different outcomes.
   */
  close: (): Promise<void> => ipcRenderer.invoke("setup:close"),
  /** Native folder picker for the data directory. Null when the user cancels. */
  pickDataDir: (): Promise<string | null> => ipcRenderer.invoke("setup:pickDataDir"),
  /** Put the bundled `jiumate` CLI on PATH. The shell owns the whole decision, including
   *  refusing to overwrite a command it did not write. */
  installCli: (): Promise<void> => ipcRenderer.invoke("setup:installCli"),
  /** The CLI install's current state: one of installed / current / foreign / deferred / failed,
   *  plus the reason. Read on mount so the page reports what is already true rather than
   *  re-running the install to find out. */
  cliState: (): Promise<{
    kind: string | null;
    lastResult: "installed" | "current" | "foreign" | "deferred" | "failed" | null;
    detail: string | null;
    declined: boolean;
  }> => ipcRenderer.invoke("setup:cliState"),
  /**
   * Whether each bundled component is on disk where the build said it would be.
   *
   * "The file is there", not "the command works" — the wizard cannot make the second claim, and
   * a page that reported the first as the second would be lying on exactly the day it matters.
   */
  components: (): Promise<{ id: "git" | "pandoc" | "pty"; ok: boolean; path: string | null }[]> =>
    ipcRenderer.invoke("setup:components"),
  /** Finish: the shell writes the completion marker, destroys this window and opens the app. */
  done: (lang: string): Promise<void> => ipcRenderer.invoke("setup:done", { lang }),
};

contextBridge.exposeInMainWorld("setup", setupApi);

/** The shape exposed to the renderer. The web side augments `Window` with this. */
export type SetupBridge = typeof setupApi;
