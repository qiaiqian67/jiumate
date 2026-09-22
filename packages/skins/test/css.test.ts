/**
 * The role -> ramp derivation and the two-block renderer.
 *
 * The property these tests exist for: **one palette, two readings**. A theme declares ten
 * absolute roles; the renderer lays them onto Tailwind's ramp twice, because that ramp means the
 * opposite thing in the two modes — `--color-gray-900` is body text under a light shell and a
 * panel under a dark one. So the assertions below are mostly about the *shape* of the mapping
 * rather than about specific colours, which the derivation is free to tune.
 */
import { describe, expect, it } from "vitest";
import {
  COLOR_VALUE_PATTERN,
  deriveAccentForeground,
  deriveRamps,
  ownsAccent,
  parseColor,
  renderSkinCss,
  renderSkinStylesheet,
  renderWallpaperCss,
  skinStyleSelector,
  withAlpha,
} from "../src/index.js";
import type { ThemeColors } from "../src/index.js";

const COLORS: ThemeColors = {
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

describe("deriveRamps", () => {
  it("produces both readings from one palette", () => {
    const ramps = deriveRamps(COLORS);
    expect(Object.keys(ramps).sort()).toEqual(["dark", "light"]);
    expect(ramps.light.tokens["--color-gray-900"]).toBeDefined();
    expect(ramps.dark.tokens["--color-gray-900"]).toBeDefined();
  });

  it("fills the whole gray ramp, so nothing falls back to a Tailwind default", () => {
    // A half-filled ramp is the failure that looks like a theme until a hover state or a border
    // turns up in the wrong grey.
    const ramps = deriveRamps(COLORS);
    for (const mode of ["light", "dark"] as const) {
      for (const step of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]) {
        expect(
          ramps[mode].tokens[`--color-gray-${String(step)}`],
          `${mode} gray-${String(step)}`,
        ).toBeDefined();
      }
      expect(ramps[mode].tokens["--color-white"]).toBeDefined();
    }
  });

  it("puts the palette's own colours where each reading expects them", () => {
    const ramps = deriveRamps(COLORS);
    // Light reading: low numbers are surfaces, so the page is `gray-50` and `white` is a panel.
    expect(ramps.light.tokens["--color-gray-50"]).toBe(COLORS.background);
    expect(ramps.light.tokens["--color-gray-100"]).toBe(COLORS.panelAlt);
    expect(ramps.light.tokens["--color-gray-900"]).toBe(COLORS.text);
    // Dark reading: the same roles, named the other way round.
    expect(ramps.dark.tokens["--color-gray-950"]).toBe(COLORS.background);
    expect(ramps.dark.tokens["--color-gray-900"]).toBe(COLORS.panel);
    expect(ramps.dark.tokens["--color-gray-800"]).toBe(COLORS.panelAlt);
    expect(ramps.dark.tokens["--color-gray-50"]).toBe(COLORS.text);
  });

  it("is why a theme looks like itself in either mode", () => {
    // The page under a light shell and the page under a dark shell are the same colour, because
    // the roles are absolute and only their names change. This is the whole point of the shape.
    const ramps = deriveRamps(COLORS);
    expect(ramps.light.tokens["--color-gray-50"]).toBe(ramps.dark.tokens["--color-gray-950"]);
    expect(ramps.light.tokens["--color-gray-900"]).toBe(ramps.dark.tokens["--color-gray-50"]);
  });

  it("declares the surfaces each reading can make translucent", () => {
    const ramps = deriveRamps(COLORS);
    expect(ramps.light.surfaces).toEqual(["--color-white", "--color-gray-50", "--color-gray-100"]);
    expect(ramps.dark.surfaces).toEqual([
      "--color-gray-950",
      "--color-gray-900",
      "--color-gray-800",
    ]);
  });

  it("reads `--color-white` as a surface in one shell and as ink in the other", () => {
    // The one token whose *job* differs between the readings, which is why it is not simply
    // `panel` in both. Under a light shell it is the primary surface (`bg-white`, and 63 of its
    // 67 call sites carry a `dark:` fallback). Under a dark shell that fallback does that job,
    // and what is left is ink on a dark chip — `bg-gray-700 text-white`, a caption on a
    // `bg-black/50` scrim, a badge on `bg-red-500`. Pointing it at the panel there paints dark
    // text onto a dark chip, which is the exact thing `text-white` is written to avoid.
    const ramps = deriveRamps(COLORS);
    expect(ramps.light.tokens["--color-white"]).toBe(COLORS.panel);
    expect(ramps.dark.tokens["--color-white"]).toBe(COLORS.text);
    // And it is a surface only in the reading where it *is* one, so the transparency preference
    // cannot soften the ink into illegibility.
    expect(ramps.light.surfaces).toContain("--color-white");
    expect(ramps.dark.surfaces).not.toContain("--color-white");
  });

  it("declares surfaces that are also tokens, in both readings", () => {
    // A surface the renderer cannot apply an alpha to is a silent no-op: the slider moves and
    // nothing happens.
    const ramps = deriveRamps(COLORS);
    for (const mode of ["light", "dark"] as const) {
      for (const surface of ramps[mode].surfaces) {
        expect(ramps[mode].tokens[surface], `${mode} ${surface}`).toBeDefined();
      }
    }
  });

  it("emits only colour literals the token validator accepts", () => {
    // The derivation interpolates, so this is the check that it never produces something the
    // import path would reject on a round-trip.
    const ramps = deriveRamps(COLORS);
    for (const mode of ["light", "dark"] as const) {
      for (const [name, value] of Object.entries(ramps[mode].tokens)) {
        expect(COLOR_VALUE_PATTERN.test(value), `${name} = ${value}`).toBe(true);
      }
    }
  });

  it("builds a brand ramp from the accent's hue rather than leaving it blue", () => {
    const ramps = deriveRamps(COLORS);
    const brand = ramps.light.tokens["--color-brand-600"];
    expect(brand).toBeDefined();
    const accent = parseColor(COLORS.accent);
    const derived = parseColor(brand as string);
    expect(accent).not.toBeNull();
    expect(derived).not.toBeNull();
    // Same hue family: the gold accent must not come out as a blue ramp.
    const warm = (rgb: readonly [number, number, number]): boolean => rgb[0] > rgb[2];
    expect(warm(derived as [number, number, number])).toBe(
      warm(accent as [number, number, number]),
    );
  });
});

