/**
 * Pure-logic tests for the floating-companion window's helpers. No Electron runtime:
 * the BrowserWindow constructor and `screen` are not exercised here, only the input
 * sanitisation that runs on every IPC payload and the display-clamp fallback.
 *
 * The IPC handlers themselves (move / getPosition / savePosition) live in
 * companion-window.ts and depend on Electron's `BrowserWindow` instance, which a
 * fast unit test can't mock without dragging in the whole `electron` package — the
 * wider feature is covered by `pnpm start` smoke and the manual checklist in the
 * PR description.
 */
import { describe, expect, it } from "vitest";
import { sanitisePositionForTest, clampToDisplaysForTest } from "../src/companion-window.js";

describe("sanitisePosition", () => {
  it("accepts a plain {x,y} object with finite integers", () => {
    expect(sanitisePositionForTest({ x: 100, y: 200 })).toEqual({ x: 100, y: 200 });
  });

  it("rounds fractional coordinates instead of passing them through", () => {
    // Electron's setPosition rounds internally too, but explicit rounding here
    // keeps the IPC payload stable (and easy to assert against).
    expect(sanitisePositionForTest({ x: 100.4, y: 200.6 })).toEqual({ x: 100, y: 201 });
  });

  it("rejects NaN / Infinity without throwing", () => {
    expect(sanitisePositionForTest({ x: Number.NaN, y: 0 })).toBeNull();
    expect(sanitisePositionForTest({ x: 0, y: Number.POSITIVE_INFINITY })).toBeNull();
    expect(sanitisePositionForTest({ x: Number.NEGATIVE_INFINITY, y: 0 })).toBeNull();
  });

  it("rejects non-numbers, missing fields, and null", () => {
    expect(sanitisePositionForTest(null)).toBeNull();
    expect(sanitisePositionForTest(undefined)).toBeNull();
    expect(sanitisePositionForTest({})).toBeNull();
    expect(sanitisePositionForTest({ x: "100", y: 200 })).toBeNull();
    expect(sanitisePositionForTest({ x: 100 })).toBeNull();
  });
});

describe("clampToDisplays", () => {
  // The real `screen` API isn't available in node; we feed it a fake via the test
  // export. The test export accepts a list of displays so we can pin the expected
  // boundaries without mocking the entire `electron` module.
  const displays = [
    {
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    },
    {
      workArea: { x: 1920, y: 0, width: 2560, height: 1440 },
    },
  ];

  it("keeps a position that is already inside a display's workArea", () => {
    expect(clampToDisplaysForTest({ x: 500, y: 400 }, displays)).toEqual({ x: 500, y: 400 });
  });

  it("keeps a position on the second monitor", () => {
    expect(clampToDisplaysForTest({ x: 2400, y: 200 }, displays)).toEqual({ x: 2400, y: 200 });
  });

  it("falls back to the primary display's bottom-right when the saved position is off-screen", () => {
    // Off-screen position (e.g. user unplugged a monitor between sessions) →
    // re-anchor to the primary display with a 24px margin from the bottom-right.
    const out = clampToDisplaysForTest({ x: 9999, y: 9999 }, displays);
    expect(out.x).toBeGreaterThanOrEqual(0);
    expect(out.x).toBeLessThanOrEqual(1920);
    expect(out.y).toBeGreaterThanOrEqual(0);
    expect(out.y).toBeLessThanOrEqual(1080);
  });
});
