/**
 * Every built-in theme's artwork must exist in the web bundle.
 *
 * `fromPreset` builds `/themes/<id>/<filename>` from the preset table alone, so a typo in either
 * half produces a theme whose card shows a broken image and whose background layer 404s — and
 * nothing else notices. `tsc` cannot see inside a string, the type only promises the filename is
 * a string, and the server never serves these files (they are web-bundle assets, not installed
 * packages). The failure mode is a silent one: the panels go translucent over a missing image,
 * so the page just looks wrong.
 *
 * So the two halves are checked against each other here: the table against the disk. The other
 * direction matters just as much — an unreferenced file in the bundle is either dead weight or
 * artwork somebody dropped in without going through the attribution in `THIRD-PARTY-NOTICES.md`,
 * and bundling a third-party image is a licensing decision that should not be makeable by
 * copying a file in.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BUILTIN_THEMES } from "@jiumate/skins/presets";
import { THEME_COLOR_KEYS, THEME_SURFACE_KEYS } from "@jiumate/skins";

const PUBLIC_DIR = path.join(import.meta.dirname, "..", "public");
const THEMES_DIR = path.join(PUBLIC_DIR, "themes");

/** Where the web bundle serves a theme's artwork from. Kept in step with `skin-service.ts`. */
const BUILTIN_THEME_BASE = "themes";

/** The themes that ship artwork at all. A palette-only theme has none by design. */
const WITH_ARTWORK = BUILTIN_THEMES.filter((theme) => theme.filename !== "");

describe("built-in theme artwork", () => {
  it("ships a gallery big enough to be worth a picker", () => {
    // Guards the guard: the loops below pass vacuously over an empty list.
    expect(BUILTIN_THEMES.length).toBeGreaterThanOrEqual(8);
  });

  it("ships the file each theme declares", () => {
    for (const theme of WITH_ARTWORK) {
      const file = path.join(PUBLIC_DIR, BUILTIN_THEME_BASE, theme.id, theme.filename);
      expect(fs.existsSync(file), `missing: ${path.relative(PUBLIC_DIR, file)}`).toBe(true);
      // A zero-byte file would satisfy `existsSync` and still render as nothing.
      expect(fs.statSync(file).size).toBeGreaterThan(0);
    }
  });

  it("keeps every raster artwork inside the size budget", () => {
    // These ship in the web bundle the desktop app carries, so a stray 8 MiB image is a shipping
    // decision rather than a detail. The authored SVGs are a few KiB; the one redistributed
    // photograph is ~790 KiB.
    for (const theme of WITH_ARTWORK) {
      const file = path.join(PUBLIC_DIR, BUILTIN_THEME_BASE, theme.id, theme.filename);
      expect(fs.statSync(file).size, theme.id).toBeLessThan(2 * 1024 * 1024);
    }
  });

  it("ships no artwork file that no theme declares", () => {
    const declared = new Set(WITH_ARTWORK.map((theme) => `${theme.id}/${theme.filename}`));
    if (!fs.existsSync(THEMES_DIR)) return;
    const found = fs
      .readdirSync(THEMES_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((dir) =>
        fs.readdirSync(path.join(THEMES_DIR, dir.name)).map((file) => `${dir.name}/${file}`),
      )
      .filter((rel) => !declared.has(rel));
    expect(found, `unreferenced files under public/themes: ${found.join(", ")}`).toEqual([]);
  });
});

describe("built-in theme palettes", () => {
  it("declares all ten roles, as upstream requires when the block is present", () => {
    for (const theme of BUILTIN_THEMES) {
      expect(Object.keys(theme.colors).sort(), theme.id).toEqual([...THEME_COLOR_KEYS].sort());
      for (const key of THEME_COLOR_KEYS) {
        expect(theme.colors[key].length, `${theme.id}.${key}`).toBeGreaterThan(0);
      }
    }
  });

  it("carries the framing the renderer needs", () => {
    for (const theme of BUILTIN_THEMES) {
      expect(theme.art.focusX, theme.id).toBeGreaterThanOrEqual(0);
      expect(theme.art.focusX, theme.id).toBeLessThanOrEqual(1);
      expect(theme.art.focusY, theme.id).toBeGreaterThanOrEqual(0);
      expect(theme.art.focusY, theme.id).toBeLessThanOrEqual(1);
      expect(theme.art.zoom, theme.id).toBeGreaterThan(0);
      expect(theme.art.dim, theme.id).toBeGreaterThanOrEqual(0);
      expect(theme.art.dim, theme.id).toBeLessThanOrEqual(1);
    }
  });

  it("names only roles that exist as surfaces", () => {
    // A surface the renderer cannot apply to is a silent no-op — the slider would move and
    // nothing would happen.
    for (const role of THEME_SURFACE_KEYS) {
      expect(THEME_COLOR_KEYS).toContain(role);
    }
  });

  it("claims `auto` only for artwork that is not single-shell", () => {
    // Upstream is emphatic that declaring `auto` for a dark painting is a defect rather than a
    // preference: the parts of the window this host does not paint render against the shell, so
    // a dark artwork under a light shell has the two fighting. This pins the three dark-leaning
    // themes to `dark` so a later edit cannot quietly widen them.
    const dark = BUILTIN_THEMES.filter((theme) => theme.appearance === "dark").map((t) => t.id);
    expect(dark).toContain("gothic-void-crusade");
    expect(dark).toContain("star-veil");
    expect(dark).toContain("black-gold-stage");
  });
});
