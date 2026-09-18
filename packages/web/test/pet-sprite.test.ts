/**
 * Unit tests for the Petdex sprite-atlas CSS math (`sprite.ts`) and the canonical
 * row table (`pet-states.ts`). Pure functions only — no DOM, no image decode.
 *
 * The geometry mirrors OpenBitFun's `AgentCompanionPet` style vars:
 *   backgroundSize = columns*100% × rows*100%
 *   backgroundPositionY = row / (rows-1) * 100%
 *   animation end X = frames / (columns-1) * 100%
 */
import { describe, expect, it } from "vitest";
import { getPetSpriteStyle } from "../src/features/pet/sprite";
import { SPRITE_ANIMATIONS, spriteAnimation, spriteRows } from "../src/features/pet/pet-states";

const SRC = "/pets/blue-golden/spritesheet.png";

/** Parse the numeric prefix of a `"NN%"` value so float math is asserted numerically. */
function pct(value: string): number {
  return Number.parseFloat(value.replace("%", ""));
}

describe("spriteRows / spriteAnimation", () => {
  it("v1 atlases have 9 rows, v2 adds the two look rows (11)", () => {
    expect(spriteRows(1)).toBe(9);
    expect(spriteRows(2)).toBe(11);
  });

  it("exposes the canonical nine v1 rows in order", () => {
    expect(SPRITE_ANIMATIONS).toHaveLength(9);
    expect(SPRITE_ANIMATIONS[0]).toEqual({ frames: 6, durationMs: 1100 }); // idle
    expect(SPRITE_ANIMATIONS[1]).toEqual({ frames: 8, durationMs: 90 }); //  running-right
    expect(SPRITE_ANIMATIONS[3]).toEqual({ frames: 4, durationMs: 220 }); // waving
    expect(SPRITE_ANIMATIONS[8]).toEqual({ frames: 6, durationMs: 600 }); // reviewing
  });

  it("falls back to a safe default for rows outside the table (e.g. the v2 look rows)", () => {
    expect(spriteAnimation(9)).toEqual({ frames: 6, durationMs: 220 });
    expect(spriteAnimation(99)).toEqual({ frames: 6, durationMs: 220 });
  });
});

describe("getPetSpriteStyle", () => {
  it("v1 idle (row 0): full-atlas background, top row, one frame-step per frame", () => {
    const style = getPetSpriteStyle(SRC, 0, 1);
    expect(style["--pet-src"]).toBe(`url("${SRC}")`);
    expect(style.backgroundImage).toBe("var(--pet-src)");
    expect(style["--pet-row"]).toBe(0);
    expect(style["--pet-frames"]).toBe(6);
    expect(style.backgroundSize).toBe("800% 900%");
    expect(style.backgroundPositionY).toBe("0%");
    expect(style.backgroundPositionX).toBe("0%");
    expect(style.backgroundRepeat).toBe("no-repeat");
    expect(style.imageRendering).toBe("pixelated");
    // end X = frames / (columns-1) = 6/7.
    expect(pct(style["--pet-end"])).toBeCloseTo((6 / 7) * 100, 6);
  });

  it("row 1 (running-right): 8 frames, second row band, end at 8/7 of the atlas width", () => {
    const style = getPetSpriteStyle(SRC, 1, 1);
    expect(style["--pet-frames"]).toBe(8);
    // row / (rows-1) = 1/8.
    expect(style.backgroundPositionY).toBe("12.5%");
    expect(pct(style["--pet-end"])).toBeCloseTo((8 / 7) * 100, 6);
  });

  it("v2 atlas: 11 row bands, and the last look row lands on the bottom edge", () => {
    const style = getPetSpriteStyle(SRC, 10, 2);
    expect(style.backgroundSize).toBe("800% 1100%");
    expect(style.backgroundPositionY).toBe("100%");
    // Unknown row 10 → the default 6-frame cadence.
    expect(style["--pet-frames"]).toBe(6);
  });

  it("unknown rows clamp the row band without leaving the atlas", () => {
    const style = getPetSpriteStyle(SRC, 99, 1);
    expect(style["--pet-row"]).toBe(99);
    expect(pct(style.backgroundPositionY)).toBeCloseTo((99 / 8) * 100, 6);
  });
});
