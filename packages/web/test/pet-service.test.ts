/**
 * Unit tests for the pet catalog client (`pet-service.ts`): the builtin preset
 * gallery, id resolution, spritesheet URL routing, and the merge of
 * `/api/pets` installs over the presets. `fetch` is stubbed so no server runs.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PetPackage } from "@prismshadow/linsight-pets";
import {
  defaultBuiltinPet,
  findBuiltinPet,
  listPets,
  resolvePetById,
  resolvePetSpriteSrc,
} from "../src/features/pet/pet-service";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

function userPet(id: string): PetPackage {
  return {
    id,
    displayName: `User ${id}`,
    description: null,
    source: "user",
    packagePath: `/data/pets/${id}`,
    spritesheetPath: `/data/pets/${id}/sprite.png`,
    spritesheetMimeType: "image/png",
    spriteVersionNumber: 1,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("builtin presets", () => {
  it("defaults to the blue-golden preset", () => {
    expect(defaultBuiltinPet().id).toBe("blue-golden");
  });

  it("resolves a v2 preset with its web-public spritesheet path", () => {
    const girl = findBuiltinPet("openbitfun-girl");
    expect(girl?.spriteVersionNumber).toBe(2);
    expect(girl?.spritesheetMimeType).toBe("image/webp");
    expect(girl?.spritesheetPath).toBe("/pets/openbitfun-girl/spritesheet.webp");
    expect(girl?.source).toBe("preset");
  });

  it("follows the folder override when the folder differs from the id (elaina → elaina-2)", () => {
    expect(findBuiltinPet("elaina")?.spritesheetPath).toBe("/pets/elaina-2/spritesheet.webp");
  });

  it("returns null for an unknown or absent id", () => {
    expect(findBuiltinPet("nope")).toBeNull();
    expect(findBuiltinPet(null)).toBeNull();
    expect(findBuiltinPet(undefined)).toBeNull();
  });
});

describe("resolvePetSpriteSrc", () => {
  it("routes presets to their bundled path and installs to the authenticated endpoint", () => {
    expect(resolvePetSpriteSrc(defaultBuiltinPet())).toBe("/pets/blue-golden/spritesheet.png");
    expect(resolvePetSpriteSrc(userPet("my pet"))).toBe("/api/pets/my%20pet/spritesheet");
  });
});

describe("listPets", () => {
  it("merges installs over presets and tags install previews with the API endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ pets: [userPet("my-pet")], diagnostics: [] })),
    );
    const pets = await listPets();
    // 13 presets + 1 install.
    expect(pets).toHaveLength(14);
    const installed = pets.find((p) => p.id === "my-pet");
    expect(installed?.source).toBe("user");
    expect(installed?.previewSrc).toBe("/api/pets/my-pet/spritesheet");
    expect(pets.filter((p) => p.id === "blue-golden")).toHaveLength(1);
  });

  it("lets a user install shadow a preset of the same id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ pets: [userPet("blue-golden")], diagnostics: [] })),
    );
    const pets = await listPets();
    const blue = pets.filter((p) => p.id === "blue-golden");
    expect(blue).toHaveLength(1);
    expect(blue[0]!.source).toBe("user");
  });

  it("falls back to the presets alone when the catalog request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const pets = await listPets();
    expect(pets).toHaveLength(13);
    expect(pets.every((p) => p.source === "preset")).toBe(true);
  });
});

describe("resolvePetById", () => {
  it("returns a preset without touching the network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(resolvePetById("openbitfun")).resolves.toMatchObject({ id: "openbitfun" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the default preset for an absent id", async () => {
    await expect(resolvePetById(null)).resolves.toMatchObject({ id: "blue-golden" });
  });

  it("resolves an installed pet from the catalog", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ pets: [userPet("my-pet")], diagnostics: [] })),
    );
    await expect(resolvePetById("my-pet")).resolves.toMatchObject({ id: "my-pet", source: "user" });
  });

  it("falls back to the default preset when an unknown id is not installed either", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ pets: [], diagnostics: [] })),
    );
    await expect(resolvePetById("ghost")).resolves.toMatchObject({ id: "blue-golden" });
  });
});
