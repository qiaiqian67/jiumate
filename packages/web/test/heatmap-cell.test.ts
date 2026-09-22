/**
 * token-heatmap-panel.tsx's cell sizing: the one piece of the year grid's geometry that depends on
 * the card rather than on the calendar.
 *
 * It is worth pinning because both of its failure modes are silent. A cell computed as a fraction
 * would make the grid jitter by a sub-pixel per column; a cell computed without a floor would go
 * to zero or negative in a narrow card, where the grid is supposed to overflow into its scroller
 * rather than collapse. Neither shows up as an error — only as a grid that looks wrong.
 *
 * The clamp ceiling is the other half: a 53-column grid on a very wide window would otherwise grow
 * into a wall of tiles, so the size has to stop somewhere.
 *
 * vitest runs node-only here (`environment: "node"`), so the geometry is a plain exported function
 * rather than something a test could measure out of a rendered grid.
 */
import { describe, expect, it } from "vitest";
import { heatmapCell } from "../src/features/usage/token-heatmap-panel";

/** A year's worth of week columns — the common case (52 or 53). */
const WEEKS = 53;
/** The grid's drawn width for a given cell: the weekday gutter, then one cell and one gap per column. */
const gridWidth = (cell: number) => WEEKS * cell + WEEKS * 3 + 30;

describe("heatmapCell", () => {
  it("fills the width it was given, leaving at most a hundredth of a pixel per column", () => {
    // The property the whole measurement exists for: no dead column on the right. A whole-pixel
    // cell would leave up to one pixel per column unspent, which is the gap this removes.
    // Up to the cap only — past it the grid is deliberately narrower than the card (see below).
    for (const width of [817, 941, 1000, 1024, 1140]) {
      const cell = heatmapCell(width, WEEKS);
      const drawn = gridWidth(cell);
      expect(drawn).toBeLessThanOrEqual(width);
      expect(width - drawn).toBeLessThan(1);
    }
  });

  it("grows with the container, which is the whole point of measuring", () => {
    // The same grid in a card twice as wide gets visibly bigger cells, not the same 10px tile
    // with a column of slack beside it.
    expect(heatmapCell(1800, WEEKS)).toBeGreaterThan(heatmapCell(950, WEEKS));
  });

  it("never exceeds the container, even where the division lands just under a whole pixel", () => {
    // Flooring rather than rounding: a raw 11.999 must draw at 11.99, not 12.
    const exact = 11.999 * WEEKS + WEEKS * 3 + 30;
    const cell = heatmapCell(exact, WEEKS);
    expect(cell).toBe(11.99);
    expect(gridWidth(cell)).toBeLessThanOrEqual(exact);
  });

  it("floors rather than collapses in a card too narrow for the grid", () => {
    // The scroller takes over from here (the grid is `overflow-x-auto`): a zero or negative cell
    // would render as nothing at all.
    expect(heatmapCell(200, WEEKS)).toBe(10);
    expect(heatmapCell(1, WEEKS)).toBe(10);
    expect(heatmapCell(0, WEEKS)).toBe(10);
    expect(heatmapCell(-50, WEEKS)).toBe(10);
  });

  it("caps a very wide card instead of tiling the whole width", () => {
    // Past the cap the grid stops growing and the card keeps a margin: an 18px cell is already
    // the point where the year reads as tiles rather than as a calendar.
    expect(heatmapCell(6000, WEEKS)).toBe(18);
    expect(heatmapCell(1440, WEEKS)).toBe(18);
  });

  it("falls back to the floor before the grid exists, rather than dividing by zero", () => {
    // The first frame: width 0 and no built grid yet. Rendering must not throw.
    expect(heatmapCell(0, 0)).toBe(10);
    expect(heatmapCell(900, 0)).toBe(10);
  });

  it("uses the column count it is given, so a 52-week year gets bigger cells than a 53-week one", () => {
    expect(heatmapCell(1000, 52)).toBeGreaterThanOrEqual(heatmapCell(1000, 53));
  });
});
