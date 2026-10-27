/**
 * Petdex sprite atlas renderer — pure CSS, zero dependencies.
 *
 * Mirrors OpenBitFun's `AgentCompanionPet` petdex style vars:
 *   backgroundSize = columns*100% × rows*100%
 *   backgroundPositionY = row / (rows-1) * 100%
 *   animation end X = frames / (columns-1) * 100%
 *
 * The atlas format carries its own per-frame cadence (`SPRITE_ANIMATIONS`), but
 * the walk cycle does not use it: 6 idle frames at 1100ms each is a 6.6s loop,
 * which reads as a still image. The cycle duration comes from the mood's CSS
 * class instead (see `styles.css`), matching OpenBitFun.
 */
import type { SpriteVersionNumber } from "@jadelau/pets";
import { spriteAnimation, spriteRows } from "./pet-states";

const SPRITE_COLUMNS = 8;

export interface PetSpriteStyle {
  "--pet-src": string;
  "--pet-row": number;
  "--pet-frames": number;
  "--pet-end": string;
  backgroundImage: string;
  backgroundSize: string;
  backgroundPositionY: string;
  backgroundPositionX: string;
  backgroundRepeat: "no-repeat";
  imageRendering: "pixelated";
}

/** Build the CSS variables + background values for a sprite row. */
export function getPetSpriteStyle(
  src: string,
  row: number,
  version: SpriteVersionNumber,
  column = 0,
): PetSpriteStyle {
  const frames = spriteAnimation(row);
  const rows = spriteRows(version);
  const endPct = (frames.frames / (SPRITE_COLUMNS - 1)) * 100;
  const rowPct = rows <= 1 ? 0 : (row / (rows - 1)) * 100;
  // A look frame is a single cell: the caller pairs a non-zero column with the
  // `--static` class, which drops the walk animation so this value stands.
  const startPct = (clampColumn(column) / (SPRITE_COLUMNS - 1)) * 100;
  return {
    "--pet-src": `url("${src}")`,
    "--pet-row": row,
    "--pet-frames": frames.frames,
    "--pet-end": `${endPct}%`,
    backgroundImage: `var(--pet-src)`,
    backgroundSize: `${SPRITE_COLUMNS * 100}% ${rows * 100}%`,
    backgroundPositionY: `${rowPct}%`,
    backgroundPositionX: `${startPct}%`,
    backgroundRepeat: "no-repeat",
    imageRendering: "pixelated",
  };
}

function clampColumn(column: number): number {
  if (!Number.isInteger(column) || column < 0) return 0;
  return Math.min(column, SPRITE_COLUMNS - 1);
}
