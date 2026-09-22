/**
 * Skin tokens -> CSS text.
 *
 * Deliberately free of Node built-ins: the web app generates the `<style>` element for the
 * active skin in the browser, so this module is published as its own entry point
 * (`@prismshadow/linsight-skins/css`) rather than through the barrel, which pulls in
 * `io.ts`'s fs / crypto / path.
 *
 * ## Why a theme is one attribute selector per reading
 *
 * The host writes the **selected theme's id** onto `<html data-skin="...">`, and the theme's
 * ramp for the reading in effect is picked by the `.dark` class the app already carries — no
 * second attribute, and no re-render when the mode changes.
 *
 * Specificity: `:root[data-skin="x"]` is (0,2,0) and `:root[data-skin="x"].dark` is (0,3,0), so
 * the dark block wins wherever both are emitted. The light block ties with
 * `:root[data-accent="..."]` at (0,2,0), resolved by source order — this stylesheet is injected
 * after the app's — but the host does not rely on that: when a theme owns the accent it stops
 * writing `data-accent` altogether, so there is nothing to tie with.
 */
import { ALLOWED_TOKENS, ownsAccent, SKIN_SLUG_REGEX } from "./constants.js";
import { THEME_MODES } from "./roles.js";
import type { ThemeMode } from "./roles.js";
import type { ThemeTokens } from "./palette.js";

export { ALLOWED_TOKENS, ACCENT_OWNING_TOKENS, ownsAccent } from "./constants.js";
// The role -> ramp derivation lives beside the renderer because a caller that renders a palette
// has to derive it first: a theme declares roles, never a ramp. Re-exported here so the web
// bundle reaches it through this Node-free entry rather than the barrel.
export { deriveRamps, SURFACE_ROLE_KEYS } from "./palette.js";
export type { DerivedRamp, ThemeTokens } from "./palette.js";
// Runtime constants the web app needs at render time. Re-exported here rather than reached
// through the barrel, which is the Node entry: importing a *value* from `@prismshadow/linsight-skins`
// in the web bundle drags in fs / crypto / path and the whole module graph fails to resolve.
export {
  DEFAULT_SKIN_BACKGROUND_DIM,
  DEFAULT_SKIN_SURFACE_ALPHA,
  SKIN_OPACITY_MAX,
  SKIN_OPACITY_MIN,
} from "./constants.js";

/**
 * The minimum a theme needs to expose for rendering. Structural rather than `SkinPackage` so
 * the bundled presets (which carry no absolute paths) and server-installed packages render
 * through the same function.
 */
export interface SkinRenderInput {
  id: string;
  /** The derived ramp per reading. See `palette.ts`. */
  tokens: Readonly<Partial<Record<ThemeMode, ThemeTokens>>>;
  /** Tokens that name a surface, per reading; the alpha preference is applied to these. */
  surfaces?: Readonly<Partial<Record<ThemeMode, readonly string[]>>> | undefined;
}

/**
 * A wallpaper, resolved and ready to render: the URL the browser will fetch, plus its framing.
 *
 * A separate input from {@link SkinRenderInput} because the artwork is a *component* of a theme
 * rather than the theme itself — a theme declares one and owns it. It is also mode-agnostic
 * where a ramp is not, so it is rendered under `:root` rather than under the theme's
 * `data-skin` attribute.
 */
export interface WallpaperInput {
  url: string;
  focusX: number;
  focusY: number;
  zoom: number;
  dim: number;
}

export interface RenderSkinCssOptions {
  /**
   * Alpha applied to every token the skin declares as a surface (see `SkinPackage.surfaces`).
   *
   * This is what keeps surface transparency a *preference*: the manifest stores the colours the
   * author wrote, and the user's chosen alpha is applied here, at render time. Omit it (or pass
   * null) to leave the stored values exactly as the skin wrote them.
   *
   * Replaces whatever alpha the stored value had, rather than only filling in an absent one: the
   * skin's say is *which* tokens are surfaces, the user's say is *how* transparent they are, and
   * a control whose effect depends on how the author happened to spell a colour would be a
   * control the user cannot predict.
   */
  surfaceAlpha?: number | null | undefined;
}

