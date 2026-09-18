import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ARCHIVE_LIMIT,
  IMAGE_LIMIT,
  MANIFEST_LIMIT,
  MAX_PACKAGES,
  PetPackageError,
  coercePetPackage,
  deletePetPackage,
  fingerprintPetPackage,
  readPetCatalog,
  readPetPackage,
  readPetReceipt,
  slugifyPetId,
  validatePetSpritesheet,
  writePetPackage,
  writePetReceipt,
} from "../src/index.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "linsight-pets-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function makePet(slug: string, manifest: object): Promise<void> {
  const dir = join(root, "pets", slug);
  const { mkdir } = await import("node:fs/promises");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "pet.json"), JSON.stringify(manifest), "utf8");
}

describe("PET_SLUG_REGEX / slugifyPetId", () => {
  it("normalises mixed-case and punctuation", () => {
    expect(slugifyPetId("Blue-Golden Cat!")).toBe("blue-golden-cat");
    expect(slugifyPetId("   ")).toBe("custom-pet");
    expect(slugifyPetId("panda_pix/2")).toBe("panda_pix-2");
  });
});

describe("coercePetPackage", () => {
  it("accepts a v1 manifest", () => {
    const pet = coercePetPackage(
      { id: "blue-golden", displayName: "Blue Golden", spritesheetPath: "sprite.png" },
      { packagePath: "/data/pets/blue-golden" },
    );
    expect(pet.id).toBe("blue-golden");
    expect(pet.displayName).toBe("Blue Golden");
    expect(pet.spriteVersionNumber).toBe(1);
    expect(pet.spritesheetPath).toBe("/data/pets/blue-golden/sprite.png");
  });

  it("accepts a v2 manifest", () => {
    const pet = coercePetPackage(
      {
        id: "panda-pix",
        displayName: "Panda",
        spritesheetPath: "sprite.webp",
        spriteVersionNumber: 2,
      },
      { packagePath: "/data/pets/panda-pix" },
    );
    expect(pet.spriteVersionNumber).toBe(2);
  });

  it("rejects unknown versions", () => {
    expect(() =>
      coercePetPackage(
        { spritesheetPath: "x.png", spriteVersionNumber: 3 },
        { packagePath: "/data/pets/bad" },
      ),
    ).toThrow(PetPackageError);
  });

  it("rejects escaping paths", () => {
    expect(() =>
      coercePetPackage({ spritesheetPath: "../escape.png" }, { packagePath: "/data/pets/bad" }),
    ).toThrow(/escapes/);
    expect(() =>
      coercePetPackage({ spritesheetPath: "/absolute.png" }, { packagePath: "/data/pets/bad" }),
    ).toThrow(/relative POSIX/);
  });

  it("rejects a traversal in the middle of the path, not just at the front", () => {
    // The prefix/suffix checks alone let these through and `join` then resolved them out
    // of the package directory, so an imported manifest could name any file on the host.
    for (const spritesheetPath of [
      "a/../../../etc/passwd",
      "foo/../../secret.png",
      "nested/../../out.png",
      "a/./b.png",
      "a//b.png",
      "..",
    ]) {
      expect(() =>
        coercePetPackage({ spritesheetPath }, { packagePath: "/data/pets/bad" }),
      ).toThrow(PetPackageError);
    }
  });

  it("accepts a plain nested relative path", () => {
    const pet = coercePetPackage(
      { spritesheetPath: "art/sprite.png" },
      { packagePath: "/data/pets/bad" },
    );
    expect(pet.spritesheetPath).toBe("/data/pets/bad/art/sprite.png");
  });
});