/** The renderer takes the ramps, not the derivation's wrapper: `{ light, dark }` of token maps. */
function rampsOf(colors: ThemeColors) {
  const derived = deriveRamps(colors);
  return { light: derived.light.tokens, dark: derived.dark.tokens };
}

describe("skinStyleSelector", () => {
  it("scopes the light reading to the attribute and the dark one to `.dark`", () => {
    expect(skinStyleSelector("gothic")).toBe(':root[data-skin="gothic"]');
    expect(skinStyleSelector("gothic", "dark")).toBe(':root[data-skin="gothic"].dark');
  });

  it("refuses an id that could break out of the selector", () => {
    expect(() => skinStyleSelector('x"] { }')).toThrow(/Not a valid skin id/);
  });
});

describe("renderSkinCss", () => {
  const derived = deriveRamps(COLORS);
  const skin = {
    id: "gothic",
    tokens: { light: derived.light.tokens, dark: derived.dark.tokens },
    surfaces: { light: derived.light.surfaces, dark: derived.dark.surfaces },
  };

  it("emits one block per reading", () => {
    const css = renderSkinCss(skin);
    expect(css).toContain(':root[data-skin="gothic"] {');
    expect(css).toContain(':root[data-skin="gothic"].dark {');
  });

  it("derives the accent foreground rather than shipping white-on-white", () => {
    // The pair is consumed together on primary buttons and the focus ring, so a palette that set
    // only the background would otherwise be unreadable.
    const css = renderSkinCss(skin);
    expect(css).toContain("--accent-fg:");
  });

  it("applies the transparency preference to the declared surfaces only", () => {
    const css = renderSkinCss(skin, { surfaceAlpha: 0.5 });
    // The dark reading's page is a surface; its text is not.
    expect(css).toContain("--color-gray-950: rgba(11, 10, 12, 0.5);");
    expect(css).toContain("--color-gray-50: #f3ead7;");
  });

  it("leaves the stored colours alone when no preference is given", () => {
    expect(renderSkinCss(skin)).toContain("--color-gray-950: #0b0a0c;");
  });

  it("ignores an out-of-range preference rather than clamping it", () => {
    // A silently different value is worse than the theme's own.
    expect(renderSkinCss(skin, { surfaceAlpha: 2 })).toContain("--color-gray-950: #0b0a0c;");
  });
});

