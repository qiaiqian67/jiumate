/**
 * Schema for a Linsight theme package.
 *
 * The format is **Codex Dream Skin's**, adopted rather than translated: a theme declares a
 * palette of ten roles, the shells its artwork holds up under, and how to frame that artwork.
 * Upstream's `theme-package-validator.mjs` is the reference for every rule here, and keeping the
 * shape identical means a theme written for that project imports without a converter — which is
 * the entire reason this file looks the way it does.
 *
 *   id          — slug; filesystem-friendly, and the directory name.
 *   name        — human label shown by the picker.
 *   appearance  — "light", "dark" or "auto": which shells the artwork holds up under.
 *   colors      — the palette, ten roles. See `roles.ts`.
 *   art         — where the subject sits and how to frame it.
 *   image       — one file beside the manifest.
 *   linsight    — optional extras this host understands and upstream ignores.
 *
 * ## What is *not* declared
 *
 * The CSS ramp is not part of the format. It is derived from `colors` for both readings — see
 * `palette.ts` for why one palette has to be laid out twice — so a theme cannot ship a ramp that
 * contradicts its own palette, and an author writes one set of colours rather than two.
 *
 * Runtime validation happens in `io.ts`'s `coerceSkinPackage`, matching how the pet package
 * keeps its IO module free of a schema library.
 */
import type {
  ThemeAppearance,
  ThemeArt,
  ThemeColors,
  ThemeMode,
  ThemeSafeArea,
  ThemeTaskMode,
} from "./roles.js";
import type { ThemeTokens } from "./palette.js";

export type {
  ThemeAppearance,
  ThemeArt,
  ThemeColorKey,
  ThemeColors,
  ThemeMode,
  ThemeSafeArea,
  ThemeTaskMode,
} from "./roles.js";
export {
  THEME_APPEARANCES,
  THEME_COLOR_KEYS,
  THEME_MODES,
  THEME_SAFE_AREAS,
  THEME_SURFACE_KEYS,
  THEME_TASK_MODES,
  isThemeAppearance,
  isThemeMode,
  isThemeSafeArea,
  isThemeTaskMode,
} from "./roles.js";

/** Where a wallpaper's subject sits, so the UI is not painted over it. */
export interface SkinBackground {
  filename: string;
  /** Absolute path; the host reads from it. The web app builds its URL from `filename`. */
  assetPath: string;
  mimeType: string;
  /** Horizontal focal point, 0 (left edge) to 1 (right edge). */
  focusX: number;
  /** Vertical focal point, 0 (top edge) to 1 (bottom edge). */
  focusY: number;
  /** Scale multiplier; 1 fits the image to the viewport. */
  zoom: number;
  /** How much to darken the image so foreground text stays readable, 0 to 1. */
  dim: number;
}

/**
 * Provenance for a theme imported from a Codex-Dream-Skin package.
 *
 * Their format carries copy for the Codex shell's own chrome (`tagline`, `projectLabel`,
 * `statusText`, …). Linsight has no surface for those strings, so they are kept here rather than
 * dropped: a round-trip export can put them back, and nothing has to pretend they were consumed.
 */
export interface SkinOrigin {
  format: "dreamskin";
  /** The `id` in the source theme, before any prefix was applied. */
  originalId: string;
  /** The source `appearance` field, kept verbatim. */
  appearance: string | null;
  /** The source's copy strings, keyed as they appeared. */
  copy: Record<string, string>;
}

/** Extras this host understands. Upstream ignores the block entirely. */
export interface SkinExtras {
  /** A `--font-app-sans` stack, or null to keep the app's own. */
  font: string | null;
}

export interface SkinPackage {
  id: string;
  name: string;
  author: string | null;
  description: string | null;
  version: string;
  appearance: ThemeAppearance;
  /** "preset" (shipped with the host) or "user" (installed). */
  source: string;
  /** Absolute on-disk path to the theme directory. */
  packagePath: string;
  /** The declared palette. Ten roles, always all of them. */
  colors: ThemeColors;
  art: ThemeArt;
  /**
   * The CSS ramp, derived from {@link colors} for **both** readings. Not part of the on-disk
   * format; see `palette.ts` for why a palette is laid out twice.
   */
  tokens: Record<ThemeMode, ThemeTokens>;
  /**
   * The subset of each reading's tokens that names a *surface* — a background the UI sits on,
   * as opposed to text or a border.
   *
   * This is what makes surface transparency a user preference instead of a constant baked into
   * a colour value: the theme says which tokens are surfaces, and the host applies the user's
   * chosen alpha to exactly those when it renders the stylesheet.
   */
  surfaces: Record<ThemeMode, string[]>;
  extras: SkinExtras;
  background: SkinBackground | null;
  /** Absolute path to the picker thumbnail, or null. */
  previewPath: string | null;
  previewMimeType: string | null;
  origin: SkinOrigin | null;
}

/**
 * Receipt written next to `theme.json` when a theme was imported from an upstream source.
 * Lets a subsequent install detect "same source, same content" without comparing the manifest
 * by hand — the same job the pet receipt does.
 */
export interface SkinReceipt {
  schemaVersion: number;
  sourceKey: string;
  fingerprint: string;
  installedFingerprint: string;
}

/**
 * The readings a theme serves.
 *
 * Always both, because the derived ramps are two namings of the same absolute colours. What
 * `appearance` decides is which shell the host *pins* — the parts of the window this host does
 * not paint (native scrollbars, form controls, `color-scheme`) have to agree with the artwork.
 */
export function themeModes(pkg: { appearance: ThemeAppearance }): readonly ThemeMode[] {
  return ["light", "dark"];
}