export interface RenderWallpaperCssOptions {
  /**
   * Overrides the wallpaper's own `dim`. The wallpaper says how loud it wants to be by default;
   * the user says how loud it actually is.
   */
  dim?: number | null | undefined;
}

/**
 * The host-owned custom properties the wallpaper layer reads. Not part of the palette
 * allowlist — these are set by {@link renderWallpaperCss}, never by a skin.
 *
 * `safeArea` is deliberately absent: it is advisory metadata carried over from Codex-Dream-Skin
 * (where the shell reads it to decide which side of the window its own copy can occupy), and it
 * describes the artwork rather than the framing. This host positions from `focusX` / `focusY`
 * alone, so the field stays in the manifest for round-trip fidelity and drives nothing here.
 */
export const WALLPAPER_VARIABLES = {
  image: "--wallpaper-image",
  focusX: "--wallpaper-focus-x",
  focusY: "--wallpaper-focus-y",
  zoom: "--wallpaper-zoom",
  dim: "--wallpaper-dim",
} as const;

/**
 * The attribute selector a theme's ramp block is written under.
 *
 * The reading is part of the selector rather than a separate attribute: the app already carries
 * `.dark` on the root, so CSS picks the right ramp with no re-render when the mode changes, and
 * the dark block outranks the light one (0,3,0 against 0,2,0) wherever both are emitted.
 */
export function skinStyleSelector(id: string, mode: ThemeMode = "light"): string {
  if (!SKIN_SLUG_REGEX.test(id)) {
    throw new Error(`Not a valid skin id: "${id}"`);
  }
  const base = `:root[data-skin="${id}"]`;
  return mode === "light" ? base : `${base}.dark`;
}

/**
 * Render a theme's ramp: one block per reading, under its own `data-skin` selector.
 *
 * Both readings are emitted from one palette. They are two namings of the same absolute
 * colours, so each is correct alone, and emitting both is what lets the theme hold whichever
 * shell the host is in — a dark theme reads as a dark page with light text under both. What
 * `appearance` pins is the shell itself, not which ramp exists.
 *
 * `--accent-fg` is derived when a block declares `--accent-bg` without it. The pair is consumed
 * together (`bg-[var(--accent-bg)] text-[var(--accent-fg)]` on primary buttons, the switch
 * track, the focus outline), so a theme that set only the background would ship
 * white-on-white or black-on-black.
 *
 * The artwork is deliberately not here — see {@link renderWallpaperCss}.
 */
export function renderSkinCss(skin: SkinRenderInput, options: RenderSkinCssOptions = {}): string {
  const surfaceAlpha: number | null = clampAlpha(options.surfaceAlpha);
  return THEME_MODES.filter((mode) => skin.tokens[mode] !== undefined)
    .map((mode) => renderRampBlock(skin, mode, surfaceAlpha))
    .join("");
}

function renderRampBlock(
  skin: SkinRenderInput,
  mode: ThemeMode,
  surfaceAlpha: number | null,
): string {
  const tokens = skin.tokens[mode] ?? {};
  const surfaces = new Set(skin.surfaces?.[mode] ?? []);
  const declarations: string[] = [];
  for (const name of Object.keys(tokens).sort()) {
    const stored = tokens[name] as string;
    const value =
      surfaceAlpha !== null && surfaces.has(name) ? withAlpha(stored, surfaceAlpha) : stored;
    declarations.push(`  ${name}: ${value};`);
  }
  const accentBackground = tokens["--accent-bg"];
  if (accentBackground !== undefined && tokens["--accent-fg"] === undefined) {
    declarations.push(`  --accent-fg: ${deriveAccentForeground(accentBackground)};`);
  }
  if (declarations.length === 0) return "";
  return `${skinStyleSelector(skin.id, mode)} {\n${declarations.join("\n")}\n}\n`;
}

/**
 * Render the wallpaper layer's properties, under `:root`.
 *
 * Separate from {@link renderSkinCss} on purpose. A wallpaper is not scoped to a palette — it
 * has to work with the built-in appearance too, which is the *absence* of a palette and so has
 * no `data-skin` attribute to hang off. The two blocks are independent, and either may be
 * emitted without the other.
 */
