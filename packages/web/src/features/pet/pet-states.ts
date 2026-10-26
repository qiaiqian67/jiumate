/**
 * Petdex sprite atlas — the canonical row table.
 *
 * Mirrors `petdex/src/lib/pet-states.ts`. v1 atlases have 9 rows; v2 adds
 * rows 9-10 holding 16 look-direction frames (8 columns x 2 rows).
 */
import type { SpriteVersionNumber } from "@jiumate/pets";

export interface SpriteAnimation {
  /** Number of frames in this row. */
  frames: number;
  /** Frame-to-frame delay in ms (per-frame; total row length = frames × durationMs). */
  durationMs: number;
}

/**
 * The nine animation rows the host always sees, in v1 atlas order. v2 adds
 * the two look-direction rows after these nine.
 */
export const SPRITE_ANIMATIONS: readonly SpriteAnimation[] = [
  { frames: 6, durationMs: 1100 }, // 0: idle
  { frames: 8, durationMs: 90 }, //   1: running-right
  { frames: 8, durationMs: 90 }, //   2: running-left
  { frames: 4, durationMs: 220 }, //  3: waving
  { frames: 5, durationMs: 180 }, //  4: jumping
  { frames: 8, durationMs: 220 }, //  5: failed
  { frames: 6, durationMs: 360 }, //  6: waiting
  { frames: 6, durationMs: 180 }, //  7: working (running, faster than idle)
  { frames: 6, durationMs: 600 }, //  8: reviewing
] as const;

/** Total number of canonical animation rows for a given sprite version. */
export function spriteRows(version: SpriteVersionNumber): number {
  return version === 2 ? 11 : 9;
}

/** Return the per-row animation metadata, with safe defaults for unknown rows. */
export function spriteAnimation(row: number): SpriteAnimation {
  const known = SPRITE_ANIMATIONS[row];
  if (known !== undefined) return known;
  return { frames: 6, durationMs: 220 };
}
