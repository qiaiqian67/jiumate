/**
 * Integration tests for the Petdex pet surface:
 *   - GET    /api/pets                    (empty catalog, then a listed install)
 *   - POST   /api/pets/import             (folder install, idempotent re-import, bad input)
 *   - GET    /api/pets/:slug/spritesheet  (serves the installed atlas bytes)
 *   - DELETE /api/pets/:slug              (removes the install; spritesheet then 404s)
 *   - PUT    /api/me/prefs                (enablePet / activePetId / petWindowPosition /
 *                                          petWindowScale, legacy companion* keys stripped,
 *                                          bounds enforced)
 *
 * The manifest/image validation itself lives in `@jiumate/pets` and is
 * covered by its own unit suite; these tests pin the HTTP + prefs contract on top.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apiClient, createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";

/** A minimal but valid v1 manifest. `spritesheetPath` is package-relative POSIX. */
const MANIFEST = {
  id: "my-pet",
  displayName: "My Pet",
  description: "A test pet",
  spritesheetPath: "sheet.png",
  spritesheetMimeType: "image/png",
  spriteVersionNumber: 1,
};

/** The atlas bytes only need to be non-empty: the host never decodes them here. */
const ATLAS_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

async function makePetSource(
  root: string,
  manifest: Record<string, unknown> = MANIFEST,
): Promise<string> {
  const dir = path.join(root, "source-pet");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "pet.json"), JSON.stringify(manifest, null, 2), "utf8");
  await fs.writeFile(path.join(dir, "sheet.png"), ATLAS_BYTES);
  return dir;
}

interface PetListBody {
  pets: { id: string; displayName: string; source: string; spriteVersionNumber: number }[];
  diagnostics: string[];
}
interface PrefsBody {
  prefs: Record<string, unknown>;
}