export function renderWallpaperCss(
  wallpaper: WallpaperInput,
  options: RenderWallpaperCssOptions = {},
): string {
  const dim = clampAlpha(options.dim) ?? wallpaper.dim;
  const declarations = [
    `${WALLPAPER_VARIABLES.image}: url("${cssUrl(wallpaper.url)}");`,
    `${WALLPAPER_VARIABLES.focusX}: ${formatPercent(wallpaper.focusX)};`,
    `${WALLPAPER_VARIABLES.focusY}: ${formatPercent(wallpaper.focusY)};`,
    `${WALLPAPER_VARIABLES.zoom}: ${String(wallpaper.zoom)};`,
    `${WALLPAPER_VARIABLES.dim}: ${String(dim)};`,
  ];
  return `:root {\n${declarations.map((line) => `  ${line}`).join("\n")}\n}\n`;
}

/** A preference value, or null when it is absent or not a usable 0..1 number. */
function clampAlpha(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0 || value > 1) return null;
  return value;
}

/** Render several palettes into one stylesheet. Later entries win on a duplicate id. */
export function renderSkinStylesheet(
  skins: readonly SkinRenderInput[],
  options: RenderSkinCssOptions = {},
): string {
  return skins.map((skin) => renderSkinCss(skin, options)).join("");
}

/**
 * Pick a readable foreground for an accent background.
 *
 * Relative luminance per WCAG 2.1, thresholded at 0.5 — which is where the app's own
 * presets already sit: `#2563eb` (L≈0.16) takes white, the dark theme's `#f3f4f6` (L≈0.93)
 * takes near-black. Returns the app's existing `#111827` rather than pure black so the
 * derived value matches the hand-written ones.
 */
export function deriveAccentForeground(color: string): string {
  const rgb = parseColor(color);
  if (rgb === null) return "#ffffff";
  const [r, g, b] = rgb;
  const luminance =
    0.2126 * linearize(r / 255) + 0.7152 * linearize(g / 255) + 0.0722 * linearize(b / 255);
  return luminance > 0.5 ? "#111827" : "#ffffff";
}

/** Parse the literal color forms the token validator accepts. Null when unparsable. */
export function parseColor(color: string): [number, number, number] | null {
  const value = color.trim();
  if (value.startsWith("#")) {
    const hex = value.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const parts = hex
        .slice(0, 3)
        .split("")
        .map((c) => Number.parseInt(c + c, 16));
      return parts.length === 3 && parts.every((n) => Number.isFinite(n))
        ? [parts[0] as number, parts[1] as number, parts[2] as number]
        : null;
    }
    if (hex.length === 6 || hex.length === 8) {
      const parts = [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
      return parts.every((n) => Number.isFinite(n))
        ? [parts[0] as number, parts[1] as number, parts[2] as number]
        : null;
    }
    return null;
  }
  const match = /^rgba?\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})/.exec(value);
  if (match === null) return null;
  const channels = [match[1], match[2], match[3]].map((part) =>
    Number.parseInt(part as string, 10),
  );
  if (channels.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return null;
  return [channels[0] as number, channels[1] as number, channels[2] as number];
}

/**
 * Return `color` carrying `alpha`, as an `rgba()` literal.
 *
 * **Replaces** whatever alpha the value had. The alternative — filling in only an absent one —
 * would make a user-facing transparency control behave differently depending on how an author
 * happened to spell a colour, which is a control the user cannot predict. The division of
 * responsibility is: the skin says *which* tokens are surfaces, the user says *how* transparent
 * they are.
 *
 * An unparsable value is passed through rather than swallowed, so the one validator decides
 * whether it was legal.
 *
 * The output shape is one `COLOR_VALUE_PATTERN` accepts, which is what keeps a skin's rendered
 * colours inside the same rules its stored ones follow.
 */
export function withAlpha(color: string, alpha: number): string {
  const rgb = parseColor(color);
  if (rgb === null) return color;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

function linearize(channel: number): number {
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function formatPercent(fraction: number): string {
  return `${String(Math.round(fraction * 10000) / 100)}%`;
}

/**
 * Quote a URL for a CSS `url()`. The callers only ever pass a path they built themselves,
 * but a quote or a backslash in one would end the string early, so both are escaped.
 */
function cssUrl(url: string): string {
  return url.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
