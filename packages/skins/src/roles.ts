/**
 * The palette contract, adopted from Codex Dream Skin.
 *
 * Their `theme.json` declares a palette as **ten roles** rather than as raw CSS variables, and
 * that is the whole reason a theme can serve both light and dark: the roles are absolute (a
 * `panel` is a panel), while this host's CSS variables are not (`--color-gray-900` is body text
 * in the light reading and a panel in the dark one). Declaring roles and *deriving* the ramp per
 * reading is what lets one palette be correct in both.
 *
 * The role names and their meanings are theirs, kept verbatim so a theme written for that
 * project is readable here without translation:
 *
 *   background  the window's base tone, behind everything
 *   panel       a surface the UI sits on: sidebar, card, composer
 *   panelAlt    a surface one step off `panel`, for a nested or hovered state
 *   accent      the emphasis colour: primary buttons, focus rings, the active indicator
 *   accentAlt   a lighter accent, for gradients and hover
 *   secondary   a second emphasis hue, for decoration
 *   highlight   a third, usually deeper
 *   text        body text
 *   muted       secondary text and most borders
 *   line        dividers and hairlines
 */
export const THEME_COLOR_KEYS = [
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

export type ThemeColorKey = (typeof THEME_COLOR_KEYS)[number];

/** A declared palette. Every key is required when the block is present, as upstream. */
export type ThemeColors = Record<ThemeColorKey, string>;

/** The three roles that name a surface, so the transparency preference can reach them. */
export const THEME_SURFACE_KEYS = ["background", "panel", "panelAlt"] as const;

/**
 * Which shells a theme's artwork holds up under.
 *
 * `light` and `dark` **pin** the host's mode: a single-mode image (a dark cathedral, a white
 * minimal) is only correct against the shell it was drawn for. `auto` follows the user's own
 * light/dark setting, and is only for artwork that was checked under both.
 *
 * Upstream is emphatic that claiming `auto` for a single-mode image is a defect rather than a
 * preference: the native components that are *not* themed render against the shell, so a dark
 * painting under a light shell has the two fighting each other.
 */
export const THEME_APPEARANCES = ["light", "dark", "auto"] as const;
export type ThemeAppearance = (typeof THEME_APPEARANCES)[number];

/** The two readings a palette is derived for. */
export const THEME_MODES = ["light", "dark"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

/**
 * Which side of the artwork is low-information, so the host can put text there.
 *
 * Upstream also accepts `auto` (infer it from the image) and `center`; the validator accepts
 * only these three, and this host does not analyse images, so `auto` is normalised to `null` —
 * "not stated" — rather than guessed at.
 */
export const THEME_SAFE_AREAS = ["left", "right", "none"] as const;
export type ThemeSafeArea = (typeof THEME_SAFE_AREAS)[number];

/**
 * How much of the artwork shows on a task/thread page.
 *
 * `ambient` keeps it as a faint background, `full` lets it through behind content, `off` hides
 * it there entirely. Upstream infers this from the image when it is not stated; this host has
 * one rendering, so the value is carried and reported rather than acted on.
 */
export const THEME_TASK_MODES = ["ambient", "full", "off"] as const;
export type ThemeTaskMode = (typeof THEME_TASK_MODES)[number];

/**
 * Where the artwork's subject sits, and how the host should treat it.
 *
 * Carried from upstream's `art` block. `focusX` / `focusY` are the fields this host renders
 * with; `safeArea` and `taskMode` are advisory and kept for round-trip fidelity. `zoom` and
 * `dim` are this host's additions to the block — upstream sets those from its renderer rather
 * than from the theme, and a theme here owns them.
 */
export interface ThemeArt {
  focusX: number;
  focusY: number;
  zoom: number;
  dim: number;
  safeArea: ThemeSafeArea | null;
  taskMode: ThemeTaskMode | null;
}

/** True when `value` is one of the appearances a theme may declare. */
export function isThemeAppearance(value: unknown): value is ThemeAppearance {
  return value === "light" || value === "dark" || value === "auto";
}

/** True when `value` is a reading a ramp is derived for. */
export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark";
}

/** True when `value` is one of the safe areas a theme may declare. */
export function isThemeSafeArea(value: unknown): value is ThemeSafeArea {
  return value === "left" || value === "right" || value === "none";
}

/** True when `value` is one of the task-page intensities. */
export function isThemeTaskMode(value: unknown): value is ThemeTaskMode {
  return value === "ambient" || value === "full" || value === "off";
}
