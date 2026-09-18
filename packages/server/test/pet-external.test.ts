/**
 * Tests for the external pet source (the Codex desktop app's bundled pets).
 *
 * No machine running these tests has Codex installed, so the archive is built as
 * a fixture: `buildAsar` writes the real container layout (Chromium pickle header
 * + concatenated content), which is also what pins the reader in `asar.ts`. The
 * reference implementation tests the same way.
 *
 * Covered:
 *   - `codexArchivePaths`   — the per-platform search table.
 *   - `codexPetDefinitions` — extraction from the bundle *as text*, and its refusals.
 *   - `asar.ts`             — header layout, lookup, listing.
 *   - `readCodexPets`       — definitions + sprite resolution out of a fixture.
 *   - the HTTP surface      — list, preview bytes, reviewed import, fingerprint refusal.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PetCatalogService } from "../src/services/pet-catalog.js";
import {
  PetExternalService,
  codexArchivePaths,
  readCodexPets,
} from "../src/services/pet-external.js";
import { codexPetDefinitions } from "../src/services/pet-codex-definitions.js";
import {
  asarHeaderSize,
  findAsarFile,
  listAsarFiles,
  openAsar,
  parseAsarHeader,
} from "../src/services/asar.js";
import { apiClient, createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";

/** Non-empty is enough: the host never decodes the atlas here (see `validatePetSpritesheet`). */
const ATLAS_BYTES = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x01, 0x02, 0x03, 0x04, 0x05]);
const METADATA =
  "[{assetRef:`owl`,description:`Calm owl`,displayName:`Owl`,id:`owl`,spriteVersionNumber:2}]";
const ASSET_MAP = "new URL(`owl-spritesheet-v6.webp`,import.meta.url)";
const SPRITE_NAME = "webview/assets/owl-spritesheet-v6.webp";

/** Build an archive with the real asar container layout. */
function buildAsar(entries: { name: string; bytes: Buffer }[]): Buffer {
  const files: Record<string, unknown> = {};
  const content: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const segments = entry.name.split("/");
    let node = files;
    for (const segment of segments.slice(0, -1)) {
      const existing = node[segment] as { files: Record<string, unknown> } | undefined;
      if (existing === undefined) {
        const created = { files: {} as Record<string, unknown> };
        node[segment] = created;
        node = created.files;
      } else {
        node = existing.files;
      }
    }
    node[segments.at(-1) ?? entry.name] = { size: entry.bytes.length, offset: String(offset) };
    content.push(entry.bytes);
    offset += entry.bytes.length;
  }
  const json = Buffer.from(JSON.stringify({ files }), "utf8");
  const payload = (json.length + 7) & ~3;
  const header = Buffer.alloc(payload + 12);
  header.writeUInt32LE(4, 0);
  header.writeUInt32LE(payload + 4, 4);
  header.writeUInt32LE(payload, 8);
  header.writeUInt32LE(json.length, 12);
  json.copy(header, 16);
  return Buffer.concat([header, ...content]);
}

function fixtureEntries(overrides: { metadata?: string; assetMap?: string; sprite?: string } = {}) {
  return [
    {
      name: "webview/assets/codex-pet-assets-hash.js",
      bytes: Buffer.from(overrides.assetMap ?? ASSET_MAP, "utf8"),
    },
    {
      name: "webview/assets/app-initial-hash.js",
      bytes: Buffer.from(overrides.metadata ?? METADATA, "utf8"),
    },
    { name: overrides.sprite ?? SPRITE_NAME, bytes: ATLAS_BYTES },
  ];
}

