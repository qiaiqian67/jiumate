/**
 * Bounds, schema version, and the token allowlist for JiuMate skin packages.
 *
 * The package shape mirrors OpenBitFun's `AppearancePackage`
 * (`web-ui/src/infrastructure/appearance/types/index.ts`), narrowed to the one renderer
 * this host implements: `theme-tokens`. A skin is therefore a map of CSS custom
 * properties layered over the built-in appearance for a single mode, plus an optional
 * background image.
 *
 * Any change to the allowlist is a wire-format break for already-published skins; treat
 * it the way the pet package treats its own constants.
 */
import { THEME_MODES } from "./roles.js";
import type { ThemeMode } from "./roles.js";
import type { ThemeTokens } from "./palette.js";

/** Manifest-side guard: a single `skin.json` must not exceed this many bytes (64 KiB). */
export const MANIFEST_LIMIT = 64 * 1024;

/** Asset-side guard: a single background/preview image must not exceed this many bytes (16 MiB). */
export const ASSET_LIMIT = 16 * 1024 * 1024;

/** Hard cap on the number of skins under one catalog (128). Mirrors `MAX_PACKAGES`. */
export const MAX_SKINS = 128;

/** Hard cap on token declarations in one skin. The allowlist is 28 entries, so this only
 *  ever bites on a manifest that repeats or smuggles keys. */
export const MAX_TOKENS = 64;

/** Longest a single token value may be. Guards a pathological font stack. */
export const TOKEN_VALUE_LIMIT = 512;

/** Longest a skin id may be. */
export const SKIN_ID_LIMIT = 64;

/** Longest a display name / author / description may be. */
export const SKIN_NAME_LIMIT = 128;
export const SKIN_AUTHOR_LIMIT = 128;
export const SKIN_DESCRIPTION_LIMIT = 4096;

/** The `schema` discriminator every skin manifest carries. */
export const SKIN_SCHEMA = "jiumate.skin";

/**
 * The `schema` value written before the rebrand, still accepted on read.
 *
 * The same reasoning as `INSPIRATION_SCHEMA_LEGACY` in `@jadelau/inspirations`, and
 * for the same reason: a theme installed under the old name keeps declaring it, and refusing that
 * makes the theme silently vanish from the picker with one line in the log as the only trace. A
 * name this build used to write is an older file of ours, not an invalid one — and unlike a
 * built-in skin, an installed theme is a user's own file, so there is nothing to protect by
 * rejecting it.
 */
export const SKIN_SCHEMA_LEGACY = "linsight.skin";

/** Every `schema` value a skin manifest may carry and still be read. */
export const SKIN_SCHEMA_ACCEPTED: ReadonlySet<string> = new Set([SKIN_SCHEMA, SKIN_SCHEMA_LEGACY]);

/** Schema version written into `skin.json`. */
export const SKIN_SCHEMA_VERSION = 1;

/** Conventional receipt filename written next to `skin.json` after a successful install. */
export const RECEIPT_FILENAME = ".jiumate-skin-receipt.json";

/** Schema version written into the receipt. Bump when the on-disk shape changes incompatibly. */
export const RECEIPT_SCHEMA_VERSION = 1;

/** Skin ids: ASCII lowercase letters, digits, dash, underscore — safe as a directory name. */
export const SKIN_SLUG_REGEX = /^[a-z0-9_-]+$/;

/** Semantic versions a manifest may declare (`1.0.0`). Mirrors Codex-Dream-Skin's pattern. */
export const SEMVER_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

// ---------------------------------------------------------------------------
// Token allowlist
// ---------------------------------------------------------------------------

/**
 * Tier 1 — structural colors: the surfaces, text and borders the whole app is painted
 * with. This is the tier that makes a skin look like a skin.
 *
 * Tailwind 4 emits its utilities as variable references (`bg-gray-100` compiles to
 * `background-color: var(--color-gray-100)`), so overriding these recolors every call
 * site without touching a single component. `--color-white` is in the list for the same
 * reason: the light theme's primary surface is `bg-white` (77 call sites), not a gray.
 *
 * `rgb()` / `rgba()` values are as legal here as hex, and that is what lets a skin show its
 * wallpaper: the app's base tone sits on `<html>` and the wallpaper layer between it and the
 * content (see `styles.css`), so a surface only reveals the picture where the skin makes it
 * translucent — `--color-white: rgba(255, 251, 252, 0.72)`. An opaque skin simply hides the
 * wallpaper behind itself, which is the correct outcome rather than a bug.
 */
export const STRUCTURAL_TOKENS = [
  "--color-white",
  "--color-black",
  "--color-gray-50",
  "--color-gray-100",
  "--color-gray-200",
  "--color-gray-300",
  "--color-gray-400",
  "--color-gray-500",
  "--color-gray-600",
  "--color-gray-700",
  "--color-gray-800",
  "--color-gray-900",
  "--color-gray-950",
] as const;

