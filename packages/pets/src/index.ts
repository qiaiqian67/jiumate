/**
 * `@prismshadow/jiumate-pets` — Petdex pet package IO.
 *
 * Mirrors OpenBitFun's `petdex-desktop-native/src/pet_packages.rs`. Hosts
 * provide a root path; every read/write is anchored to that root, with
 * strict bounds (manifest, image, archive, package count) and fingerprinting
 * for safe re-imports.
 */
export type { PetPackage, PetReceipt, SpriteVersionNumber } from "./schema.js";
export { SPRITE_VERSION_NUMBERS, buildPetPackage } from "./schema.js";

// IO
export {
  PetPackageError,
  FRAME_WIDTH,
  FRAME_HEIGHT,
  SPRITE_COLUMNS,
  SPRITE_ROWS_BY_VERSION,
  MANIFEST_LIMIT,
  IMAGE_LIMIT,
  ARCHIVE_LIMIT,
  MAX_PACKAGES,
  MAX_PIXEL_AREA,
  petsDir,
  petDir,
  petManifestPath,
  petReceiptPath,
  petSpritesheetPath,
  slugifyPetId,
  readPetPackage,
  readPetCatalog,
  writePetPackage,
  fingerprintPetPackage,
  readPetReceipt,
  writePetReceipt,
  deletePetPackage,
  coercePetPackage,
  validatePetSpritesheet,
} from "./io.js";

// Constants
export { RECEIPT_FILENAME, RECEIPT_SCHEMA_VERSION } from "./constants.js";

// The built-in gallery. Shared because the picker renders it and the server has to be able
// to name the pets a user can switch to (the `pet` tool).
export type { BuiltinPetPreset } from "./presets.js";
export { BUILTIN_PETS, DEFAULT_BUILTIN_PET_ID, findBuiltinPetPreset } from "./presets.js";