describe("codexArchivePaths", () => {
  it("lists the Windows installer locations, most likely first", () => {
    const paths = codexArchivePaths({
      platform: "win32",
      localAppData: "C:\\Users\\me\\AppData\\Local",
      programFiles: "C:\\Program Files",
    });
    expect(paths[0]).toBe("C:/Users/me/AppData/Local/Programs/Codex/resources/app.asar");
    expect(paths).toContain("C:/Program Files/Codex/resources/app.asar");
  });

  it("covers the Store/MSIX layout for each registered package root", () => {
    const paths = codexArchivePaths({
      platform: "win32",
      localAppData: "C:\\Local",
      packageRoots: ["C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.10.1.0_x64__abc"],
    });
    expect(paths).toContain(
      "C:/Program Files/WindowsApps/OpenAI.Codex_26.10.1.0_x64__abc/app/resources/app.asar",
    );
  });

  it("uses the app-bundle layout on macOS and the /opt layout on Linux", () => {
    expect(codexArchivePaths({ platform: "darwin", home: "/Users/me" })).toContain(
      "/Applications/Codex.app/Contents/Resources/app.asar",
    );
    expect(codexArchivePaths({ platform: "darwin", home: "/Users/me" })).toContain(
      "/Users/me/Applications/ChatGPT.app/Contents/Resources/app.asar",
    );
    expect(codexArchivePaths({ platform: "linux", home: "/home/me" })).toContain(
      "/opt/Codex/resources/app.asar",
    );
  });

  it("returns nothing when the platform gives it nothing to work with", () => {
    expect(codexArchivePaths({ platform: "win32" })).toEqual([]);
  });
});

describe("codexPetDefinitions", () => {
  it("reads the flat definitions out of the bundle", () => {
    expect(codexPetDefinitions(METADATA)).toEqual([
      {
        id: "owl",
        displayName: "Owl",
        description: "Calm owl",
        spriteVersionNumber: 2,
        assetRef: "owl",
      },
    ]);
  });

  it("skips a definition whose values are built at runtime rather than written out", () => {
    const script = "[{assetRef:run(),displayName:`Dynamic`,id:`dynamic`,spriteVersionNumber:2}]";
    expect(codexPetDefinitions(script)).toEqual([]);
  });

  it("skips an id that is not a plain slug", () => {
    const script = "[{assetRef:`a`,displayName:`A`,id:`../escape`,spriteVersionNumber:1}]";
    expect(codexPetDefinitions(script)).toEqual([]);
  });

  it("refuses a sprite version this host cannot render", () => {
    expect(() =>
      codexPetDefinitions(METADATA.replace("spriteVersionNumber:2", "spriteVersionNumber:3")),
    ).toThrow(/Unsupported bundled pet sprite version/);
  });

  it("refuses two definitions claiming one id with different content", () => {
    const script = `${METADATA}${METADATA.replace("Owl", "Other")}`;
    expect(() => codexPetDefinitions(script)).toThrow(/Conflicting bundled pet definitions/);
  });

  it("keeps the description null when the bundle omits it", () => {
    const script = "[{assetRef:`a`,displayName:`A`,id:`a`,spriteVersionNumber:1}]";
    expect(codexPetDefinitions(script)[0]?.description).toBeNull();
  });
});