/**
 * Tier 2 — accent. `--accent-bg` / `--accent-fg` are the app's own semantic pair
 * (`bg-[var(--accent-bg)] text-[var(--accent-fg)]` on primary buttons, the switch track,
 * the focus outline and the several indicator bars), and the brand ramp is the blue scale
 * the login chrome and a handful of links use.
 *
 * A skin that declares either accent token is said to **own** the accent: the appearance
 * page disables its accent picker and stops writing `data-accent`, because the two would
 * otherwise collide at equal specificity (see `ACCENT_OWNING_TOKENS`).
 */
export const ACCENT_TOKENS = [
  "--accent-bg",
  "--accent-fg",
  "--color-brand-25",
  "--color-brand-50",
  "--color-brand-100",
  "--color-brand-200",
  "--color-brand-300",
  "--color-brand-400",
  "--color-brand-500",
  "--color-brand-600",
  "--color-brand-700",
  "--color-brand-800",
  "--color-brand-900",
  "--color-brand-950",
] as const;

/**
 * Tier 3 — typography. One variable, named in `styles.css` precisely so that KaTeX and the
 * prose around it cannot drift apart; a skin that changes it moves both, which is the
 * intent rather than a side effect.
 */
export const TYPOGRAPHY_TOKENS = ["--font-app-sans"] as const;

/**
 * The tokens that make a skin own the accent. Deliberately only the semantic pair: setting
 * `--color-brand-600` alone is a palette change, not a claim on the user's accent choice.
 */
export const ACCENT_OWNING_TOKENS = ["--accent-bg", "--accent-fg"] as const;

/**
 * Every token a skin may declare. Anything outside this set is **rejected**, not dropped.
 *
 * The deliberate omissions are the status hues the app uses for meaning rather than
 * decoration — `red` (165 call sites), `amber` (42), and the `emerald` / `sky` / `teal` /
 * `indigo` / `cyan` / `yellow` / `violet` / `rose` / `blue` / `slate` families behind
 * badges and pills. They are semantic, and they are almost always consumed in pairs (a
 * tinted surface with a readable foreground), so a skin overriding one step in isolation
 * produces unreadable combinations rather than a different look. They belong to the
 * semantic-token layer this host has not built yet; until then a skin that wants a
 * different danger color is out of scope by design.
 */
export const ALLOWED_TOKENS: ReadonlySet<string> = new Set<string>([
  ...STRUCTURAL_TOKENS,
  ...ACCENT_TOKENS,
  ...TYPOGRAPHY_TOKENS,
]);

/** The allowlist as a sorted array, for error messages and authoring docs. */
export const ALLOWED_TOKEN_NAMES: readonly string[] = [...ALLOWED_TOKENS].sort();

/** True when either reading of the theme's ramp claims the accent pair. */
export function ownsAccent(tokens: Readonly<Partial<Record<ThemeMode, ThemeTokens>>>): boolean {
  return THEME_MODES.some((mode) => {
    const ramp = tokens[mode];
    return ramp !== undefined && ACCENT_OWNING_TOKENS.some((name) => ramp[name] !== undefined);
  });
}

/**
 * Color values a skin may use. Restricted to the literal forms Codex-Dream-Skin already
 * accepts, which doubles as an injection guard: a value carrying `}`, `;` or `url(`
 * cannot appear inside any of these shapes, so a token value can never break out of the
 * rule it is written into.
 */
