/**
 * Unit tests for the pet's look-at-cursor geometry (`pet-look.ts`) and the mood
 * aggregation the two windows share (`pet-activity.ts`). Pure functions only.
 */
import { describe, expect, it } from "vitest";
import { getPetLookDirection, getPetLookFrame } from "../src/features/pet/pet-look";
import { aggregatePetMood, type PetTaskStatus } from "../src/features/pet/pet-activity";

describe("getPetLookDirection", () => {
  it("indexes 0 straight up and grows clockwise, one step per 22.5 degrees", () => {
    expect(getPetLookDirection(0, -10)).toBe(0); // up
    expect(getPetLookDirection(10, 0)).toBe(4); // right (90 degrees)
    expect(getPetLookDirection(0, 10)).toBe(8); // down
    expect(getPetLookDirection(-10, 0)).toBe(12); // left (270 degrees)
  });

  it("treats a pointer on the pet as nothing to look at", () => {
    expect(getPetLookDirection(0, 0)).toBeNull();
    expect(getPetLookDirection(0.5, 0.5)).toBeNull();
    expect(getPetLookDirection(Number.NaN, 5)).toBeNull();
  });

  it("stays inside the 16-cell range for every quadrant boundary", () => {
    for (let degrees = 0; degrees < 360; degrees += 1) {
      const radians = (degrees * Math.PI) / 180;
      const direction = getPetLookDirection(Math.sin(radians) * 20, -Math.cos(radians) * 20);
      expect(direction).toBeGreaterThanOrEqual(0);
      expect(direction).toBeLessThan(16);
    }
  });
});

describe("getPetLookFrame", () => {
  it("maps the first eight directions onto row 9, the next eight onto row 10", () => {
    expect(getPetLookFrame(2, 0)).toEqual({ row: 9, column: 0 });
    expect(getPetLookFrame(2, 7)).toEqual({ row: 9, column: 7 });
    expect(getPetLookFrame(2, 8)).toEqual({ row: 10, column: 0 });
    expect(getPetLookFrame(2, 15)).toEqual({ row: 10, column: 7 });
  });

  it("returns null for a v1 atlas, which has neither look row", () => {
    expect(getPetLookFrame(1, 0)).toBeNull();
    expect(getPetLookFrame(1, 15)).toBeNull();
  });

  it("returns null for no direction and for an out-of-range one", () => {
    expect(getPetLookFrame(2, null)).toBeNull();
    expect(getPetLookFrame(2, 16)).toBeNull();
    expect(getPetLookFrame(2, -1)).toBeNull();
    expect(getPetLookFrame(2, 1.5)).toBeNull();
  });
});

/** Only `mood` matters to the aggregation. */
function task(mood: PetTaskStatus["mood"]): PetTaskStatus {
  return {
    sessionId: `s-${mood}`,
    title: mood,
    mood,
    state: "running",
    label: mood,
    output: "",
    canReply: true,
    startedAt: 0,
    updatedAt: 0,
  };
}

describe("aggregatePetMood", () => {
  it("is rest with nothing tracked", () => {
    expect(aggregatePetMood([])).toBe("rest");
  });

  it("lets a blocked task outrank thinking, and thinking outrank plain work", () => {
    expect(aggregatePetMood([task("working"), task("analyzing"), task("waiting")])).toBe("waiting");
    expect(aggregatePetMood([task("working"), task("analyzing")])).toBe("analyzing");
    expect(aggregatePetMood([task("rest"), task("working")])).toBe("working");
  });

  it("is rest when every tracked task has settled", () => {
    expect(aggregatePetMood([task("rest"), task("rest")])).toBe("rest");
  });
});
