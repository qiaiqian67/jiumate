/**
 * Global window augmentations for the renderer.
 *
 * The Electron preload bridge exposes `window.pet` (frameless pet window
 * open/close/move/resize/savePosition). The TS-side augmentation mirrors the
 * `PetBridge` type from `packages/desktop/src/preload.ts`; the import
 * path is `@prismshadow/linsight-desktop` if a build-time alias is wired,
 * otherwise we re-declare the surface here so the renderer compiles.
 */
export {};

declare global {
  interface Window {
    /**
     * The desktop shell's theme bridge. Absent in a plain browser, where the import control
     * falls back to a typed path — so every call site has to null-check it.
     */
    theme?: {
      /** Native folder picker; null when the user cancels. */
      pickFolder(): Promise<string | null>;
    };
    pet?: {
      open(savedPos?: { x: number; y: number } | null): Promise<void>;
      close(): Promise<void>;
      move(pos: { x: number; y: number }): Promise<void>;
      resize(size: { width: number; height: number }): Promise<void>;
      getPosition(): Promise<{ x: number; y: number } | null>;
      savePosition(): Promise<{ x: number; y: number } | null>;
      /** Screen-space cursor position, for the pet's look-at-cursor frames. */
      cursor(): Promise<{ x: number; y: number }>;
      /** Raise the main window (pet click, or opening a bubble's session). */
      focusMain(): Promise<void>;
      pickPackage(): Promise<string | null>;
      /** Report the `enablePet` pref so the shell can create or drop the tray icon. */
      setEnabled(enabled: boolean): Promise<void>;
      /** Listen for the tray's pet toggle; returns an unsubscribe function. */
      onToggleRequested(listener: () => void): () => void;
    };
  }
}
