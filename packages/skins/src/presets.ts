/**
 * The built-in theme gallery.
 *
 * One table, because a theme is one thing: a palette of ten roles, an artwork, and how to frame
 * it. This file used to be two — palettes in one list, wallpapers in another — which is what made
 * a wallpaper cost a palette and left three unrelated-looking controls on the settings page.
 *
 * ## Where the themes come from
 *
 * `gothic-void-crusade` is real artwork, redistributed from Codex Dream Skin under its MIT license
 * (see `THIRD-PARTY-NOTICES.md`), with the palette its author declared. The other eight are
 * authored here: the artwork is SVG written in this repository, and the palettes are taken from
 * the artwork's own colours. They follow the visual directions that project documents for its
 * gallery — its `docs/background-generation-prompts.md` names a palette, a mood and a
 * composition for each — and render the *environment* rather than the figure those directions
 * call for, which keeps them clear of the likeness question that document is emphatic about.
 *
 * Every one follows the composition contract the directions state: the left ~52% stays calm and
 * low-contrast so native text can sit on it, and the interest concentrates to the right.
 *
 * ## Why the appearance values are what they are
 *
 * `appearance` says which shells the artwork holds up under, and it is a claim about the picture,
 * not a preference. A dark painting declared `auto` is a defect: the parts of the window this
 * host does not paint render against the shell, so a dark artwork under a light shell has the two
 * fighting. The light-leaning themes below are `auto` because they were checked both ways; the
 * dark ones are `dark` and pin the shell.
 */
import { deriveRamps } from "./palette.js";
import type { SkinPackage, ThemeAppearance, ThemeArt, ThemeColors } from "./schema.js";

/** A built-in theme, before it is expanded into a full package. */
export interface BuiltinTheme {
  id: string;
  name: string;
  description: string;
  appearance: ThemeAppearance;
  colors: ThemeColors;
  art: ThemeArt;
  /** Filename under the web bundle's `themes/<id>/`. */
  filename: string;
}

/** Where the composition contract puts the focal point. Every authored theme aims here. */
const FOCUS_X = 0.72;
const FOCUS_Y = 0.45;

/** The framing an authored SVG theme uses. */
function art(overrides: Partial<ThemeArt> = {}): ThemeArt {
  return {
    focusX: FOCUS_X,
    focusY: FOCUS_Y,
    zoom: 1,
    dim: 0.14,
    safeArea: "left",
    taskMode: "ambient",
    ...overrides,
  };
}

/** The palette the redistributed Gothic theme declares, verbatim from its `theme.json`. */
const GOTHIC_COLORS: ThemeColors = {
  background: "#0b0a0c",
  panel: "#141216",
  panelAlt: "#1e1a1f",
  accent: "#c8a55a",
  accentAlt: "#e3c27a",
  secondary: "#74352e",
  highlight: "#4a2f2a",
  text: "#f3ead7",
  muted: "#b5a386",
  line: "rgba(200, 165, 90, 0.28)",
};

/** The app's own light palette, as a theme, so "the default look" is a choice like any other. */
const SAKURA_COLORS: ThemeColors = {
  background: "#fdf5f8",
  panel: "#fffbfc",
  panelAlt: "#f9ecf1",
  accent: "#c8446a",
  accentAlt: "#dd7f9b",
  secondary: "#e8a4b8",
  highlight: "#a32f52",
  text: "#2e1d24",
  muted: "#9d7281",
  line: "#f1dae2",
};

/** The app's own dark palette, as a theme. */
const MIDNIGHT_COLORS: ThemeColors = {
  background: "#0a0d1a",
  panel: "#111528",
  panelAlt: "#1a1f36",
  accent: "#3b82f6",
  accentAlt: "#60a5fa",
  secondary: "#1e3a8a",
  highlight: "#7c3aed",
  text: "#e8eaf6",
  muted: "#94a3b8",
  line: "#26304d",
};

