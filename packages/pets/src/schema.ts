/**
 * Schema for a Petdex pet package.
 *
 * Mirrors OpenBitFun's `PetPackage` (petdex-desktop-native/src/pet_packages.rs):
 *   id              — slug; filesystem-friendly.
 *   displayName     — human label.
 *   description     — optional blurb.
 *   source          — "preset" (shipped with the host) or "user" (installed).
 *   packagePath     — absolute on-disk path to the pet directory.
 *   spritesheetPath — absolute path to the spritesheet image.
 *   spritesheetMimeType — detected image MIME.
 *   spriteVersionNumber — 1 (8x9 atlas) or 2 (8x11 atlas with look rows).
 *
 * The shape is described as a plain TypeScript interface; runtime
 * validation happens in `io.ts`'s `coercePetPackage`. Arktype is reserved
 * for future expansion; it was originally part of the contract but the
 * v2 release line at the time of authoring needed a lighter-touch surface
 * so the IO module is not coupled to arktype's narrow API.
 */
export const SPRITE_VERSION_NUMBERS = [1, 2] as const;
export type SpriteVersionNumber = (typeof SPRITE_VERSION_NUMBERS)[number];

export interface PetPackage {
  id: string;
  displayName: string;
  description: string | null;
  source: string;
  packagePath: string;
  spritesheetPath: string;
  spritesheetMimeType: string;
  spriteVersionNumber: SpriteVersionNumber;
}

/**
 * Receipt written next to `pet.json` when a pet was imported from an upstream
 * source (Petdex catalog URL, CLI install, manual folder import, …). Lets a
 * subsequent install detect "same source, same content" without comparing the
 * manifest by hand.
 */
export interface PetReceipt {
  schemaVersion: number;
  sourceKey: string;
  fingerprint: string;
  installedFingerprint: string;
}

/**
 * Manual `metadata()` helper — turns a parsed manifest + filesystem paths +
 * detected MIME + version into the canonical PetPackage. Mirrors the Rust
 * side's id sanitisation so a download with junk ids round-trips identically.
 */
export interface BuildPetPackageInput {
  manifestId?: string | null;
  displayName?: string | null;
  description?: string | null;
  source: string;
  packagePath: string;
  spritesheetRelativePath: string;
  spritesheetAbsolutePath: string;
  spritesheetMimeType: string;
  spriteVersionNumber: SpriteVersionNumber;
}

import { slugifyPetId } from "./paths.js";

export function buildPetPackage(input: BuildPetPackageInput): PetPackage {
  const id = slugifyPetId(input.manifestId ?? null);
  const fallbackDisplay = input.manifestId ?? id;
  const displayName =
    input.displayName !== null && input.displayName !== undefined && input.displayName.trim() !== ""
      ? input.displayName.trim()
      : fallbackDisplay;
  const description =
    input.description !== null && input.description !== undefined && input.description.trim() !== ""
      ? input.description.trim().slice(0, 4096)
      : null;
  return {
    id,
    displayName,
    description,
    source: input.source,
    packagePath: input.packagePath,
    spritesheetPath: input.spritesheetAbsolutePath,
    spritesheetMimeType: input.spritesheetMimeType,
    spriteVersionNumber: input.spriteVersionNumber,
  };
}
