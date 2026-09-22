/**
 * Integration tests for the theme surface:
 *   - GET    /api/skins                    (empty catalog, then a listed install)
 *   - POST   /api/skins/import             (native folder, Dream-Skin theme, idempotency,
 *                                           fingerprint enforcement, bad input)
 *   - GET    /api/skins/:slug/asset/:name  (serves a declared asset; nothing else)
 *   - DELETE /api/skins/:slug              (removes the install; its asset then 404s)
 *   - PUT    /api/me/prefs                 (activeTheme, bounds enforced)
 *
 * The manifest/palette validation itself lives in `@prismshadow/linsight-skins` and is covered
 * by its own unit suite; these tests pin the HTTP + prefs contract on top.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apiClient, createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";

/** The ten roles, which the format requires in full whenever `colors` is present. */
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

/**
 * A minimal but valid native manifest.
 *
 * The format is Codex Dream Skin's, so this is their `theme.json` plus the `schema`
 * discriminator that tells the two apart — see `isDreamSkinTheme`.
 */
const MANIFEST = {
  schema: "linsight.skin",
  schemaVersion: 1,
  id: "sakura",
  name: "樱",
  version: "1.0.0",
  appearance: "light",
  colors: COLORS,
  art: { focusX: 0.25, focusY: 0.5, safeArea: "left", taskMode: "ambient" },
  image: "background.jpg",
  preview: "preview.png",
};

/** A Codex-Dream-Skin theme, as the upstream presets ship it. */
const DREAM_SKIN_THEME = {
  schemaVersion: 1,
  id: "preset-gothic-void-crusade",
  name: "Gothic Void Crusade",
  tagline: "A solemn cathedral-world horizon for focused work.",
  statusText: "VOID CRUSADE ONLINE",
  image: "background.jpg",
  appearance: "dark",
  art: { focusX: 0.76, focusY: 0.45, safeArea: "left", taskMode: "ambient" },
  colors: {
    background: "#0d0d0e",
    panel: "#171513",
    panelAlt: "#211d18",
    accent: "#c8a55a",
    accentAlt: "#e3c27a",
    secondary: "#74352e",
    highlight: "#8a2f27",
    text: "#f3ead7",
    muted: "#b5a386",
    line: "rgba(200, 165, 90, .28)",
  },
};

const IMAGE_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const PREVIEW_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9]);

/**
 * A stored-only ZIP builder, for the archive tests.
 *
 * The ZIP reader's own suite covers the format exhaustively — deflate, malformed headers,
 * traversal, bombs. These tests are about the *route*: that an uploaded archive reaches the same
 * validator a folder does, and that a hostile one is refused with a 4xx rather than a 500. So
 * the fixture only needs to produce a well-formed archive, and `stored` needs no compressor.
 */
function makeZip(files: Record<string, Uint8Array>): Uint8Array {
  const u16 = (value: number): Buffer => {
    const out = Buffer.alloc(2);
    out.writeUInt16LE(value, 0);
    return out;
  };
  const u32 = (value: number): Buffer => {
    const out = Buffer.alloc(4);
    out.writeUInt32LE(value >>> 0, 0);
    return out;
  };
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, bytes] of Object.entries(files)) {
    const nameBytes = Buffer.from(name, "ascii");
    const body = Buffer.from(bytes);
    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0), // stored
      u16(0),
      u16(0),
      u32(0),
      u32(body.byteLength),
      u32(body.byteLength),
      u16(nameBytes.byteLength),
      u16(0),
      nameBytes,
      body,
    ]);
    centrals.push(
      Buffer.concat([
        u32(0x02014b50),
        u16(0x031e),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(body.byteLength),
        u32(body.byteLength),
        u16(nameBytes.byteLength),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0o100644 << 16),
        u32(offset),
        nameBytes,
      ]),
    );
    locals.push(local);
    offset += local.byteLength;
  }
  const directory = Buffer.concat(centrals);
  return Buffer.concat([
    ...locals,
    directory,
    Buffer.concat([
      u32(0x06054b50),
      u16(0),
      u16(0),
      u16(centrals.length),
      u16(centrals.length),
      u32(directory.byteLength),
      u32(offset),
      u16(0),
    ]),
  ]);
}

