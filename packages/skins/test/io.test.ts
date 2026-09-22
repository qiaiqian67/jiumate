import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ASSET_LIMIT,
  MANIFEST_LIMIT,
  MAX_SKINS,
  MAX_TOKENS,
  SkinPackageError,
  coerceSkinPackage,
  deleteSkinPackage,
  fingerprintSkinPackage,
  importFingerprint,
  readSkinCatalog,
  readSkinPackage,
  readSkinReceipt,
  slugifySkinId,
  writeSkinPackage,
  writeSkinReceipt,
  type SkinPackage,
} from "../src/index.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "linsight-skins-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A minimal valid manifest, with `overrides` shallow-merged over it. */
/** The ten roles, in the palette a light theme would declare. */
const COLORS = {
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

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: "linsight.skin",
    schemaVersion: 1,
    id: "sakura",
    name: "樱",
    version: "1.0.0",
    appearance: "light",
    colors: COLORS,
    ...overrides,
  };
}

function coerce(value: Record<string, unknown>, packagePath = "/data/skins/sakura"): SkinPackage {
  return coerceSkinPackage(value, { packagePath });
}

async function stage(slug: string, value: Record<string, unknown>): Promise<void> {
  const dir = join(root, "skins", slug);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "skin.json"), JSON.stringify(value), "utf8");
}

describe("slugifySkinId", () => {
  it("normalises mixed case and punctuation", () => {
    expect(slugifySkinId("Sakura Night!")).toBe("sakura-night");
    expect(slugifySkinId("preset-gothic-void-crusade")).toBe("preset-gothic-void-crusade");
    expect(slugifySkinId("panda_pix/2")).toBe("panda_pix-2");
  });

  it("folds dots, so the slug is always a plain directory name", () => {
    expect(slugifySkinId("com.example.theme")).toBe("com-example-theme");
  });

  it("falls back when nothing survives", () => {
    expect(slugifySkinId("   ")).toBe("custom-skin");
    expect(slugifySkinId(null)).toBe("custom-skin");
  });
});

describe("coerceSkinPackage: shape", () => {
  it("accepts a minimal manifest", () => {
    const skin = coerce(manifest());
    expect(skin.id).toBe("sakura");
    expect(skin.appearance).toBe("light");
    expect(skin.source).toBe("user");
    expect(skin.tokens.light["--color-gray-50"]).toBe(COLORS.background);
    expect(skin.background).toBeNull();
  });

  it("requires the schema discriminator and version", () => {
    expect(() => coerce(manifest({ schema: "other" }))).toThrow(/schema "linsight.skin"/);
    expect(() => coerce(manifest({ schemaVersion: 2 }))).toThrow(/schemaVersion 1/);
  });

  it("requires an id, a name, an appearance and a semver version", () => {
    expect(() => coerce(manifest({ id: "!!!" }))).toThrow(/usable `id`/);
    expect(() => coerce(manifest({ name: "   " }))).toThrow(/missing `name`/);
    expect(() => coerce(manifest({ appearance: "sepia" }))).toThrow(/"light", "dark" or "auto"/);
    expect(() => coerce(manifest({ version: "1.0" }))).toThrow(/semver/);
  });

  it("reads an absent appearance as `auto`, matching upstream", () => {
    // A theme that says nothing about its shells is claiming the artwork was checked under
    // both. That is upstream's default and it is a claim, not a neutral value — which is why the
    // built-in gallery states it explicitly.
    expect(coerce(manifest({ appearance: undefined })).appearance).toBe("auto");
  });

  it("derives both readings rather than taking a ramp from the manifest", () => {
    const skin = coerce(manifest());
    expect(Object.keys(skin.tokens).sort()).toEqual(["dark", "light"]);
    expect(Object.keys(skin.surfaces).sort()).toEqual(["dark", "light"]);
    // The palette's own colours land where each reading expects them.
    expect(skin.tokens.light["--color-gray-50"]).toBe(COLORS.background);
    expect(skin.tokens.dark["--color-gray-950"]).toBe(COLORS.background);
  });
});

