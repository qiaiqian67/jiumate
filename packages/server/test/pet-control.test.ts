/**
 * `PetControlService` — what the `pet` tool drives on the server.
 *
 * Unit-level: a temp catalog root, an in-memory prefs row and a recorded notify sink, so the
 * cases that matter (whose prefs get written, and that a write does not drop the other
 * writers' fields) are pinned without an HTTP round trip.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_BUILTIN_PET_ID } from "@jiumate/pets";
import { PetCatalogService } from "../src/services/pet-catalog.js";
import { PetControlService } from "../src/services/pet-control.js";
import type { UiPrefsRepo } from "../src/db/repos/ui-prefs.js";

/** In-memory stand-in for the `ui_prefs` row. */
function fakePrefs(initial: Record<string, string> = {}): {
  repo: UiPrefsRepo;
  rows: Map<string, string>;
} {
  const rows = new Map<string, string>(Object.entries(initial));
  const repo = {
    get: (userId: string) => rows.get(userId) ?? null,
    set: (userId: string, json: string) => {
      rows.set(userId, json);
    },
  } as unknown as UiPrefsRepo;
  return { repo, rows };
}

/** Write one installed pet straight into the catalog layout. */
async function installPet(root: string, id: string, displayName: string): Promise<void> {
  const dir = path.join(root, "pets", id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "pet.json"),
    JSON.stringify({
      id,
      displayName,
      spritesheetPath: "sprite.png",
      spritesheetMimeType: "image/png",
      spriteVersionNumber: 1,
    }),
    "utf8",
  );
  await fs.writeFile(path.join(dir, "sprite.png"), Buffer.from([1, 2, 3]));
}

describe("PetControlService", () => {
  let root: string;
  let prefs: ReturnType<typeof fakePrefs>;
  let notified: string[];
  let service: PetControlService;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "jiumate-pet-control-"));
    prefs = fakePrefs();
    notified = [];
    service = new PetControlService({
      catalog: new PetCatalogService(root),
      prefs: prefs.repo,
      ownerUserId: () => "admin",
      notify: (userId) => notified.push(userId),
    });
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("lists the bundled presets and defaults the selection to the first one", async () => {
    const snapshot = await service.list();
    expect(snapshot.enabled).toBe(true);
    expect(snapshot.activePetId).toBe(DEFAULT_BUILTIN_PET_ID);
    expect(snapshot.pets.length).toBeGreaterThan(10);
    expect(snapshot.pets[0]).toEqual({
      id: DEFAULT_BUILTIN_PET_ID,
      displayName: "困困",
      source: "preset",
    });
  });

  it("offers an installed pack and lets it shadow a preset of the same id", async () => {
    await installPet(root, "blue-golden", "My Own Cat");
    const snapshot = await service.list();
    const blue = snapshot.pets.filter((pet) => pet.id === "blue-golden");
    expect(blue).toHaveLength(1);
    expect(blue[0]).toEqual({ id: "blue-golden", displayName: "My Own Cat", source: "user" });
  });

  it("switches the active pet, notifies the owner, and keeps every other pref field", async () => {
    prefs.rows.set("admin", JSON.stringify({ theme: "dark", enablePet: false }));
    const snapshot = await service.setActivePet("usagi");
    expect(snapshot.activePetId).toBe("usagi");
    expect(notified).toEqual(["admin"]);
    // `ui_prefs` has several independent writers, so the patch must not replace the row.
    expect(JSON.parse(prefs.rows.get("admin")!)).toEqual({
      theme: "dark",
      enablePet: false,
      activePetId: "usagi",
    });
  });

  it("shows and hides the window", async () => {
    expect((await service.setEnabled(false)).enabled).toBe(false);
    expect(JSON.parse(prefs.rows.get("admin")!).enablePet).toBe(false);
    expect((await service.setEnabled(true)).enabled).toBe(true);
    expect(notified).toEqual(["admin", "admin"]);
  });

  it("refuses an id that is neither a preset nor installed, and writes nothing", async () => {
    await expect(service.setActivePet("no-such-pet")).rejects.toThrow(/No pet with id/);
    expect(prefs.rows.has("admin")).toBe(false);
    expect(notified).toEqual([]);
  });

  it("reads corrupted prefs as empty rather than throwing", async () => {
    prefs.rows.set("admin", "{not json");
    const snapshot = await service.list();
    expect(snapshot.activePetId).toBe(DEFAULT_BUILTIN_PET_ID);
    expect(snapshot.enabled).toBe(true);
  });

  it("reports the stored selection even when it is not one of the pets", async () => {
    prefs.rows.set("admin", JSON.stringify({ activePetId: "deleted-pet" }));
    expect((await service.list()).activePetId).toBe("deleted-pet");
  });

  it("refuses to write when the host has no local account to hold the preference", async () => {
    const ownerless = new PetControlService({
      catalog: new PetCatalogService(root),
      prefs: prefs.repo,
      ownerUserId: () => null,
      notify: () => undefined,
    });
    await expect(ownerless.setEnabled(false)).rejects.toThrow(/no local account/);
    expect((await ownerless.list()).pets.length).toBeGreaterThan(10);
  });
});
