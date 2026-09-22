/**
 * Deriving a CSS ramp from a palette of roles.
 *
 * ## Why this exists
 *
 * A theme declares ten absolute roles (see `roles.ts`). This host's components do not read
 * roles — they read Tailwind's ramp, and **that ramp means the opposite thing in the two
 * modes**: `--color-gray-50` is the page under a light shell and body text under a dark one.
 *
 * So the same ten colours are laid onto the ramp **twice**, once per reading. Both are emitted
 * (see `renderSkinCss`), which is what makes a theme look like itself in either mode: a dark
 * palette reads as a dark page with light text under both shells, because each reading is just
 * a different set of names for the same roles. `appearance` then decides which shell the host
 * pins, for the parts of the window this host does not paint.
 *
 * This is the same shape as upstream's renderer — absolute colours, a shell that follows or is
 * pinned — with their adaptive-palette derivation replaced by two static mappings, because this
 * host has no image analysis to sample an accent from.
 *
 * ## What is derived rather than declared
 *
 * Only the ten roles are declared. The eleven ramp steps are interpolated between them, so a
 * theme cannot ship a ramp that contradicts its own palette. `--color-white` is included
 * deliberately: it is the light shell's primary surface (`bg-white`, 77 call sites), so a dark
 * theme that left it alone would keep a white page under a light shell.
 */
import { parseColor } from "./css.js";
import { THEME_SURFACE_KEYS } from "./roles.js";
import type { ThemeColorKey, ThemeColors, ThemeMode } from "./roles.js";

/** A ramp: CSS custom property -> literal value. */
export type ThemeTokens = Record<string, string>;

/** The ramp and surface list for one reading. */
export interface DerivedRamp {
  tokens: ThemeTokens;
  surfaces: string[];
}

/** The Tailwind ramp steps, in the order a light shell reads them (low = surface). */
const RAMP_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;