describe("asar reader", () => {
  let dir: string;
  let archivePath: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "linsight-asar-"));
    archivePath = path.join(dir, "app.asar");
    await fs.writeFile(archivePath, buildAsar(fixtureEntries()));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("reads the header size from the archive prefix", async () => {
    const raw = await fs.readFile(archivePath);
    const headerSize = asarHeaderSize(new Uint8Array(raw.subarray(0, 8)));
    // header = 12 bytes of length fields + the NUL-padded JSON.
    expect(headerSize).toBeGreaterThan(12);
    expect(headerSize % 4).toBe(0);
  });

  it("parses the directory tree and lists entries under a prefix", async () => {
    const raw = await fs.readFile(archivePath);
    const headerSize = asarHeaderSize(new Uint8Array(raw.subarray(0, 8)));
    const header = parseAsarHeader(new Uint8Array(raw.subarray(8, 8 + headerSize)));
    const names = listAsarFiles(header, "webview/assets");
    expect(names).toHaveLength(3);
    expect(names).toContain(SPRITE_NAME);
    expect(findAsarFile(header, SPRITE_NAME)?.size).toBe(ATLAS_BYTES.length);
    expect(findAsarFile(header, "webview/assets/missing.js")).toBeNull();
  });

  it("rejects a truncated prefix", () => {
    expect(() => asarHeaderSize(new Uint8Array([1, 2]))).toThrow(/too short/);
  });

  it("reads file bytes back out of the archive", async () => {
    const archive = await openAsar(archivePath);
    try {
      const bytes = await archive.read(SPRITE_NAME, 1024);
      expect(Buffer.from(bytes).equals(ATLAS_BYTES)).toBe(true);
      await expect(archive.read(SPRITE_NAME, 4)).rejects.toThrow(/exceeds 4 bytes/);
      await expect(archive.read("webview/assets/nope.js", 1024)).rejects.toThrow(/missing/);
    } finally {
      await archive.close();
    }
  });
});

describe("readCodexPets", () => {
  let dir: string;
  let archivePath: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "linsight-codex-"));
    archivePath = path.join(dir, "app.asar");
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("resolves the sprite the asset map names", async () => {
    await fs.writeFile(archivePath, buildAsar(fixtureEntries()));
    const { pets, diagnostics } = await readCodexPets(archivePath);
    expect(diagnostics).toEqual([]);
    expect(pets).toHaveLength(1);
    expect(pets[0]?.id).toBe("owl");
    expect(pets[0]?.imageMimeType).toBe("image/webp");
    expect(Buffer.from(pets[0]?.imageBytes ?? []).equals(ATLAS_BYTES)).toBe(true);
    expect(JSON.parse(new TextDecoder().decode(pets[0]?.manifestBytes))).toMatchObject({
      id: "owl",
      spritesheetPath: "spritesheet.webp",
      spriteVersionNumber: 2,
    });
  });

  it("reports a sprite the asset map no longer names instead of guessing", async () => {
    await fs.writeFile(
      archivePath,
      buildAsar(fixtureEntries({ assetMap: "new URL(`other.webp`,import.meta.url)" })),
    );
    const { pets, diagnostics } = await readCodexPets(archivePath);
    expect(pets).toEqual([]);
    expect(diagnostics.join(" ")).toMatch(/Missing or ambiguous built-in pet image: owl/);
  });

  it("reports an archive that is not a Codex bundle", async () => {
    await fs.writeFile(archivePath, buildAsar([{ name: "index.js", bytes: Buffer.from("x") }]));
    const { pets, diagnostics } = await readCodexPets(archivePath);
    expect(pets).toEqual([]);
    expect(diagnostics.join(" ")).toMatch(/Unsupported built-in pet asset map/);
  });
});