describe("coerceSkinPackage: the palette", () => {
  it("requires all ten roles, naming the ones that are missing", () => {
    // A missing role has no defensible default: guessing a theme's body-text colour is worse
    // than refusing the theme.
    const { text, line, ...partial } = COLORS;
    expect(() => coerce(manifest({ colors: partial }))).toThrow(/missing: text, line/);
  });

  it("rejects unknown keys rather than ignoring them", () => {
    // An extra key is a typo the author would rather hear about.
    expect(() => coerce(manifest({ colors: { ...COLORS, accentBg: "#fff" } }))).toThrow(
      /unknown keys: accentBg/,
    );
  });

  it("rejects a value that is not a literal color", () => {
    expect(() => coerce(manifest({ colors: { ...COLORS, accent: "gold" } }))).toThrow(
      /hex, rgb\(\) or rgba\(\)/,
    );
  });

  it("rejects a value that would break out of the rule it is written into", () => {
    // The color pattern is the injection guard: none of these shapes can contain `}` or `;`,
    // and the ramp is built by interpolating these values into a stylesheet.
    for (const value of [
      "#fff; } body { display: none } .x {",
      "var(--evil)",
      "url(https://example.com/x.png)",
      "rgb(0,0,0); background-image: url(x)",
      "expression(alert(1))",
    ]) {
      expect(() => coerce(manifest({ colors: { ...COLORS, accent: value } }))).toThrow(
        SkinPackageError,
      );
    }
  });

  it("accepts rgba, which is what a hairline usually is", () => {
    expect(
      coerce(manifest({ colors: { ...COLORS, line: "rgba(200, 165, 90, 0.28)" } })).colors.line,
    ).toBe("rgba(200, 165, 90, 0.28)");
  });
});

describe("coerceSkinPackage: art", () => {
  it("defaults the framing and leaves the advisory fields unstated", () => {
    const skin = coerce(manifest());
    expect(skin.art.focusX).toBe(0.5);
    expect(skin.art.zoom).toBe(1);
    // `auto` means "infer it from the image" upstream. This host has no image analysis, so an
    // unstated or inferred value stays unstated rather than being guessed at.
    expect(skin.art.safeArea).toBeNull();
    expect(skin.art.taskMode).toBeNull();
  });

  it("aims the focal point at the side the safe area leaves free", () => {
    // A fact about the composition rather than a guess about the pixels: if the left is
    // low-information, the subject is on the right.
    expect(coerce(manifest({ art: { safeArea: "left" } })).art.focusX).toBe(0.72);
    expect(coerce(manifest({ art: { safeArea: "right" } })).art.focusX).toBe(0.28);
    expect(coerce(manifest({ art: { safeArea: "none" } })).art.focusX).toBe(0.5);
  });

  it("bounds the framing parameters", () => {
    expect(() => coerce(manifest({ art: { focusX: 1.5 } }))).toThrow(/focusX/);
    expect(() => coerce(manifest({ art: { zoom: 0.5 } }))).toThrow(/zoom/);
    expect(() => coerce(manifest({ art: { dim: -1 } }))).toThrow(/dim/);
    expect(() => coerce(manifest({ art: { safeArea: "top" } }))).toThrow(/safeArea/);
    expect(() => coerce(manifest({ art: { taskMode: "loud" } }))).toThrow(/taskMode/);
  });

  it("accepts the values upstream's validator accepts, and no others", () => {
    // Their prose mentions `center` and `auto`; their validator accepts only these three. The
    // validator is the contract.
    for (const safeArea of ["left", "right", "none"]) {
      expect(coerce(manifest({ art: { safeArea } })).art.safeArea).toBe(safeArea);
    }
    for (const taskMode of ["ambient", "full", "off"]) {
      expect(coerce(manifest({ art: { taskMode } })).art.taskMode).toBe(taskMode);
    }
  });
});

describe("coerceSkinPackage: the linsight block", () => {
  it("takes a font stack and validates it separately from colours", () => {
    expect(
      coerce(manifest({ linsight: { font: 'Inter, "PingFang SC", sans-serif' } })).extras.font,
    ).toBe('Inter, "PingFang SC", sans-serif');
    expect(() => coerce(manifest({ linsight: { font: "Inter; } body { x: y" } }))).toThrow(
      /plain font stack/,
    );
  });

  it("is optional", () => {
    expect(coerce(manifest()).extras.font).toBeNull();
    expect(coerce(manifest({ linsight: {} })).extras.font).toBeNull();
  });
});