/** The brand ramp steps this host's allowlist carries. */
const BRAND_STEPS = [25, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;

/** `#rrggbb` for an `[r, g, b]` triple. */
function toHex(rgb: readonly [number, number, number]): string {
  return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

/** Linear blend, `t` = 0 gives `a`, `t` = 1 gives `b`. Alpha is dropped: ramps are opaque. */
function mix(a: string, b: string, t: number): string {
  const left = parseColor(a);
  const right = parseColor(b);
  // An unparsable operand cannot reach here (the manifest validator rejects it), but a ramp
  // that silently vanished would be worse than one that falls back to the other operand.
  if (left === null) return right === null ? a : b;
  if (right === null) return a;
  const clamped = Math.min(1, Math.max(0, t));
  return toHex([
    left[0] + (right[0] - left[0]) * clamped,
    left[1] + (right[1] - left[1]) * clamped,
    left[2] + (right[2] - left[2]) * clamped,
  ]);
}

interface Hsl {
  h: number;
  s: number;
  l: number;
}

function rgbToHsl(rgb: readonly [number, number, number]): Hsl {
  const r = rgb[0] / 255;
  const g = rgb[1] / 255;
  const b = rgb[2] / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { h: 0, s: 0, l };
  const s = delta / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / delta) % 6;
  else if (max === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;
  h *= 60;
  return { h: h < 0 ? h + 360 : h, s, l };
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1
      ? [c, x, 0]
      : hp < 2
        ? [x, c, 0]
        : hp < 3
          ? [0, c, x]
          : hp < 4
            ? [0, x, c]
            : hp < 5
              ? [x, 0, c]
              : [c, 0, x];
  const m = l - c / 2;
  return toHex([(r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255]);
}

/**
 * The brand ramp, built from the accent's hue so a theme's links and login chrome follow its
 * palette rather than staying blue.
 *
 * Lightness runs high-to-low across the steps in both readings, matching how the app reads the
 * ramp: `brand-600` is the button in a light shell, `brand-400` the readable one in a dark shell.
 */
function brandRamp(accent: string, mode: ThemeMode): ThemeTokens {
  const rgb = parseColor(accent);
  const hsl = rgb === null ? { h: 220, s: 0.7, l: 0.5 } : rgbToHsl(rgb);
  // A near-grey accent would produce a near-grey brand ramp, which is a legible but odd result;
  // floor the saturation so the ramp always reads as a hue.
  const saturation = Math.min(0.92, Math.max(0.35, hsl.s));
  const lightness: Record<(typeof BRAND_STEPS)[number], number> =
    mode === "light"
      ? {
          25: 0.98,
          50: 0.96,
          100: 0.92,
          200: 0.85,
          300: 0.76,
          400: 0.65,
          500: 0.55,
          600: 0.47,
          700: 0.39,
          800: 0.32,
          900: 0.26,
          950: 0.18,
        }
      : {
          25: 0.19,
          50: 0.23,
          100: 0.29,
          200: 0.37,
          300: 0.46,
          400: 0.56,
          500: 0.64,
          600: 0.71,
          700: 0.79,
          800: 0.86,
          900: 0.92,
          950: 0.97,
        };
  const out: ThemeTokens = {};
  for (const step of BRAND_STEPS) {
    out[`--color-brand-${String(step)}`] = hslToHex(hsl.h, saturation, lightness[step]);
  }
  return out;
}

/**
 * Lay the ten roles onto the ramp for one reading.
 *
 * The interpolation points are the roles themselves: `muted` sits at the middle of the ramp
 * (500 in a light reading, 400 in a dark one) and `text` at the far end, so borders, hover
 * states and placeholder text land between two colours the author actually chose rather than
 * between a chosen colour and a Tailwind default.
 */
function rampFor(colors: ThemeColors, mode: ThemeMode): ThemeTokens {
  const { background, panel, panelAlt, text, muted, line } = colors;
  const steps: Record<(typeof RAMP_STEPS)[number], string> =
    mode === "light"
      ? {
          50: background,
          100: panelAlt,
          200: line,
          300: mix(line, muted, 0.55),
          400: mix(muted, text, 0.3),
          500: muted,
          600: mix(muted, text, 0.55),
          700: mix(muted, text, 0.78),
          800: mix(text, background, 0.1),
          900: text,
          950: mix(text, "#000000", 0.25),
        }
      : {
          50: text,
          100: mix(text, background, 0.12),
          200: mix(text, background, 0.28),
          300: mix(text, background, 0.48),
          400: muted,
          500: mix(muted, background, 0.35),
          600: mix(muted, background, 0.6),
          700: line,
          800: panelAlt,
          900: panel,
          950: background,
        };
  const tokens: ThemeTokens = {};
  for (const step of RAMP_STEPS) {
    tokens[`--color-gray-${String(step)}`] = steps[step];
  }
  // `--color-white` has two jobs in this app, and they part company between the readings.
  //
  // Under a light shell it is the primary *surface* — `bg-white`, 67 call sites, 63 of them
  // paired with a `dark:bg-*`. Under a dark shell it is *ink on a dark chip*: `text-white` on
  // `bg-gray-700`, on a `bg-black/50` image scrim, on a `bg-red-500` badge — none of which carry
  // a `dark:` variant, because white is already the readable choice there. Setting it to `panel`
  // in both readings is what turns those chips into dark-on-dark.
  //
  // The two `bg-white` sites with no `dark:` fallback (`workspace-browser.tsx`) are the price of
  // this, and they carry an explicit `dark:bg-gray-900` to say so.
  tokens["--color-white"] = mode === "light" ? panel : text;
  tokens["--accent-bg"] = colors.accent;
  Object.assign(tokens, brandRamp(colors.accent, mode));
  return tokens;
}

/** The tokens that name a surface for one reading, so the transparency preference reaches them. */
function surfacesFor(mode: ThemeMode): string[] {
  return mode === "light"
    ? ["--color-white", "--color-gray-50", "--color-gray-100"]
    : ["--color-gray-950", "--color-gray-900", "--color-gray-800"];
}

/**
 * Both readings of one palette.
 *
 * Always both, whatever the theme's `appearance`: the readings are two namings of the same
 * absolute colours, so each is correct on its own, and emitting both means the theme holds
 * wherever the shell happens to be. `appearance` is what pins the shell, not what decides which
 * ramp exists.
 */
export function deriveRamps(colors: ThemeColors): Record<ThemeMode, DerivedRamp> {
  return {
    light: { tokens: rampFor(colors, "light"), surfaces: surfacesFor("light") },
    dark: { tokens: rampFor(colors, "dark"), surfaces: surfacesFor("dark") },
  };
}

/** The role keys that are rendered as surfaces, for the docs and the manifest validator. */
export const SURFACE_ROLE_KEYS: readonly ThemeColorKey[] = THEME_SURFACE_KEYS;