async function makeSkinSource(
  root: string,
  manifest: Record<string, unknown> = MANIFEST,
): Promise<string> {
  const dir = path.join(root, "source-skin");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "skin.json"), JSON.stringify(manifest, null, 2), "utf8");
  await fs.writeFile(path.join(dir, "background.jpg"), IMAGE_BYTES);
  await fs.writeFile(path.join(dir, "preview.png"), PREVIEW_BYTES);
  return dir;
}

async function makeDreamSkinSource(
  root: string,
  theme: Record<string, unknown> = DREAM_SKIN_THEME,
): Promise<string> {
  const dir = path.join(root, "source-theme");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "theme.json"), JSON.stringify(theme, null, 2), "utf8");
  await fs.writeFile(path.join(dir, "background.jpg"), IMAGE_BYTES);
  return dir;
}

interface SkinListBody {
  skins: {
    id: string;
    name: string;
    appearance: string;
    source: string;
    colors: Record<string, string>;
    tokens: Record<string, Record<string, string>>;
    surfaces: Record<string, string[]>;
    background: { filename: string; focusX: number } | null;
    origin: {
      format: string;
      originalId: string;
      appearance: string | null;
      copy: Record<string, string>;
    } | null;
  }[];
  diagnostics: string[];
}
interface ImportBody {
  skin: { id: string; appearance: string };
  warnings: string[];
}
interface PrefsBody {
  prefs: Record<string, unknown>;
}