export const BUILTIN_THEMES: readonly BuiltinTheme[] = [
  {
    id: "gothic-void-crusade",
    name: "哥特虚空远征",
    description: "A solemn cathedral-world horizon: near-black stone, a low sun, brass light.",
    appearance: "dark",
    colors: GOTHIC_COLORS,
    art: art({ focusX: 0.76, dim: 0.2 }),
    filename: "background.jpg",
  },
  {
    id: "sakura",
    name: "樱",
    description: "A warm, soft light theme with a rose accent.",
    appearance: "light",
    colors: SAKURA_COLORS,
    art: art({ dim: 0.1 }),
    filename: "",
  },
  {
    id: "midnight",
    name: "深蓝夜",
    description: "A calm deep-blue dark theme with a cool accent.",
    appearance: "dark",
    colors: MIDNIGHT_COLORS,
    art: art({ dim: 0.16 }),
    filename: "",
  },
  {
    id: "rose-garden",
    name: "玫瑰园",
    description: "Cream studio light, ivory and sakura pink, drifts of rose petals.",
    appearance: "auto",
    colors: {
      background: "#fdf1ef",
      panel: "#fefaf7",
      panelAlt: "#f8e2e6",
      accent: "#c25f78",
      accentAlt: "#e2a0b0",
      secondary: "#e9b9a8",
      highlight: "#8e4457",
      text: "#3b2730",
      muted: "#a98490",
      line: "#f2d3dc",
    },
    art: art({ dim: 0.12 }),
    filename: "background.svg",
  },
  {
    id: "cinnabar-desk",
    name: "朱砂案头",
    description: "Ivory rice paper, auspicious cloud ribbons, antique gold and cinnabar.",
    appearance: "auto",
    colors: {
      background: "#f7eeda",
      panel: "#fbf5e8",
      panelAlt: "#f0e0c2",
      accent: "#c73f2c",
      accentAlt: "#e0553f",
      secondary: "#c9a24a",
      highlight: "#8a4a20",
      text: "#3a2b18",
      muted: "#9c8358",
      line: "#e0cfa8",
    },
    art: art({ dim: 0.12 }),
    filename: "background.svg",
  },
  {
    id: "coral-sphere",
    name: "珊瑚巨构",
    description: "Pearl-white future city under a colossal translucent coral energy sphere.",
    appearance: "auto",
    colors: {
      background: "#fdf6f6",
      panel: "#ffffff",
      panelAlt: "#fbe8e8",
      accent: "#e2543c",
      accentAlt: "#ff8a76",
      secondary: "#e9a99c",
      highlight: "#b03a26",
      text: "#33211f",
      muted: "#a3827e",
      line: "#f2d4d2",
    },
    art: art({ dim: 0.14 }),
    filename: "background.svg",
  },
  {
    id: "sage-studio",
    name: "鼠尾草工作室",
    description: "Warm ivory and pale sage, eucalyptus shadow, a paper crane at the edge.",
    appearance: "auto",
    colors: {
      background: "#f6f2e6",
      panel: "#fbf8f0",
      panelAlt: "#e9ecdd",
      accent: "#6f8459",
      accentAlt: "#9aa986",
      secondary: "#c9b98a",
      highlight: "#4d6140",
      text: "#2f3527",
      muted: "#8b9078",
      line: "#dde3d2",
    },
    art: art({ dim: 0.12 }),
    filename: "background.svg",
  },
  {
    id: "sketchbook",
    name: "涂鸦手账",
    description: "Cream notebook paper, turquoise marker strokes, confetti and tape.",
    appearance: "auto",
    colors: {
      background: "#fbf5e6",
      panel: "#fdfaf0",
      panelAlt: "#f7eed7",
      accent: "#2f8f95",
      accentAlt: "#3fa8ad",
      secondary: "#f2b134",
      highlight: "#ef7f66",
      text: "#2c2a22",
      muted: "#96896a",
      line: "#e3d8ba",
    },
    art: art({ dim: 0.14 }),
    filename: "background.svg",
  },
  {
    id: "star-veil",
    name: "星夜帷幕",
    description: "Deep cobalt and violet aurora, layered star fields, iridescent glitter.",
    appearance: "dark",
    colors: {
      background: "#141a4a",
      panel: "#1b2566",
      panelAlt: "#241f5c",
      accent: "#8f6bff",
      accentAlt: "#b98cff",
      secondary: "#25d6e6",
      highlight: "#ff5fc4",
      text: "#eafaff",
      muted: "#9aa6d8",
      line: "#33307a",
    },
    art: art({ dim: 0.26 }),
    filename: "background.svg",
  },
  {
    id: "seafoam-stage",
    name: "海沫舞台",
    description: "Pastel holographic stage: seafoam, sky blue, lavender, coral and pearl.",
    appearance: "auto",
    colors: {
      background: "#e4f6fb",
      panel: "#f4fdff",
      panelAlt: "#d8ecfa",
      accent: "#4fb8c4",
      accentAlt: "#8fe6e0",
      secondary: "#b9a6ff",
      highlight: "#ffb0cf",
      text: "#243b45",
      muted: "#7d9aa8",
      line: "#d2e8f2",
    },
    art: art({ dim: 0.2 }),
    filename: "background.svg",
  },
  {
    id: "black-gold-stage",
    name: "黑金舞台",
    description: "Near-black lacquer, warm gold rim light, faint jasmine and gold dust.",
    appearance: "dark",
    colors: {
      background: "#07070a",
      panel: "#121014",
      panelAlt: "#1c1618",
      accent: "#c8a55a",
      accentAlt: "#e8c98a",
      secondary: "#8a6a33",
      highlight: "#5a3a20",
      text: "#f2eee2",
      muted: "#a08f72",
      line: "rgba(200, 165, 90, 0.3)",
    },
    art: art({ focusX: 0.7, dim: 0.28 }),
    filename: "background.svg",
  },
];

/** Look up a built-in theme by id (null when the id is not one). */
export function findBuiltinTheme(id: string | null | undefined): BuiltinTheme | null {
  if (!id) return null;
  return BUILTIN_THEMES.find((theme) => theme.id === id) ?? null;
}

/**
 * Expand a built-in theme into the same shape an installed one has, so the picker, the renderer
 * and the accent row do not each need a second code path. `packagePath` is empty because a
 * built-in theme has no directory — its artwork is a web-bundle asset.
 */
export function builtinThemePackage(theme: BuiltinTheme): SkinPackage {
  const ramps = deriveRamps(theme.colors);
  return {
    id: theme.id,
    name: theme.name,
    author: null,
    description: theme.description,
    version: "1.0.0",
    appearance: theme.appearance,
    source: "preset",
    packagePath: "",
    colors: theme.colors,
    art: theme.art,
    tokens: { light: ramps.light.tokens, dark: ramps.dark.tokens },
    surfaces: { light: ramps.light.surfaces, dark: ramps.dark.surfaces },
    extras: { font: null },
    background:
      theme.filename === ""
        ? null
        : {
            filename: theme.filename,
            assetPath: "",
            mimeType: theme.filename.endsWith(".svg") ? "image/svg+xml" : "image/jpeg",
            focusX: theme.art.focusX,
            focusY: theme.art.focusY,
            zoom: theme.art.zoom,
            dim: theme.art.dim,
          },
    previewPath: null,
    previewMimeType: null,
    origin: null,
  };
}

/** Every built-in theme as a package, in gallery order. */
export function builtinThemePackages(): SkinPackage[] {
  return BUILTIN_THEMES.map(builtinThemePackage);
}
