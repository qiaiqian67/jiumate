/**
 * Pure-logic tests for the floating pet window's helpers. No Electron runtime:
 * the `BrowserWindow` constructor and `screen` are not exercised here, only the
 * IPC-payload sanitisation and the display-clamp fallback.
 *
 * The IPC handlers themselves (open / close / move / getPosition / savePosition)
 * live in `pet-window.ts` and depend on Electron's `BrowserWindow` instance,
 * which a fast unit test can't mock without dragging in the whole `electron`
 * package — the wider feature is covered by the `pnpm desktop` smoke run.
 */
import { describe, expect, it } from "vitest";
import {
  clampToDisplaysForTest,
  defaultPetPositionForTest,
  fitToDisplaysForTest,
  positionForTest,
} from "../src/pet-window.js";

describe("positionForTest", () => {
  it("accepts a plain {x,y} object with finite integers", () => {
    expect(positionForTest({ x: 100, y: 200 })).toEqual({ x: 100, y: 200 });
  });

  it("accepts a nested {position:{x,y}} payload from the preload bridge", () => {
    expect(positionForTest({ position: { x: 10, y: 20 } })).toEqual({ x: 10, y: 20 });
  });

  it("rejects NaN / Infinity without throwing", () => {
    expect(positionForTest({ x: Number.NaN, y: 0 })).toBeNull();
    expect(positionForTest({ x: 0, y: Number.POSITIVE_INFINITY })).toBeNull();
    expect(positionForTest({ x: Number.NEGATIVE_INFINITY, y: 0 })).toBeNull();
  });

  it("rejects non-numbers, missing fields, and null", () => {
    expect(positionForTest(null)).toBeNull();
    expect(positionForTest(undefined)).toBeNull();
    expect(positionForTest({})).toBeNull();
    expect(positionForTest({ x: "100", y: 200 })).toBeNull();
    expect(positionForTest({ x: 100 })).toBeNull();
  });
});

describe("clampToDisplaysForTest", () => {
  const displays = [
    { x: 0, y: 0, width: 1920, height: 1080 },
    { x: 1920, y: 0, width: 2560, height: 1440 },
  ];

  it("keeps a position that is already inside a display's work area", () => {
    expect(clampToDisplaysForTest({ x: 500, y: 400 }, displays)).toEqual({ x: 500, y: 400 });
  });

  it("keeps a position on the second monitor", () => {
    expect(clampToDisplaysForTest({ x: 2400, y: 200 }, displays)).toEqual({ x: 2400, y: 200 });
  });

  it("re-anchors an off-screen position to the primary display's bottom-right corner", () => {
    // Off-screen position (e.g. the user unplugged a monitor between sessions):
    // fall back to the primary display with a 24px margin from the bottom-right.
    const out = clampToDisplaysForTest({ x: 9999, y: 9999 }, displays);
    expect(out).toEqual({ x: 1920 - 96 - 24, y: 1080 - 104 - 24 });
  });
});

describe("defaultPetPositionForTest", () => {
  it("parks the pet in the bottom-right corner of the work area", () => {
    expect(
      defaultPetPositionForTest(
        { x: 0, y: 0, width: 1920, height: 1080 },
        { width: 96, height: 104 },
      ),
    ).toEqual({ x: 1920 - 96 - 24, y: 1080 - 104 - 24 });
  });

  it("respects a work area that does not start at the origin (taskbar/dock offset)", () => {
    expect(
      defaultPetPositionForTest(
        { x: 0, y: 40, width: 1512, height: 900 },
        { width: 96, height: 104 },
      ),
    ).toEqual({ x: 1512 - 96 - 24, y: 40 + 900 - 104 - 24 });
  });
});

describe("fitToDisplaysForTest", () => {
  const displays = [{ x: 0, y: 0, width: 1920, height: 1080 }];

  it("leaves a window that already fits alone", () => {
    expect(fitToDisplaysForTest({ x: 500, y: 400 }, { width: 200, height: 120 }, displays)).toEqual(
      { x: 500, y: 400 },
    );
  });

  it("pulls a bubble-grown window back inside the right and bottom edges", () => {
    // Growing for a bubble from the bottom-right corner is exactly what pushes a
    // window past the edge, so the resize path has to clamp where `clampToDisplays`
    // would have accepted the (still on-screen) top-left.
    expect(
      fitToDisplaysForTest({ x: 1824, y: 976 }, { width: 288, height: 152 }, displays),
    ).toEqual({ x: 1920 - 288 - 8, y: 1080 - 152 - 8 });
  });

  it("keeps the edge margin when the window is wider than the work area allows", () => {
    const out = fitToDisplaysForTest({ x: 0, y: 0 }, { width: 360, height: 240 }, displays);
    expect(out).toEqual({ x: 8, y: 8 });
  });
});
