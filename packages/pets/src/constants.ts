/**
 * Bounds, schema version, and conventional filenames for Petdex pet packages.
 *
 * Mirrors OpenBitFun's `pet_packages.rs` byte-for-byte so the same Petdex
 * downloads (folder or .zip) round-trip between the two hosts. Any change
 * here is a wire-format break; bump `RECEIPT_SCHEMA_VERSION` accordingly.
 */

/** Sprite atlas columns. */
export const SPRITE_COLUMNS = 8;

/** Sprite atlas rows by version. v1 is 9 rows; v2 is 11 rows (rows 9-10 hold 16 look-direction frames). */
export const SPRITE_ROWS_BY_VERSION: Record<1 | 2, number> = {
  1: 9,
  2: 11,
};

/** Frame dimensions for v1 atlases (192x208). v2 reuses the same frame size. */
export const FRAME_WIDTH = 192;
export const FRAME_HEIGHT = 208;

/** Atlas-side guard: a single pet spritesheet must not exceed this many bytes (32 MiB). */
export const IMAGE_LIMIT = 32 * 1024 * 1024;

/** Manifest-side guard: a single pet.json must not exceed this many bytes (64 KiB). */
export const MANIFEST_LIMIT = 64 * 1024;

/** Install-archive guard: a single .zip must not exceed this many bytes (64 MiB). */
export const ARCHIVE_LIMIT = 64 * 1024 * 1024;

/** Hard cap on the number of pets under one catalog (128). */
export const MAX_PACKAGES = 128;

/** Atlas pixel-area ceiling (16 MP). Matches `pet_packages.rs` so a malformed atlas cannot exhaust memory. */
export const MAX_PIXEL_AREA = 16_000_000;

/** Conventional receipt filename written next to `pet.json` after a successful install. */
export const RECEIPT_FILENAME = ".linsight-pet-receipt.json";

/** Schema version written into the receipt. Bump when the on-disk shape changes incompatibly. */
export const RECEIPT_SCHEMA_VERSION = 1;