export const COLOR_VALUE_PATTERN =
  /^(#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?|#[0-9a-fA-F]{3,4}|rgb\(\s*[0-9]{1,3}\s*,\s*[0-9]{1,3}\s*,\s*[0-9]{1,3}\s*\)|rgba\(\s*[0-9]{1,3}\s*,\s*[0-9]{1,3}\s*,\s*[0-9]{1,3}\s*,\s*(0|1|1\.0|0?\.[0-9]{1,6})\s*\))$/;

/**
 * A font stack: family names, generics and quoted names, separated by commas. Same
 * injection reasoning as the color pattern — no braces, semicolons, parentheses or
 * backslashes survive it, so `url(` and `expression(` are unreachable.
 */
export const FONT_STACK_PATTERN = /^[A-Za-z0-9 \-_,"'.]+$/;

// ---------------------------------------------------------------------------
// Background
// ---------------------------------------------------------------------------

/**
 * Image extensions a skin asset may use, with the MIME each one implies.
 *
 * The extension is validated rather than the whole filename: Codex-Dream-Skin themes name
 * their artwork freely (`portal-hero.png`, `background.jpg`), and forcing every import
 * through a rename would mean the importer had to copy bytes it has no reason to touch. A
 * declared asset is instead required to be a **single path segment** with one of these
 * extensions — which is also what makes the asset route safe to expose, since a name with
 * no separator in it cannot climb anywhere.
 */
export const IMAGE_EXTENSIONS = new Map<string, string>([
  [".webp", "image/webp"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  // Upstream fixes the artwork name to `background.webp|jpg|png`. SVG is this host's addition:
  // the built-in gallery is authored as vector art, which scales to any window and costs a few
  // KiB in a bundle the desktop app carries. A theme using it stays valid everywhere else,
  // because the extension only decides the MIME the asset route serves.
  [".svg", "image/svg+xml"],
]);

/** Longest an asset filename may be. */
export const ASSET_FILENAME_LIMIT = 128;

/** Bounds for the `background` block's framing parameters. */
export const BACKGROUND_FOCUS_MIN = 0;
export const BACKGROUND_FOCUS_MAX = 1;
export const BACKGROUND_ZOOM_MIN = 1;
export const BACKGROUND_ZOOM_MAX = 3;
export const BACKGROUND_DIM_MIN = 0;
export const BACKGROUND_DIM_MAX = 1;

/** Where the wallpaper is allowed to put its subject, so the UI is not painted over it. */
export const BACKGROUND_SAFE_AREAS = ["left", "right", "center"] as const;

// ---------------------------------------------------------------------------
// Codex-Dream-Skin import
// ---------------------------------------------------------------------------

/**
 * Prefix applied to the ids of imported Codex-Dream-Skin themes.
 *
 * Their ids (`preset-gothic-void-crusade`) are perfectly legal slugs here, which is exactly
 * the problem: importing one would silently shadow a native skin of the same name. The
 * prefix keeps the two namespaces apart while staying stable, so re-importing the same
 * theme still resolves to the same directory.
 */
export const DREAMSKIN_ID_PREFIX = "dreamskin-";

/** The `schemaVersion` a Codex-Dream-Skin `theme.json` must declare for us to read it. */
export const DREAMSKIN_SCHEMA_VERSION = 1;

/** Copy keys a Dream-Skin theme carries for the Codex shell's own chrome. */
export const DREAMSKIN_COPY_KEYS = [
  "brandSubtitle",
  "tagline",
  "projectPrefix",
  "projectLabel",
  "statusText",
  "quote",
  "promoTitle",
  "promoSub",
  "promoUrl",
] as const;

/** The ten palette keys a Dream-Skin theme may declare. */
export const DREAMSKIN_COLOR_KEYS = [
  "background",
  "panel",
  "panelAlt",
  "accent",
  "accentAlt",
  "secondary",
  "highlight",
  "text",
  "muted",
  "line",
] as const;

/**
 * The palette keys that name a *surface* rather than a foreground. An imported theme declares
 * these as its surface tokens, which is what lets the host's transparency preference reach
 * them (see {@link DEFAULT_SKIN_SURFACE_ALPHA}).
 *
 * `text`, `muted` and `line` are deliberately absent: they are read as foreground and border
 * colours, and a half-transparent text colour would be a legibility bug rather than a theme.
 * The accent keys are absent for the same reason plus one more — they are consumed as a
 * background/foreground pair, and `renderSkinCss` derives the foreground from the background.
 */
export const DREAMSKIN_SURFACE_KEYS = ["background", "panel", "panelAlt"] as const;

// ---------------------------------------------------------------------------
// Host-side transparency preferences
// ---------------------------------------------------------------------------

/**
 * Default alpha for the surfaces a skin declares as such.
 *
 * A preference rather than a constant baked into a skin, so the appearance page can offer it as
 * a control. The skin decides *which* tokens are surfaces; the user decides how transparent
 * they are.
 *
 * Two things set the default:
 *
 * - **It sits inside Dream-Skin's own envelope.** Their renderer drives the same idea with
 *   `--ds-theme-surface-opacity`, and their safe-CSS validator confines it to `0.65 … 1`.
 *   Their *default* is `1`, so a theme's panels are opaque out of the box and its wallpaper
 *   shows only in the chrome and the gaps. Importing at `1` would be the faithful reading — and
 *   it is also the one that makes the wallpaper invisible, which is the whole reason this
 *   exists. `0.72` is inside their range, so nothing here goes further than their own design
 *   allows, and it leaves more of the surface opaque than their floor does.
 * - **It was measured, not guessed.** On a page whose chain of surfaces is made translucent at
 *   this alpha, the wallpaper is visible at 196 of 208 sampled points; at full opacity it is
 *   118.
 */
export const DEFAULT_SKIN_SURFACE_ALPHA = 0.72;

/**
 * Default scrim over a skin's wallpaper.
 *
 * Deliberately modest: it is a scrim, not a filter. It takes the edge off a busy image so the
 * gaps between panels do not compete with the foreground, without turning the artwork the user
 * chose into a dark rectangle. It sits on the wallpaper layer, *behind* every panel, so it
 * cannot change a surface colour — only how loud the visible parts of the image are.
 */
export const DEFAULT_SKIN_BACKGROUND_DIM = 0.2;

/**
 * Bounds for both preferences. `0` is a legal surface alpha (fully see-through, and the user's
 * business); the upper bound is what keeps a mistyped value from producing a colour the
 * validator would reject on the way back in.
 */
export const SKIN_OPACITY_MIN = 0;
export const SKIN_OPACITY_MAX = 1;

/** Longest a `surfaces` declaration may be. Bounded by the token cap: a surface is a token. */
export const MAX_SURFACES = MAX_TOKENS;
