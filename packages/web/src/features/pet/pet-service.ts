/**
 * Pet catalog client — talks to `GET/POST/DELETE /api/pets` and merges the builtin presets
 * from the web bundle (`/pets/<slug>/...`). Mirrors OpenBitFun's
 * `AgentCompanionPetService`: preset list + import + delete, with public spritesheet URLs
 * for presets and `/api/pets/:id/spritesheet` for user-installed packs.
 *
 * The preset table itself lives in `@prismshadow/linsight-pets` rather than here, because
 * the server needs the same ids: the `pet` tool has to be able to name the pets a user can
 * switch to, and presets are invisible to the server's on-disk catalog. Only the
 * web-bundle URL shape (`/pets/<folder>/spritesheet.<ext>`) is built here.
 */
import { apiFetch } from "../../api/client";
import {
  BUILTIN_PETS,
  DEFAULT_BUILTIN_PET_ID,
  findBuiltinPetPreset,
} from "@prismshadow/linsight-pets/presets";
import type { PetPackage, SpriteVersionNumber } from "@prismshadow/linsight-pets";

export interface PetPackageWithPreview extends PetPackage {
  previewSrc: string;
}

export interface ListPetsResponse {
  pets: PetPackage[];
  diagnostics: string[];
}

const BUILTIN_PET_BASE = "/pets";

function spritesheetFilename(mime: string): string {
  return mime === "image/png" ? "spritesheet.png" : "spritesheet.webp";
}

function builtinPresets(): PetPackageWithPreview[] {
  return BUILTIN_PETS.map((preset) => {
    const folder = preset.folder ?? preset.id;
    const spritesheetPath = `${BUILTIN_PET_BASE}/${folder}/${spritesheetFilename(preset.spritesheetMimeType)}`;
    return {
      id: preset.id,
      displayName: preset.displayName,
      description: preset.description,
      source: "preset",
      packagePath: `${BUILTIN_PET_BASE}/${folder}`,
      spritesheetPath,
      spritesheetMimeType: preset.spritesheetMimeType,
      spriteVersionNumber: preset.spriteVersionNumber ?? 1,
      previewSrc: spritesheetPath,
    };
  });
}

/** Resolve a builtin or installed pet by id (null when unknown). */
export function findBuiltinPet(id: string | null | undefined): PetPackageWithPreview | null {
  const preset = findBuiltinPetPreset(id);
  if (preset === null) return null;
  return builtinPresets().find((pet) => pet.id === preset.id) ?? null;
}

export function defaultBuiltinPet(): PetPackageWithPreview {
  return builtinPresets().find((pet) => pet.id === DEFAULT_BUILTIN_PET_ID) ?? builtinPresets()[0]!;
}

export async function listPets(): Promise<PetPackageWithPreview[]> {
  let installed: PetPackage[] = [];
  try {
    const response = await apiFetch<ListPetsResponse>("/api/pets");
    installed = response.pets;
  } catch {
    installed = [];
  }
  const installedWithPreview: PetPackageWithPreview[] = installed.map((pet) => ({
    ...pet,
    previewSrc: `/api/pets/${encodeURIComponent(pet.id)}/spritesheet`,
  }));
  // User-installed pets override a builtin with the same id.
  const installedIds = new Set(installedWithPreview.map((pet) => pet.id));
  const presets = builtinPresets().filter((pet) => !installedIds.has(pet.id));
  return [...presets, ...installedWithPreview];
}

export async function resolvePetById(id: string | null | undefined): Promise<PetPackage | null> {
  if (!id) return defaultBuiltinPet();
  const builtin = findBuiltinPet(id);
  if (builtin) return builtin;
  const all = await listPets();
  return all.find((pet) => pet.id === id) ?? defaultBuiltinPet();
}

export async function importPetPackage(
  path: string,
  expectedFingerprint?: string,
): Promise<PetPackageWithPreview> {
  const pet = await apiFetch<{ pet: PetPackage }>("/api/pets/import", {
    method: "POST",
    // Omit the key entirely when there is nothing to verify against. Sending an explicit
    // `null` made every folder import fail with 400 (`expectedFingerprint must be a
    // string`) — the picker has no fingerprint to review for a path the user just chose.
    body: {
      path,
      ...(expectedFingerprint === undefined ? {} : { expectedFingerprint }),
    },
  });
  return {
    ...pet.pet,
    previewSrc: `/api/pets/${encodeURIComponent(pet.pet.id)}/spritesheet`,
  };
}

export async function deletePetPackage(slug: string): Promise<void> {
  await apiFetch<void>(`/api/pets/${encodeURIComponent(slug)}`, { method: "DELETE" });
}

/**
 * A pet the Codex desktop app ships in its own bundle, offered for import.
 *
 * `fingerprint` is the identity the import is verified against: the server reads the
 * archive again on import and refuses when it no longer hashes to this, so a package cannot
 * be swapped between the review and the write.
 */
export interface PetExternalCandidate {
  sourceKey: string;
  fingerprint: string;
  id: string;
  displayName: string;
  description: string | null;
  spriteVersionNumber: SpriteVersionNumber;
  /** Same-origin URL serving the atlas out of the source archive. */
  previewUrl: string;
  /** The installed copy imported from this same source, if any. */
  imported: PetPackage | null;
  copyModified: boolean;
  sourceChanged: boolean;
}

export interface PetExternalCatalog {
  candidates: PetExternalCandidate[];
  diagnostics: string[];
}

/** Pets bundled in another agent app's install (see `pet-external.ts` on the server). */
export async function listExternalPets(): Promise<PetExternalCatalog> {
  return apiFetch<PetExternalCatalog>("/api/pets/external");
}

export async function importExternalPet(
  sourceKey: string,
  expectedFingerprint: string,
): Promise<PetPackageWithPreview> {
  const pet = await apiFetch<{ pet: PetPackage }>("/api/pets/import-external", {
    method: "POST",
    body: { sourceKey, expectedFingerprint },
  });
  return {
    ...pet.pet,
    previewSrc: `/api/pets/${encodeURIComponent(pet.pet.id)}/spritesheet`,
  };
}

/** True when the id is one of the presets that ship in the web bundle. */
export function isBuiltinPetId(id: string): boolean {
  return findBuiltinPetPreset(id) !== null;
}

/**
 * Resolve the spritesheet URL for a pet:
 *   - "preset" → web-public relative path
 *   - "user"   → authenticated spritesheet endpoint
 */
export function resolvePetSpriteSrc(pet: PetPackage): string {
  if (pet.source === "preset") return pet.spritesheetPath;
  return `/api/pets/${encodeURIComponent(pet.id)}/spritesheet`;
}