describe("coerceSkinPackage: assets", () => {
  it("accepts a single-segment filename with a known extension", () => {
    for (const [file, mime] of [
      ["background.webp", "image/webp"],
      ["background.png", "image/png"],
      ["background.jpeg", "image/jpeg"],
      ["background.svg", "image/svg+xml"],
      ["portal-hero.PNG", "image/png"],
    ] as const) {
      expect(coerce(manifest({ image: file })).background?.mimeType).toBe(mime);
    }
  });

  it("rejects a path, however it is spelled", () => {
    // The asset route serves whatever the manifest names, so a name with no separator in it is
    // what makes that route safe: it cannot climb anywhere.
    for (const image of ["art/bg.png", "..\\bg.png", "../bg.png", "/etc/passwd", "./bg.png"]) {
      expect(() => coerce(manifest({ image }))).toThrow(/plain filename/);
    }
  });

  it("rejects an unsupported extension", () => {
    expect(() => coerce(manifest({ image: "bg.gif" }))).toThrow(/must end in one of/);
    expect(() => coerce(manifest({ image: "bg" }))).toThrow(/must end in one of/);
  });

  it("resolves the asset inside the package directory", () => {
    const skin = coerce(manifest({ image: "background.jpg" }));
    expect(skin.background?.assetPath).toContain("skins/sakura");
    expect(skin.background?.assetPath.endsWith("/background.jpg")).toBe(true);
  });

  it("takes the framing from `art`, not from a block of its own", () => {
    const skin = coerce(
      manifest({ image: "background.jpg", art: { focusX: 0.2, focusY: 0.8, zoom: 2, dim: 0.4 } }),
    );
    expect(skin.background).toMatchObject({ focusX: 0.2, focusY: 0.8, zoom: 2, dim: 0.4 });
  });

  it("accepts a theme with no artwork at all", () => {
    // A palette-only theme is legal, and is what the two app-matching presets are.
    const skin = coerce(manifest());
    expect(skin.background).toBeNull();
    expect(Object.keys(skin.tokens.light).length).toBeGreaterThan(0);
  });

  it("validates the preview the same way", () => {
    expect(coerce(manifest({ preview: "preview.webp" })).previewMimeType).toBe("image/webp");
    expect(() => coerce(manifest({ preview: "../preview.webp" }))).toThrow(/plain filename/);
  });
});

describe("coerceSkinPackage: origin", () => {
  it("accepts a dreamskin origin and keeps only string copy values", () => {
    const skin = coerce(
      manifest({
        origin: {
          format: "dreamskin",
          originalId: "preset-x",
          appearance: "dark",
          copy: { tagline: "hi", junk: 42 },
        },
      }),
    );
    expect(skin.origin).toEqual({
      format: "dreamskin",
      originalId: "preset-x",
      appearance: "dark",
      copy: { tagline: "hi" },
    });
  });

  it("rejects an unknown origin format", () => {
    expect(() => coerce(manifest({ origin: { format: "other", originalId: "x" } }))).toThrow(
      /origin.format/,
    );
  });
});

describe("catalog IO", () => {
  it("round-trips a skin through write and read", async () => {
    const skin = coerce(
      manifest({
        image: "background.jpg",
        art: { focusX: 0.25, safeArea: "right" },
        preview: "preview.png",
      }),
      join(root, "skins", "sakura"),
    );
    await writeSkinPackage(root, skin);
    const read = await readSkinPackage(root, "sakura");
    expect(read).not.toBeNull();
    expect(read?.colors).toEqual(COLORS);
    expect(read?.appearance).toBe("light");
    expect(read?.background?.focusX).toBe(0.25);
    expect(read?.art.safeArea).toBe("right");
    expect(read?.previewMimeType).toBe("image/png");
    // The derived ramp is not on disk, so it has to come back the same way it went out.
    expect(read?.tokens.light["--color-gray-50"]).toBe(COLORS.background);
  });

  it("writes a canonical manifest: sorted roles, no derived ramp", async () => {
    const skin = coerce(manifest({ image: "background.jpg" }), join(root, "skins", "sakura"));
    await writeSkinPackage(root, skin);
    const onDisk = JSON.parse(
      await (
        await import("node:fs/promises")
      ).readFile(join(root, "skins", "sakura", "skin.json"), "utf8"),
    ) as Record<string, unknown>;
    // Sorted, so a re-write is byte-stable and two manifests with the same palette fingerprint
    // the same regardless of the order the author wrote them in.
    expect(Object.keys(onDisk["colors"] as Record<string, string>)).toEqual([
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
    ]);
    // The ramp is derived, never stored: a manifest carrying it could contradict its own palette.
    expect(onDisk["tokens"]).toBeUndefined();
    expect(onDisk["renderers"]).toBeUndefined();
    expect(onDisk["image"]).toBe("background.jpg");
    expect(onDisk["appearance"]).toBe("light");
  });

  it("lists installed skins, skipping an unreadable one instead of failing", async () => {
    await stage("sakura", manifest());
    await stage("broken", { schema: "linsight.skin", schemaVersion: 1 });
    await writeFile(join(root, "skins", "stray.txt"), "not a directory", "utf8");
    const skins = await readSkinCatalog(root);
    expect(skins.map((s) => s.id)).toEqual(["sakura"]);
  });

  it("returns an empty catalog when the directory does not exist", async () => {
    expect(await readSkinCatalog(join(root, "nowhere"))).toEqual([]);
  });

  it("truncates at MAX_SKINS rather than throwing", async () => {
    // Throwing here would read as "the catalog is empty" to every caller that catches, which
    // hides every installed skin and defeats the import guard that counts them.
    for (let i = 0; i < MAX_SKINS + 3; i++) {
      await stage(`skin-${String(i).padStart(3, "0")}`, manifest({ id: `skin-${i}` }));
    }
    const skins = await readSkinCatalog(root);
    expect(skins).toHaveLength(MAX_SKINS);
  });

  it("deletes a skin directory", async () => {
    await stage("sakura", manifest());
    await deleteSkinPackage(root, "sakura");
    expect(await readSkinPackage(root, "sakura")).toBeNull();
  });

  it("reads a missing manifest as null", async () => {
    expect(await readSkinPackage(root, "absent")).toBeNull();
  });
});

