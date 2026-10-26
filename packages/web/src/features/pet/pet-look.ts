/**
 * Pet "look at the cursor" geometry.
 *
 * Mirrors OpenBitFun's `getPetLookDirection` / `getPetLookFrame`: the angle from
 * the pet's centre to the pointer is quantised into 16 directions of 22.5°, which
 * is exactly what a v2 atlas' two look rows hold — row 9 covers directions 0-7,
 * row 10 covers 8-15, one column each. A v1 atlas has neither row, so the pet
 * simply keeps its animated idle row.
 */
import type { SpriteVersionNumber } from "@jiumate/pets";
import { spriteRows } from "./pet-states";

/** 360° / 22.5°, and also the number of cells the two look rows provide. */
export const PET_LOOK_DIRECTIONS = 16;

/**
 * Direction index for a pointer offset from the pet's centre, or null when the
 * pointer is effectively on the pet (nothing to look at).
 */
export function getPetLookDirection(x: number, y: number): number | null {
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.hypot(x, y) <= 1) return null;
  // 0 is straight up and the index grows clockwise, matching the atlas rows.
  const angle = ((Math.atan2(x, -y) * 180) / Math.PI + 360) % 360;
  return Math.round(angle / (360 / PET_LOOK_DIRECTIONS)) % PET_LOOK_DIRECTIONS;
}

export interface PetLookFrame {
  row: number;
  column: number;
}

/** Atlas cell for a look direction, or null when this atlas has no look rows. */
export function getPetLookFrame(
  version: SpriteVersionNumber,
  direction: number | null,
): PetLookFrame | null {
  if (direction === null) return null;
  if (!Number.isInteger(direction) || direction < 0 || direction >= PET_LOOK_DIRECTIONS) {
    return null;
  }
  const rows = spriteRows(version);
  const row = 9 + Math.floor(direction / 8);
  if (row >= rows) return null;
  return { row, column: direction % 8 };
}