describe("pets api", () => {
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

  it("GET /api/pets is empty (no diagnostics) on a fresh data root", async () => {
    const res = await client.get("/api/pets");
    expect(res.status).toBe(200);
    expect((await res.json()) as PetListBody).toEqual({ pets: [], diagnostics: [] });
  });

  it("imports a folder, lists it, serves its atlas, then deletes it", async () => {
    const source = await makePetSource(t.root);

    const imported = await client.post("/api/pets/import", { path: source });
    expect(imported.status).toBe(200);
    const { pet } = (await imported.json()) as { pet: { id: string } };
    expect(pet.id).toBe("my-pet");

    const list = (await (await client.get("/api/pets")).json()) as PetListBody;
    expect(list.pets.map((p) => p.id)).toEqual(["my-pet"]);
    expect(list.pets[0]!.source).toBe("user");
    expect(list.pets[0]!.displayName).toBe("My Pet");
    expect(list.pets[0]!.spriteVersionNumber).toBe(1);

    const sheet = await client.get("/api/pets/my-pet/spritesheet");
    expect(sheet.status).toBe(200);
    expect(sheet.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await sheet.arrayBuffer()).equals(ATLAS_BYTES)).toBe(true);

    const removed = await client.delete("/api/pets/my-pet");
    expect(removed.status).toBe(204);
    expect((await client.get("/api/pets/my-pet/spritesheet")).status).toBe(404);
    expect(((await (await client.get("/api/pets")).json()) as PetListBody).pets).toEqual([]);
  });

  it("re-importing the same source is idempotent (one install, same id)", async () => {
    const source = await makePetSource(t.root);
    const first = await client.post("/api/pets/import", { path: source });
    const second = await client.post("/api/pets/import", { path: source });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(((await first.json()) as { pet: { id: string } }).pet.id).toBe(
      ((await second.json()) as { pet: { id: string } }).pet.id,
    );
    expect(((await (await client.get("/api/pets")).json()) as PetListBody).pets).toHaveLength(1);
  });

  it("accepts an explicit null fingerprint as 'nothing to verify against'", async () => {
    // The web picker sends `expectedFingerprint: null` for a folder the user chose
    // directly; rejecting it as a bad type made every import from Settings fail with 400.
    const source = await makePetSource(t.root);
    const res = await client.post("/api/pets/import", { path: source, expectedFingerprint: null });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { pet: { id: string } }).pet.id).toBe("my-pet");
  });

  it("rejects a bad import body and a source without pet.json", async () => {
    expect((await client.post("/api/pets/import", {})).status).toBe(400);
    expect((await client.post("/api/pets/import", { path: "" })).status).toBe(400);
    expect((await client.post("/api/pets/import", { path: 42 })).status).toBe(400);
    expect(
      (await client.post("/api/pets/import", { path: t.root, expectedFingerprint: 7 })).status,
    ).toBe(400);

    // A directory that exists but holds no manifest → 400 (not a 500).
    const empty = path.join(t.root, "not-a-pet");
    await fs.mkdir(empty, { recursive: true });
    expect((await client.post("/api/pets/import", { path: empty })).status).toBe(400);
  });

  it("serves 404 for an unknown pet and for a missing atlas file", async () => {
    expect((await client.get("/api/pets/nope/spritesheet")).status).toBe(404);

    // A pet whose manifest exists but whose atlas was removed out from under it.
    const source = await makePetSource(t.root);
    expect((await client.post("/api/pets/import", { path: source })).status).toBe(200);
    await fs.rm(path.join(t.root, "pets", "my-pet", "sprite.png"), { force: true });
    expect((await client.get("/api/pets/my-pet/spritesheet")).status).toBe(404);
  });

  it("PUT /api/me/prefs stores pet prefs, keeps a preset id, and strips legacy companion keys", async () => {
    const res = await client.put("/api/me/prefs", {
      enablePet: false,
      // "usagi" is a builtin preset the server has never heard of — it must survive
      // (a previous bug nulled any id the on-disk catalog did not know).
      activePetId: "usagi",
      petWindowPosition: { x: 12, y: 34 },
      petWindowScale: 1.5,
      companionName: "legacy",
      companionPlacement: "floating",
    });
    expect(res.status).toBe(200);
    const { prefs } = (await res.json()) as PrefsBody;
    expect(prefs.enablePet).toBe(false);
    expect(prefs.activePetId).toBe("usagi");
    expect(prefs.petWindowPosition).toEqual({ x: 12, y: 34 });
    expect(prefs.petWindowScale).toBe(1.5);
    expect(prefs.companionName).toBeUndefined();
    expect(prefs.companionPlacement).toBeUndefined();

    // PATCH semantics: the stored row round-trips through GET.
    const stored = (await (await client.get("/api/me/prefs")).json()) as PrefsBody;
    expect(stored.prefs.activePetId).toBe("usagi");
    expect(stored.prefs.enablePet).toBe(false);

    // A null clear is accepted.
    expect((await client.put("/api/me/prefs", { activePetId: null })).status).toBe(200);
    expect(
      ((await (await client.get("/api/me/prefs")).json()) as PrefsBody).prefs.activePetId,
    ).toBeNull();
  });

  it("PUT /api/me/prefs rejects malformed pet prefs with 400", async () => {
    const bad: Record<string, unknown>[] = [
      { enablePet: "yes" },
      { activePetId: "" },
      { activePetId: 5 },
      { activePetId: "x".repeat(65) },
      { petWindowPosition: "bottom-right" },
      { petWindowPosition: { x: "a", y: 1 } },
      { petWindowPosition: { x: 1 } },
      { petWindowPosition: { x: 40000, y: 0 } },
      { petWindowPosition: { x: Number.NaN, y: 0 } },
      { petWindowScale: "big" },
      { petWindowScale: 0.1 },
      { petWindowScale: 9 },
    ];
    for (const body of bad) {
      expect((await client.put("/api/me/prefs", body)).status).toBe(400);
    }
    // Nothing from a rejected write was stored.
    expect((await (await client.get("/api/me/prefs")).json()) as PrefsBody).toEqual({ prefs: {} });
  });
});