describe("fingerprints", () => {
  it("is independent of where the skin is installed", () => {
    // The property that keeps re-imports idempotent: hashing resolved absolute paths would
    // make every install look edited to the next reader that compared the two.
    const atA = coerce(manifest({ background: { asset: "bg.jpg" } }), "/one/skins/sakura");
    const atB = coerce(manifest({ background: { asset: "bg.jpg" } }), "/two/elsewhere/sakura");
    expect(fingerprintSkinPackage(atA)).toBe(fingerprintSkinPackage(atB));
  });

  it("changes when a role changes", () => {
    const a = coerce(manifest());
    const b = coerce(manifest({ colors: { ...COLORS, accent: "#eeeeee" } }));
    expect(fingerprintSkinPackage(a)).not.toBe(fingerprintSkinPackage(b));
  });

  it("is stable across a write/read round trip", async () => {
    const skin = coerce(
      manifest({ background: { asset: "background.jpg" } }),
      join(root, "skins", "sakura"),
    );
    await writeSkinPackage(root, skin);
    const read = await readSkinPackage(root, "sakura");
    expect(read).not.toBeNull();
    expect(fingerprintSkinPackage(read as SkinPackage)).toBe(fingerprintSkinPackage(skin));
  });

  it("length-prefixes each blob so a different split cannot collide", () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([1, 2]);
    const c = new Uint8Array([3]);
    expect(importFingerprint([a])).not.toBe(importFingerprint([b, c]));
    expect(importFingerprint([a, b])).not.toBe(importFingerprint([b, a]));
  });
});

describe("receipts", () => {
  it("round-trips", async () => {
    const receipt = {
      schemaVersion: 1,
      sourceKey: "abc",
      fingerprint: "f1",
      installedFingerprint: "f2",
    };
    await writeSkinReceipt(root, "sakura", receipt);
    expect(await readSkinReceipt(root, "sakura")).toEqual(receipt);
  });

  it("reads a missing receipt as null", async () => {
    expect(await readSkinReceipt(root, "absent")).toBeNull();
  });

  it("reads a corrupted receipt as null rather than failing the catalog", async () => {
    // A receipt is a cache of "we already imported this", not a source of truth. An
    // unparsable one must not take down the listing that contains it.
    const dir = join(root, "skins", "sakura");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, ".linsight-skin-receipt.json"), "{ not json", "utf8");
    expect(await readSkinReceipt(root, "sakura")).toBeNull();
  });

  it("reads a receipt with an unsupported shape as null", async () => {
    const dir = join(root, "skins", "sakura");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, ".linsight-skin-receipt.json"),
      JSON.stringify({ schemaVersion: 99, sourceKey: "a" }),
      "utf8",
    );
    expect(await readSkinReceipt(root, "sakura")).toBeNull();
  });

  it("refuses to write a receipt from another schema version", async () => {
    await expect(
      writeSkinReceipt(root, "sakura", {
        schemaVersion: 2,
        sourceKey: "a",
        fingerprint: "b",
        installedFingerprint: "c",
      }),
    ).rejects.toThrow(/schemaVersion=2/);
  });
});

describe("declared bounds", () => {
  it("rejects an oversized manifest", async () => {
    const dir = join(root, "skins", "big");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "skin.json"),
      JSON.stringify(manifest({ description: "x".repeat(MANIFEST_LIMIT) })),
      "utf8",
    );
    await expect(readSkinPackage(root, "big")).rejects.toThrow(/exceeds/);
  });

  it("rejects a non-JSON manifest", async () => {
    const dir = join(root, "skins", "bad");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "skin.json"), "{ oops", "utf8");
    await expect(readSkinPackage(root, "bad")).rejects.toThrow(/not valid JSON/);
  });

  it("rejects a non-object manifest", () => {
    expect(() => coerceSkinPackage([], { packagePath: "/x" })).toThrow(/must be a JSON object/);
    expect(() => coerceSkinPackage(null, { packagePath: "/x" })).toThrow(/must be a JSON object/);
  });
});

describe("constants", () => {
  it("exposes the documented bounds", () => {
    expect(MANIFEST_LIMIT).toBe(64 * 1024);
    expect(ASSET_LIMIT).toBe(16 * 1024 * 1024);
    expect(MAX_SKINS).toBe(128);
    expect(MAX_TOKENS).toBe(64);
  });
});