describe("readPetPackage / readPetCatalog", () => {
  it("returns null for an absent pet", async () => {
    expect(await readPetPackage(root, "missing")).toBeNull();
  });

  it("reads a valid pet from disk", async () => {
    await makePet("alpha", {
      id: "alpha",
      displayName: "Alpha",
      spritesheetPath: "sprite.png",
      spriteVersionNumber: 2,
    });
    const pet = await readPetPackage(root, "alpha");
    expect(pet).not.toBeNull();
    expect(pet?.displayName).toBe("Alpha");
    expect(pet?.spriteVersionNumber).toBe(2);
  });

  it("returns the catalog sorted by id", async () => {
    await makePet("zeta", { id: "zeta", displayName: "Zeta", spritesheetPath: "x.png" });
    await makePet("alpha", { id: "alpha", displayName: "Alpha", spritesheetPath: "x.png" });
    await makePet("mid", { id: "mid", displayName: "Mid", spritesheetPath: "x.png" });
    const catalog = await readPetCatalog(root);
    expect(catalog.map((p) => p.id)).toEqual(["alpha", "mid", "zeta"]);
  });

  it("skips pets whose manifest is invalid and keeps the rest", async () => {
    await makePet("good", { id: "good", displayName: "G", spritesheetPath: "x.png" });
    const badDir = join(root, "pets", "bad");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(badDir, { recursive: true });
    await writeFile(join(badDir, "pet.json"), "{ this is not json", "utf8");
    const catalog = await readPetCatalog(root);
    expect(catalog.map((p) => p.id)).toEqual(["good"]);
  });

  it("still returns the catalog when the pets root holds stray files", async () => {
    // Counting every entry against MAX_PACKAGES made a few loose files (an editor
    // dotfile, a downloaded .zip) read as "too many pets" — which the service turned into
    // an empty list, hiding every installed pet from the picker.
    await makePet("alpha", { id: "alpha", displayName: "A", spritesheetPath: "x.png" });
    for (let i = 0; i < MAX_PACKAGES + 4; i += 1) {
      await writeFile(join(root, "pets", `stray-${i}.png`), "not a pet", "utf8");
    }
    const catalog = await readPetCatalog(root);
    expect(catalog.map((p) => p.id)).toEqual(["alpha"]);
  });

  it("caps the catalog at MAX_PACKAGES directories instead of throwing", async () => {
    // Exceeding the cap must not throw: callers catch and read the throw as an empty
    // catalog, which is both a lost picker and a defeated import guard.
    const over = MAX_PACKAGES + 3;
    for (let i = 0; i < over; i += 1) {
      const slug = `pet-${String(i).padStart(3, "0")}`;
      await makePet(slug, { id: slug, displayName: slug, spritesheetPath: "x.png" });
    }
    const catalog = await readPetCatalog(root);
    expect(catalog).toHaveLength(MAX_PACKAGES);
  });
});

describe("writePetPackage", () => {
  it("writes a manifest under pets/<id>/pet.json", async () => {
    await writePetPackage(root, {
      id: "alpha",
      displayName: "Alpha",
      description: "First",
      source: "preset",
      packagePath: join(root, "pets", "alpha"),
      spritesheetPath: join(root, "pets", "alpha", "sprite.png"),
      spritesheetMimeType: "image/png",
      spriteVersionNumber: 1,
    });
    const onDisk = await readPetPackage(root, "alpha");
    expect(onDisk).not.toBeNull();
    expect(onDisk?.displayName).toBe("Alpha");
    expect(onDisk?.spriteVersionNumber).toBe(1);
  });
});

describe("deletePetPackage", () => {
  it("removes the directory and contents", async () => {
    await makePet("alpha", { id: "alpha", displayName: "A", spritesheetPath: "x.png" });
    await deletePetPackage(root, "alpha");
    expect(await readPetPackage(root, "alpha")).toBeNull();
  });
});

describe("fingerprintPetPackage", () => {
  it("is stable across runs for equal manifests", () => {
    const a = {
      id: "alpha",
      displayName: "Alpha",
      description: null,
      source: "preset",
      packagePath: "/data/pets/alpha",
      spritesheetPath: "/data/pets/alpha/x.png",
      spritesheetMimeType: "image/png",
      spriteVersionNumber: 1 as const,
    };
    expect(fingerprintPetPackage(a)).toBe(fingerprintPetPackage(a));
  });
});

describe("readPetReceipt / writePetReceipt", () => {
  it("round-trips a receipt", async () => {
    await writePetReceipt(root, "alpha", {
      schemaVersion: 1,
      sourceKey: "preset:blue-golden",
      fingerprint: "abc",
      installedFingerprint: "def",
    });
    const r = await readPetReceipt(root, "alpha");
    expect(r).toEqual({
      schemaVersion: 1,
      sourceKey: "preset:blue-golden",
      fingerprint: "abc",
      installedFingerprint: "def",
    });
  });

  it("rejects unknown schema version on write", async () => {
    await expect(
      writePetReceipt(root, "alpha", {
        schemaVersion: 99,
        sourceKey: "x",
        fingerprint: "y",
        installedFingerprint: "z",
      }),
    ).rejects.toThrow(PetPackageError);
  });
});

describe("validatePetSpritesheet", () => {
  it("returns nominal dimensions for v1 and v2", () => {
    expect(validatePetSpritesheet(new Uint8Array(1024), 1)).toEqual({
      width: 8 * 192,
      height: 9 * 208,
    });
    expect(validatePetSpritesheet(new Uint8Array(1024), 2)).toEqual({
      width: 8 * 192,
      height: 11 * 208,
    });
  });

  it("throws on a spritesheet bigger than the image limit", () => {
    const huge = new Uint8Array(IMAGE_LIMIT + 1);
    expect(() => validatePetSpritesheet(huge, 1)).toThrow(PetPackageError);
  });
});

describe("constants", () => {
  it("matches the OpenBitFun contract", () => {
    expect(MANIFEST_LIMIT).toBe(64 * 1024);
    expect(IMAGE_LIMIT).toBe(32 * 1024 * 1024);
    expect(ARCHIVE_LIMIT).toBe(64 * 1024 * 1024);
    expect(MAX_PACKAGES).toBe(128);
  });
});