describe("external pets api", () => {
  let t: TestApp;
  let client: ReturnType<typeof apiClient>;
  let workDir: string;
  let petRoot: string;

  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), "linsight-pet-ext-"));
    petRoot = path.join(workDir, "data");
    const archivePath = path.join(workDir, "codex", "app.asar");
    await fs.mkdir(path.dirname(archivePath), { recursive: true });
    await fs.writeFile(archivePath, buildAsar(fixtureEntries()));

    // The catalog is overridden too, so the install and the external source agree
    // on one root — otherwise the receipt written by an import would land somewhere
    // the external service never looks.
    const petCatalog = new PetCatalogService(petRoot);
    const petExternal = new PetExternalService(petCatalog, [archivePath]);
    t = await createTestApp({ petCatalog, petExternal });
    const admin = await loginAdmin(t.app);
    client = apiClient(t.app, admin.cookie);
  });
  afterEach(async () => {
    await t.cleanup();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  interface ExternalBody {
    candidates: {
      sourceKey: string;
      fingerprint: string;
      id: string;
      displayName: string;
      previewUrl: string;
      imported: { id: string } | null;
      copyModified: boolean;
      sourceChanged: boolean;
    }[];
    diagnostics: string[];
  }

  it("lists the bundle's pets with a preview URL", async () => {
    const body = (await (await client.get("/api/pets/external")).json()) as ExternalBody;
    expect(body.candidates).toHaveLength(1);
    const candidate = body.candidates[0]!;
    expect(candidate.id).toBe("owl");
    expect(candidate.displayName).toBe("Owl");
    expect(candidate.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(candidate.previewUrl).toBe(`/api/pets/external/${candidate.sourceKey}/spritesheet`);
    expect(candidate.imported).toBeNull();
    expect(candidate.copyModified).toBe(false);
    expect(candidate.sourceChanged).toBe(false);
  });

  it("serves the atlas bytes behind the preview URL", async () => {
    const body = (await (await client.get("/api/pets/external")).json()) as ExternalBody;
    const res = await client.get(body.candidates[0]!.previewUrl);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/webp");
    expect(Buffer.from(await res.arrayBuffer()).equals(ATLAS_BYTES)).toBe(true);
  });

  it("404s a preview for a source it does not offer", async () => {
    expect((await client.get("/api/pets/external/deadbeef/spritesheet")).status).toBe(404);
  });

  it("imports a reviewed candidate and then reports it as imported", async () => {
    const before = (await (await client.get("/api/pets/external")).json()) as ExternalBody;
    const candidate = before.candidates[0]!;
    const res = await client.post("/api/pets/import-external", {
      sourceKey: candidate.sourceKey,
      expectedFingerprint: candidate.fingerprint,
    });
    expect(res.status).toBe(200);
    const installed = (await res.json()) as { pet: { id: string; source: string } };
    expect(installed.pet.id).toBe("owl");

    // It is a normal catalog entry from here on.
    const listed = (await (await client.get("/api/pets")).json()) as { pets: { id: string }[] };
    expect(listed.pets.map((pet) => pet.id)).toContain("owl");

    const after = (await (await client.get("/api/pets/external")).json()) as ExternalBody;
    expect(after.candidates[0]?.imported?.id).toBe("owl");
    expect(after.candidates[0]?.copyModified).toBe(false);
    expect(after.candidates[0]?.sourceChanged).toBe(false);
  });

  it("refuses a fingerprint that no longer matches the source", async () => {
    const before = (await (await client.get("/api/pets/external")).json()) as ExternalBody;
    const res = await client.post("/api/pets/import-external", {
      sourceKey: before.candidates[0]!.sourceKey,
      expectedFingerprint: "0".repeat(64),
    });
    expect(res.status).toBe(400);
    const listed = (await (await client.get("/api/pets")).json()) as { pets: unknown[] };
    expect(listed.pets).toEqual([]);
  });

  it("refuses an unknown source and a malformed body", async () => {
    expect(
      (
        await client.post("/api/pets/import-external", {
          sourceKey: "nope",
          expectedFingerprint: "x",
        })
      ).status,
    ).toBe(400);
    expect((await client.post("/api/pets/import-external", { sourceKey: "nope" })).status).toBe(
      400,
    );
    expect((await client.post("/api/pets/import-external", {})).status).toBe(400);
  });

  it("reports no candidates when the machine has no source app", async () => {
    const petCatalog = new PetCatalogService(petRoot);
    const empty = await createTestApp({
      petCatalog,
      petExternal: new PetExternalService(petCatalog, [path.join(workDir, "nowhere", "app.asar")]),
    });
    try {
      const admin = await loginAdmin(empty.app);
      const body = (await (
        await apiClient(empty.app, admin.cookie).get("/api/pets/external")
      ).json()) as ExternalBody;
      expect(body.candidates).toEqual([]);
      expect(body.diagnostics.join(" ")).toMatch(/No Codex desktop installation/);
    } finally {
      await empty.cleanup();
    }
  });
});