describe("renderSkinStylesheet", () => {
  it("concatenates one set of blocks per theme", () => {
    const css = renderSkinStylesheet([
      { id: "a", tokens: rampsOf(COLORS) },
      { id: "b", tokens: rampsOf({ ...COLORS, accent: "#2563eb" }) },
    ]);
    expect(css).toContain(':root[data-skin="a"]');
    expect(css).toContain(':root[data-skin="b"].dark');
  });
});

describe("renderWallpaperCss", () => {
  const wallpaper = {
    url: "/themes/gothic/background.jpg",
    focusX: 0.76,
    focusY: 0.45,
    zoom: 1,
    dim: 0.35,
  };

  it("emits every property the wallpaper layer reads, under :root", () => {
    const css = renderWallpaperCss(wallpaper);
    // `:root` and not a `data-skin` selector: the artwork has to work with the built-in
    // appearance too, which is the absence of a theme and has no attribute to hang off.
    expect(css.startsWith(":root {")).toBe(true);
    expect(css).toContain('--wallpaper-image: url("/themes/gothic/background.jpg");');
    expect(css).toContain("--wallpaper-focus-x: 76%;");
    expect(css).toContain("--wallpaper-focus-y: 45%;");
    expect(css).toContain("--wallpaper-dim: 0.35;");
  });

  it("lets the user's dim override the theme's own", () => {
    expect(renderWallpaperCss(wallpaper, { dim: 0 })).toContain("--wallpaper-dim: 0;");
    expect(renderWallpaperCss(wallpaper, { dim: null })).toContain("--wallpaper-dim: 0.35;");
  });

  it("escapes a quote in the URL so the declaration cannot be broken out of", () => {
    expect(renderWallpaperCss({ ...wallpaper, url: '/a"b.png' })).toContain('url("/a\\"b.png")');
  });
});

describe("ownsAccent", () => {
  it("is true when either reading claims the accent pair", () => {
    expect(ownsAccent(rampsOf(COLORS))).toBe(true);
  });

  it("is false for a ramp with no accent at all", () => {
    expect(ownsAccent({ light: { "--color-gray-50": "#fff" } })).toBe(false);
    expect(ownsAccent({})).toBe(false);
  });
});

describe("deriveAccentForeground", () => {
  it("reproduces the app's own hand-written accent pairs", () => {
    for (const background of ["#2563eb", "#15803d", "#7c3aed", "#be123c", "#b45309"]) {
      expect(deriveAccentForeground(background)).toBe("#ffffff");
    }
    expect(deriveAccentForeground("#f3f4f6")).toBe("#111827");
  });
});

describe("withAlpha", () => {
  it("replaces the stored alpha rather than only filling in an absent one", () => {
    // Otherwise the control's effect would depend on how the author happened to spell a colour.
    expect(withAlpha("#ffffff", 0.5)).toBe("rgba(255, 255, 255, 0.5)");
    expect(withAlpha("rgba(255, 255, 255, 0.9)", 0.5)).toBe("rgba(255, 255, 255, 0.5)");
  });

  it("leaves a value it cannot parse alone", () => {
    expect(withAlpha("not-a-colour", 0.5)).toBe("not-a-colour");
  });
});