describe("skins api", () => {
  let t: TestApp;
  let client: ReturnType<typeof apiClient>;

  beforeEach(async () => {
    t = await createTestApp();
    const admin = await loginAdmin(t.app);
    client = apiClient(t.app, admin.cookie);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("GET /api/skins is empty (no diagnostics) on a fresh data root", async () => {
    const res = await client.get("/api/skins");
    expect(res.status).toBe(200);
    expect((await res.json()) as SkinListBody).toEqual({ skins: [], diagnostics: [] });
  });

  it("imports a native folder, lists it, serves its assets, then deletes it", async () => {
    const source = await makeSkinSource(t.root);

    const imported = await client.post("/api/skins/import", { path: source });
    expect(imported.status).toBe(200);
    const body = (await imported.json()) as ImportBody;
    expect(body.skin.id).toBe("sakura");
    expect(body.warnings).toEqual([]);

    const list = (await (await client.get("/api/skins")).json()) as SkinListBody;
    expect(list.skins.map((s) => s.id)).toEqual(["sakura"]);
    expect(list.skins[0]!.source).toBe("user");
    expect(list.skins[0]!.appearance).toBe("light");
    // The ramp is derived, not declared: the theme carries the palette, and both readings are
    // laid out from it. `--color-gray-50` is the page under a light shell.
    expect(list.skins[0]!.tokens["light"]!["--color-gray-50"]).toBe(COLORS.background);
    expect(list.skins[0]!.tokens["dark"]!["--color-gray-950"]).toBe(COLORS.background);
    expect(list.skins[0]!.background?.filename).toBe("background.jpg");
    expect(list.skins[0]!.background?.focusX).toBe(0.25);

    const asset = await client.get("/api/skins/sakura/asset/background.jpg");
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toBe("image/jpeg");
    expect(Buffer.from(await asset.arrayBuffer()).equals(IMAGE_BYTES)).toBe(true);

    const preview = await client.get("/api/skins/sakura/asset/preview.png");
    expect(preview.status).toBe(200);
    expect(preview.headers.get("content-type")).toBe("image/png");

    const removed = await client.delete("/api/skins/sakura");
    expect(removed.status).toBe(204);
    expect((await client.get("/api/skins/sakura/asset/background.jpg")).status).toBe(404);
    expect(((await (await client.get("/api/skins")).json()) as SkinListBody).skins).toEqual([]);
  });

  it("copies the assets and re-anchors the manifest to the install directory", async () => {
    const source = await makeSkinSource(t.root);
    await client.post("/api/skins/import", { path: source });

    // The installed manifest must not point back at the source folder, or deleting the
    // source would break the install.
    const installed = JSON.parse(
      await fs.readFile(path.join(t.root, "skins", "sakura", "skin.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(installed["image"]).toBe("background.jpg");
    expect(installed["preview"]).toBe("preview.png");
    expect(await fs.readFile(path.join(t.root, "skins", "sakura", "background.jpg"))).toBeTruthy();

    await fs.rm(source, { recursive: true, force: true });
    expect((await client.get("/api/skins/sakura/asset/background.jpg")).status).toBe(200);
  });

  it("re-importing the same source is idempotent (one install, same id)", async () => {
    const source = await makeSkinSource(t.root);
    const first = await client.post("/api/skins/import", { path: source });
    const second = await client.post("/api/skins/import", { path: source });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(((await first.json()) as ImportBody).skin.id).toBe(
      ((await second.json()) as ImportBody).skin.id,
    );
    expect(((await (await client.get("/api/skins")).json()) as SkinListBody).skins).toHaveLength(1);
  });

  it("accepts an explicit null fingerprint as 'nothing to verify against'", async () => {
    // The settings page sends `expectedFingerprint: null` for a folder the user chose
    // directly; rejecting it as a bad type would make every import from Settings fail.
    const source = await makeSkinSource(t.root);
    const res = await client.post("/api/skins/import", {
      path: source,
      expectedFingerprint: null,
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as ImportBody).skin.id).toBe("sakura");
  });

  it("refuses an import whose source changed under the reviewer", async () => {
    const source = await makeSkinSource(t.root);
    const res = await client.post("/api/skins/import", {
      path: source,
      expectedFingerprint: "0".repeat(64),
    });
    expect(res.status).toBe(400);
    expect(((await (await client.get("/api/skins")).json()) as SkinListBody).skins).toEqual([]);
  });

  it("imports a Codex-Dream-Skin theme, keeping its palette and reporting its copy", async () => {
    const source = await makeDreamSkinSource(t.root);
    const res = await client.post("/api/skins/import", { path: source });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ImportBody;
    expect(body.skin.id).toBe("preset-gothic-void-crusade");
    // Their `appearance` carries across unchanged — it means the same thing here.
    expect(body.skin.appearance).toBe("dark");
    // The copy has no surface in this host, and the user is told rather than left wondering
    // why their tagline never appeared.
    expect(body.warnings.some((w) => w.includes("文案"))).toBe(true);

    const list = (await (await client.get("/api/skins")).json()) as SkinListBody;
    const skin = list.skins[0]!;
    expect(skin.origin?.format).toBe("dreamskin");
    expect(skin.origin?.originalId).toBe("preset-gothic-void-crusade");
    expect(skin.origin?.appearance).toBe("dark");
    expect(skin.origin?.copy["statusText"]).toBe("VOID CRUSADE ONLINE");

    // Stored verbatim, with the surfaces *declared* rather than pre-softened: the transparency
    // is applied at render time so the appearance page can offer it as a control.
    expect(skin.colors.accent).toBe("#c8a55a");
    expect(skin.tokens["dark"]!["--color-gray-950"]).toBe("#0d0d0e");
    expect(skin.tokens["dark"]!["--color-gray-50"]).toBe("#f3ead7");
    expect(skin.surfaces["dark"]).toEqual([
      "--color-gray-950",
      "--color-gray-900",
      "--color-gray-800",
    ]);

    expect(
      (await client.get("/api/skins/preset-gothic-void-crusade/asset/background.jpg")).status,
    ).toBe(200);
  });

  it("fills a Dream-Skin theme's missing colours rather than refusing it", async () => {
    // An older Windows theme declared `palette.accent` alone. A theme with a usable accent and
    // a guessed neutral is still a theme; the warning is what keeps that honest.
    const source = await makeDreamSkinSource(t.root, {
      schemaVersion: 1,
      id: "legacy-theme",
      name: "Legacy",
      image: "background.jpg",
      palette: { accent: "#c8a55a" },
    });
    const res = await client.post("/api/skins/import", { path: source });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ImportBody;
    expect(body.warnings.some((w) => w.includes("补齐"))).toBe(true);
  });

  it("warns that a theme's theme.css was ignored, and says what that costs", async () => {
    // Dream Skin's importer requires theme.css, so every theme from that community library has
    // one. This host cannot apply it, which means the imported theme is missing its radius,
    // blur, shadow and typography — the user has to be told, or they compare against a
    // screenshot that was never going to match.
    const source = await makeSkinSource(t.root);
    await fs.writeFile(path.join(source, "theme.css"), ".app { border-radius: 12px; }", "utf8");

    const res = await client.post("/api/skins/import", { path: source });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ImportBody;
    // Named, so the user can see which file it is talking about.
    expect(body.warnings.some((w) => w.includes("theme.css"))).toBe(true);
    // And it says what it means, not just that something was dropped.
    expect(body.warnings.some((w) => w.includes("观感"))).toBe(true);
    // The theme still installs: a stylesheet this host cannot apply is not a reason to refuse
    // the palette and artwork that it can.
    expect(body.skin.id).toBe("sakura");
  });

  it("warns about the same file when it arrives inside an archive", async () => {
    // The archive route stages to a temp directory and then takes the folder path, so this
    // pins that the warning survives that hand-off rather than being a folder-only check.
    const archive = makeZip({
      "theme.json": Buffer.from(JSON.stringify(MANIFEST), "utf8"),
      "background.jpg": IMAGE_BYTES,
      "theme.css": Buffer.from(".app { border-radius: 12px; }", "utf8"),
    });

    const res = await client.postBytes("/api/skins/import/archive", archive);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ImportBody;
    expect(body.warnings.some((w) => w.includes("theme.css"))).toBe(true);
  });

  it("names the unactionable extras together, without a sentence each", async () => {
    // The full shape an official Dream-Skin package ships. `manifest.json` and `LICENSE.txt` are
    // transport the user cannot act on, so they get one grouped line rather than two.
    const archive = makeZip({
      "theme.json": Buffer.from(JSON.stringify(MANIFEST), "utf8"),
      "background.jpg": IMAGE_BYTES,
      "theme.css": Buffer.from(".app { border-radius: 12px; }", "utf8"),
      "manifest.json": Buffer.from("{}", "utf8"),
      "LICENSE.txt": Buffer.from("MIT", "utf8"),
    });

    const res = await client.postBytes("/api/skins/import/archive", archive);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ImportBody;
    expect(body.warnings.some((w) => w.includes("theme.css"))).toBe(true);
    const grouped = body.warnings.find((w) => w.includes("这些文件"));
    expect(grouped).toBeDefined();
    expect(grouped).toContain("LICENSE.txt");
    expect(grouped).toContain("manifest.json");
    // The explained file must not be repeated in the grouped line.
    expect(grouped).not.toContain("theme.css");
  });

  it("says nothing when the source carries nothing extra", async () => {
    // Guards the guard: the checks above pass if the warning fires unconditionally. The first
    // test in this file already pins `warnings: []` for a clean native import; this pins it for
    // a clean *Dream-Skin* import, which is the path that produces warnings for other reasons.
    const source = await makeDreamSkinSource(t.root, {
      schemaVersion: 1,
      id: "plain-theme",
      name: "Plain",
      image: "background.jpg",
      appearance: "dark",
      colors: COLORS,
    });
    const res = await client.post("/api/skins/import", { path: source });
    expect(res.status).toBe(200);
    expect(((await res.json()) as ImportBody).warnings).toEqual([]);
  });

  it("rejects a bad import body and a source with no manifest", async () => {
    expect((await client.post("/api/skins/import", {})).status).toBe(400);
    expect((await client.post("/api/skins/import", { path: "" })).status).toBe(400);
    expect((await client.post("/api/skins/import", { path: 42 })).status).toBe(400);
    expect(
      (await client.post("/api/skins/import", { path: t.root, expectedFingerprint: 7 })).status,
    ).toBe(400);

    const empty = path.join(t.root, "not-a-skin");
    await fs.mkdir(empty, { recursive: true });
    expect((await client.post("/api/skins/import", { path: empty })).status).toBe(400);
  });

  it("rejects a palette that is missing a role, naming it", async () => {
    const source = await makeSkinSource(t.root, {
      ...MANIFEST,
      colors: { ...COLORS, accent: undefined },
    });
    const res = await client.post("/api/skins/import", { path: source });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain(
      "accent",
    );
  });

  it("rejects a manifest whose declared image is missing from the source", async () => {
    const source = await makeSkinSource(t.root, MANIFEST);
    await fs.rm(path.join(source, "background.jpg"));
    const res = await client.post("/api/skins/import", { path: source });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain(
      "background.jpg",
    );
  });

  it("serves only the assets a manifest declares", async () => {
    const source = await makeSkinSource(t.root);
    await client.post("/api/skins/import", { path: source });

    // The manifest and the receipt are in the directory but are not assets.
    expect((await client.get("/api/skins/sakura/asset/skin.json")).status).toBe(404);
    expect((await client.get("/api/skins/sakura/asset/.linsight-skin-receipt.json")).status).toBe(
      404,
    );
    // Neither is an undeclared image the directory happens to hold.
    expect((await client.get("/api/skins/sakura/asset/other.png")).status).toBe(404);
    // Nor anything that tries to climb out, however it is spelled.
    expect((await client.get("/api/skins/sakura/asset/..%2Fskin.json")).status).toBe(404);
    expect((await client.get("/api/skins/sakura/asset/..%5Cskin.json")).status).toBe(404);
    // An unknown theme is a 404 too.
    expect((await client.get("/api/skins/nope/asset/background.jpg")).status).toBe(404);
  });

  it("serves 404 when an installed theme's asset was removed out from under it", async () => {
    const source = await makeSkinSource(t.root);
    await client.post("/api/skins/import", { path: source });
    await fs.rm(path.join(t.root, "skins", "sakura", "background.jpg"), { force: true });
    expect((await client.get("/api/skins/sakura/asset/background.jpg")).status).toBe(404);
  });

  it("answers 404 when deleting a theme that is not installed", async () => {
    // Stricter than the pet route on purpose: a bare `rm -f` answers 204 for a typo as readily
    // as for a success, so the settings page could report "deleted" for nothing at all.
    expect((await client.delete("/api/skins/never-existed")).status).toBe(404);
    // And the same for an id that is not even a legal slug, rather than a 500 from the path.
    expect((await client.delete("/api/skins/..%2Fetc")).status).toBe(404);
  });

  it("skips an unreadable theme instead of failing the whole listing", async () => {
    const source = await makeSkinSource(t.root);
    await client.post("/api/skins/import", { path: source });
    await fs.mkdir(path.join(t.root, "skins", "broken"), { recursive: true });
    await fs.writeFile(path.join(t.root, "skins", "broken", "skin.json"), "{ nope", "utf8");
    const list = (await (await client.get("/api/skins")).json()) as SkinListBody;
    expect(list.skins.map((s) => s.id)).toEqual(["sakura"]);
  });

  it("imports an uploaded archive, and re-uploading it is idempotent", async () => {
    const archive = makeZip({
      "theme.json": Buffer.from(JSON.stringify(MANIFEST), "utf8"),
      "background.jpg": IMAGE_BYTES,
    });

    const first = await client.postBytes("/api/skins/import/archive", archive);
    expect(first.status).toBe(200);
    const body = (await first.json()) as ImportBody;
    expect(body.skin.id).toBe("sakura");
    expect(body.skin.appearance).toBe("light");

    // The archive reaches the same validator a folder does, so the install is identical.
    const list = (await (await client.get("/api/skins")).json()) as SkinListBody;
    expect(list.skins.map((s) => s.id)).toEqual(["sakura"]);
    expect(list.skins[0]!.tokens["light"]!["--color-gray-50"]).toBe(COLORS.background);
    expect((await client.get("/api/skins/sakura/asset/background.jpg")).status).toBe(200);

    // Re-uploading the byte-identical file is recognised by the archive's own hash rather than
    // by a path, because a browser upload has no stable path to key a receipt on.
    const second = await client.postBytes("/api/skins/import/archive", archive);
    expect(second.status).toBe(200);
    expect(((await (await client.get("/api/skins")).json()) as SkinListBody).skins).toHaveLength(1);
  });

  it("imports an archive whose entries sit under one top-level folder", async () => {
    // The `zip -r my-theme/` shape, which is what zipping a folder produces.
    const archive = makeZip({
      "my-theme/theme.json": Buffer.from(JSON.stringify(MANIFEST), "utf8"),
      "my-theme/background.jpg": IMAGE_BYTES,
    });
    const res = await client.postBytes("/api/skins/import/archive", archive);
    expect(res.status).toBe(200);
    expect(((await res.json()) as ImportBody).skin.id).toBe("sakura");
  });

  it("imports an archive carrying a Codex-Dream-Skin theme.json", async () => {
    // The point of the whole format decision: an archive from that project's community library
    // imports with no converter in between.
    const archive = makeZip({
      "theme.json": Buffer.from(JSON.stringify(DREAM_SKIN_THEME), "utf8"),
      "background.jpg": IMAGE_BYTES,
    });
    const res = await client.postBytes("/api/skins/import/archive", archive);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ImportBody;
    expect(body.skin.id).toBe("preset-gothic-void-crusade");
    expect(body.warnings.some((w) => w.includes("文案"))).toBe(true);
  });

  it("refuses a hostile archive with a 4xx, not a 500", async () => {
    // Each of these is a naming or structure attack the reader refuses. What matters at this
    // layer is that the refusal is a clean bad-request the settings page can show, rather than
    // an unhandled throw that reads as a server fault.
    const hostile: Record<string, Uint8Array> = {
      traversal: makeZip({ "../escape.jpg": IMAGE_BYTES }),
      absolute: makeZip({ "/etc/passwd": IMAGE_BYTES }),
      backslash: makeZip({ "..\\escape.jpg": IMAGE_BYTES }),
      deep: makeZip({ "a/b/c.jpg": IMAGE_BYTES }),
      unicode: makeZip({ "th\u00e8me.json": IMAGE_BYTES }),
    };
    for (const [label, archive] of Object.entries(hostile)) {
      const res = await client.postBytes("/api/skins/import/archive", archive);
      expect(res.status, label).toBe(400);
    }
    // Nothing was published along the way.
    expect(((await (await client.get("/api/skins")).json()) as SkinListBody).skins).toEqual([]);
  });

  it("refuses an empty body and content that is not an archive", async () => {
    expect((await client.postBytes("/api/skins/import/archive", Buffer.alloc(0))).status).toBe(400);
    expect(
      (await client.postBytes("/api/skins/import/archive", Buffer.from("not a zip"))).status,
    ).toBe(400);
  });

  it("refuses an archive that holds no manifest", async () => {
    const archive = makeZip({ "background.jpg": IMAGE_BYTES });
    const res = await client.postBytes("/api/skins/import/archive", archive);
    expect(res.status).toBe(400);
  });

  it("PUT /api/me/prefs stores the theme selection and round-trips it", async () => {
    const res = await client.put("/api/me/prefs", {
      activeTheme: "sakura",
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as PrefsBody).prefs.activeTheme).toBe("sakura");

    const stored = (await (await client.get("/api/me/prefs")).json()) as PrefsBody;
    expect(stored.prefs.activeTheme).toBe("sakura");

    // A null clear is accepted and means "back to the app's own appearance".
    expect((await client.put("/api/me/prefs", { activeTheme: null })).status).toBe(200);
    expect(
      ((await (await client.get("/api/me/prefs")).json()) as PrefsBody).prefs.activeTheme,
    ).toBe(null);

    // A builtin theme the server has never heard of must survive: the server cannot resolve ids
    // (the built-in gallery lives in the web bundle) and must not try.
    expect((await client.put("/api/me/prefs", { activeTheme: "rose-garden" })).status).toBe(200);
    expect(
      ((await (await client.get("/api/me/prefs")).json()) as PrefsBody).prefs.activeTheme,
    ).toBe("rose-garden");
  });
});
