/**
 * Reading a Codex Dream Skin theme.
 *
 * The format is the same as ours, so these tests are mostly about the two places it is *not*:
 * their copy block, which has no surface here, and their `image` name, which their validator
 * fixes and ours does not.
 */
import { describe, expect, it } from "vitest";
import { coerceSkinPackage, isDreamSkinTheme, readDreamSkinTheme } from "../src/index.js";

/** A theme in their shape, with the palette their Gothic preset declares. */
const GOTHIC = {
  schemaVersion: 1,
  id: "preset-gothic-void-crusade",
  name: "Gothic Void Crusade",
  tagline: "Cathedrals at the edge of the void",
  quote: "MAKE SOMETHING WONDERFUL",
  statusText: "DREAM SKIN ONLINE",
  appearance: "dark",
  image: "background.jpg",
  art: { focusX: 0.76, focusY: 0.45, safeArea: "left", taskMode: "ambient" },
  colors: {
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
  },
};

/** A theme that declares `appearance: auto`, which upstream means "checked under both shells". */
const ARINA = {
  ...GOTHIC,
  id: "preset-arina-hashimoto",
  appearance: "auto",
  image: "background.jpg",
};

describe("isDreamSkinTheme", () => {
  it("recognises their shape by the absence of a `schema` field", () => {
    expect(isDreamSkinTheme(GOTHIC)).toBe(true);
    expect(isDreamSkinTheme({ ...GOTHIC, schema: "jiumate.skin" })).toBe(false);
    expect(isDreamSkinTheme({ schemaVersion: 1, id: "x" })).toBe(false);
    expect(isDreamSkinTheme(null)).toBe(false);
    expect(isDreamSkinTheme("nope")).toBe(false);
  });
});

describe("readDreamSkinTheme", () => {
  it("carries the palette across unchanged, because it is the same contract", () => {
    const { manifest } = readDreamSkinTheme(GOTHIC);
    expect(manifest["colors"]).toEqual(GOTHIC.colors);
  });

  it("carries `appearance` across, including `auto`", () => {
    // Their `auto` and ours mean the same thing, so translating it would be a chance to get it
    // wrong for no gain.
    expect(readDreamSkinTheme(GOTHIC).manifest["appearance"]).toBe("dark");
    expect(readDreamSkinTheme(ARINA).manifest["appearance"]).toBe("auto");
  });

  it("reads an absent `appearance` as `auto`, matching upstream", () => {
    const { manifest } = readDreamSkinTheme({ ...GOTHIC, appearance: undefined });
    expect(manifest["appearance"]).toBe("auto");
  });

  it("keeps the `art` framing, dropping the `auto` values this host cannot infer", () => {
    const { manifest } = readDreamSkinTheme(GOTHIC);
    expect(manifest["art"]).toEqual({
      focusX: 0.76,
      focusY: 0.45,
      safeArea: "left",
      taskMode: "ambient",
    });
    // `auto` means "infer it from the image" upstream. This host has no image analysis, so the
    // field is dropped rather than guessed at.
    const inferred = readDreamSkinTheme({
      ...GOTHIC,
      art: { focusX: 0.5, focusY: 0.5, safeArea: "auto", taskMode: "auto" },
    });
    expect(inferred.manifest["art"]).toEqual({ focusX: 0.5, focusY: 0.5 });
  });

  it("keeps their copy in `origin` and says it was not applied", () => {
    // The tagline, quote and status text are written for the Codex shell's chrome. This host has
    // nowhere to put them, and dropping them silently would make a round-trip export lossy.
    const { manifest, copy, warnings } = readDreamSkinTheme(GOTHIC);
    expect(copy["tagline"]).toBe("Cathedrals at the edge of the void");
    expect((manifest["origin"] as Record<string, unknown>)["copy"]).toEqual(copy);
    expect(warnings.join(" ")).toMatch(/没有对应位置/);
  });

  it("produces a body the manifest validator accepts", () => {
    const pkg = coerceSkinPackage(readDreamSkinTheme(GOTHIC).manifest, { packagePath: "/x" });
    expect(pkg.appearance).toBe("dark");
    expect(pkg.colors).toEqual(GOTHIC.colors);
    expect(pkg.art.focusX).toBe(0.76);
    expect(pkg.background?.filename).toBe("background.jpg");
    expect(pkg.origin?.originalId).toBe("preset-gothic-void-crusade");
  });

  it("fills a missing role from the ones present, and warns", () => {
    // An older Windows theme declared `palette.accent` alone. A theme with a usable accent and a
    // guessed neutral is still a theme; refusing it would be the worse answer.
    const { colors } = { colors: { ...GOTHIC.colors, line: undefined } };
    const partial = { ...GOTHIC, colors: { ...colors, muted: undefined, line: undefined } };
    const { manifest, warnings } = readDreamSkinTheme(partial);
    const out = manifest["colors"] as Record<string, string>;
    expect(out["muted"]).toBeDefined();
    expect(out["line"]).toBeDefined();
    expect(warnings.join(" ")).toMatch(/缺少这些颜色/);
    expect(() => coerceSkinPackage(manifest, { packagePath: "/x" })).not.toThrow();
  });

  it("refuses a theme with no palette at all", () => {
    expect(() => readDreamSkinTheme({ schemaVersion: 1, id: "x" })).toThrow(/no `colors` block/);
  });

  it("falls back to the id when there is no name", () => {
    const { manifest } = readDreamSkinTheme({ ...GOTHIC, name: undefined });
    expect(manifest["name"]).toBe("preset-gothic-void-crusade");
  });

  it("leaves `image` out when the theme names no artwork", () => {
    const { manifest } = readDreamSkinTheme({ ...GOTHIC, image: undefined });
    expect(manifest["image"]).toBeUndefined();
    expect(coerceSkinPackage(manifest, { packagePath: "/x" }).background).toBeNull();
  });
});
