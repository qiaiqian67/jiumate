/**
 * token-heatmap.ts unit tests: the year grid's shape and its colouring.
 *
 * The shape assertions are the load-bearing ones. A grid that is one row out of step still looks
 * like a calendar, and one whose first column starts on a Sunday still looks like a calendar — so
 * the geometry is pinned by invariant rather than by eye: **every cell's row equals its own
 * weekday**, which is the one property that cannot be true of a mis-aligned grid.
 *
 * The colouring assertions pin the choice that matters: quantiles over active days, not a
 * fraction of the maximum. A max-relative scale is the obvious implementation and the wrong one
 * for token usage, which is spiky enough that one long run would flatten the rest of the year to
 * the palest shade.
 *
 * vitest runs node-only here (`environment: "node"`), which is why the geometry lives in a plain
 * module with no React in it.
 */
import { describe, expect, it } from "vitest";
import {
  buildYearHeatmap,
  dailyTotals,
  daysInMonth,
  levelCuts,
  levelFor,
  weekdayIndex,
  yearRange,
} from "../src/features/usage/token-heatmap";
import type { DailyTotal } from "../src/features/usage/token-heatmap";

/** `[date, total]` pairs in the shape the builder takes. */
const days = (pairs: Array<[string, number]>): DailyTotal[] =>
  pairs.map(([date, total]) => ({ date, total, requests: 0, cacheRead: 0, cacheWrite: 0 }));

/** Local midnight for a `yyyy-mm-dd` key, so `getDay()` reads the calendar date rather than a UTC shift. */
const at = (date: string) => new Date(`${date}T00:00:00`);

describe("daysInMonth", () => {
  it("knows the ordinary lengths", () => {
    expect(daysInMonth(2026, 0)).toBe(31); // January
    expect(daysInMonth(2026, 3)).toBe(30); // April
    expect(daysInMonth(2026, 1)).toBe(28); // February, common year
  });

  it("knows the leap years, including the century rules", () => {
    expect(daysInMonth(2024, 1)).toBe(29); // divisible by 4
    expect(daysInMonth(1900, 1)).toBe(28); // divisible by 100 but not 400
    expect(daysInMonth(2000, 1)).toBe(29); // divisible by 400
  });
});

describe("weekdayIndex", () => {
  it("counts from Monday, which is what the grid's rows do", () => {
    // 2026-01-01 is a Thursday; `Date#getDay` calls that 4, the grid calls it 3.
    expect(weekdayIndex(at("2026-01-01"))).toBe(3);
    // The two ends of the week, which are where an off-by-one shows up.
    expect(weekdayIndex(at("2026-01-05"))).toBe(0); // Monday
    expect(weekdayIndex(at("2026-01-11"))).toBe(6); // Sunday
    expect(at("2026-01-05").getDay()).toBe(1); // the raw value it is derived from
  });
});

describe("levelCuts / levelFor", () => {
  it("puts the same number of active days in each of the four shades", () => {
    const sorted = Array.from({ length: 20 }, (_, i) => (i + 1) * 10);
    const cuts = levelCuts(sorted);
    const counts = [0, 0, 0, 0, 0];
    for (const v of sorted) counts[levelFor(v, cuts)]! += 1;
    expect(counts[0]).toBe(0); // nothing zero here
    expect(counts.slice(1).reduce((a, b) => a + b, 0)).toBe(20);
    expect(counts[4]).toBeGreaterThan(0);
    expect(counts[1]).toBeGreaterThan(0);
  });

  it("treats a spike as one dark day rather than flattening the year", () => {
    // Under a max-relative scale everything but the spike would sit in the palest shade.
    const sorted = [...Array.from({ length: 99 }, (_, i) => i + 1), 100_000];
    const cuts = levelCuts(sorted);
    const ordinary = Array.from({ length: 99 }, (_, i) => i + 1).map((v) => levelFor(v, cuts));
    expect(new Set(ordinary).size).toBeGreaterThan(1);
    expect(levelFor(100_000, cuts)).toBe(4);
    expect(ordinary.filter((l) => l === 4).length).toBeLessThan(20);
  });

  it("gives zero usage level 0 whatever the cuts say", () => {
    expect(levelFor(0, [1, 2, 3, 4])).toBe(0);
    expect(levelFor(-5, [1, 2, 3, 4])).toBe(0);
  });

  it("degrades honestly when the year has too few active days to tell four shades apart", () => {
    expect(levelFor(7, levelCuts([7]))).toBe(4);
    expect(levelFor(1, levelCuts([]))).toBe(1);
    expect(levelFor(0, levelCuts([]))).toBe(0);
  });
});

describe("buildYearHeatmap — the grid's shape", () => {
  /** Every non-null cell, with the column and row it was placed at. */
  const placed = (grid: ReturnType<typeof buildYearHeatmap>) =>
    grid.columns.flatMap((column, c) =>
      column.flatMap((cell, r) => (cell === null ? [] : [{ cell, c, r }])),
    );

  it("lays out weeks across and seven weekdays down", () => {
    const grid = buildYearHeatmap(2026, []);
    expect(grid.columns.length).toBeGreaterThanOrEqual(52);
    expect(grid.columns.length).toBeLessThanOrEqual(54);
    for (const column of grid.columns) expect(column).toHaveLength(7);
  });

  it("puts every cell on its own weekday's row", () => {
    // THE invariant: this is what a mis-aligned grid violates. 2026-01-01 is a Thursday, so the
    // grid's row 3 — and a grid that counted rows from Sunday would put it on row 4.
    const grid = buildYearHeatmap(2026, []);
    for (const { cell, r } of placed(grid)) expect(weekdayIndex(at(cell.date))).toBe(r);
    const jan1 = placed(grid).find((p) => p.cell.date === "2026-01-01");
    expect(jan1).toBeDefined();
    expect(jan1!.r).toBe(3);
    expect(jan1!.c).toBe(0); // 1 January is in the year's first column
  });

  it("steps exactly seven days between a column and the next, within a row", () => {
    // Columns are weeks, not merely "adjacent runs of days". Compared row-by-row rather than
    // first-cell-to-first-cell: the year's first column starts with three blanks (December of the
    // year before), so its first non-null cell sits on row 3 and a first-cell comparison would
    // read a four-day step that is not there.
    const grid = buildYearHeatmap(2026, []);
    let compared = 0;
    for (let r = 0; r < 7; r += 1) {
      for (let c = 1; c < grid.columns.length; c += 1) {
        const prev = grid.columns[c - 1]![r];
        const here = grid.columns[c]![r];
        if (!prev || !here) continue;
        const gap = (at(here.date).getTime() - at(prev.date).getTime()) / 86_400_000;
        expect(gap).toBe(7);
        compared += 1;
      }
    }
    // Guard against the loop passing vacuously if the grid ever came back empty.
    expect(compared).toBeGreaterThan(300);
  });

  it("leaves the days of the neighbouring years blank rather than empty", () => {
    // The stubs exist so every column is a full week; their days are not this year's, so they
    // must not read as "a day with no usage".
    const grid = buildYearHeatmap(2026, []);
    const first = grid.columns[0]!;
    const leading = first.findIndex((cell) => cell !== null);
    expect(leading).toBe(3); // Monday 29 December 2025 … Wednesday 31 December 2025
    for (let r = 0; r < leading; r += 1) expect(first[r]).toBeNull();

    const last = grid.columns[grid.columns.length - 1]!;
    const trailing = last.map((cell) => cell !== null).lastIndexOf(true);
    expect(trailing).toBeLessThan(6);
    for (let r = trailing + 1; r < 7; r += 1) expect(last[r]).toBeNull();
  });

  it("covers 1 January and 31 December, the two ends of the year", () => {
    const grid = buildYearHeatmap(2026, []);
    const cells = placed(grid).map((p) => p.cell.date);
    expect(cells[0]).toBe("2026-01-01");
    expect(cells[cells.length - 1]).toBe("2026-12-31");
    expect(cells).toHaveLength(365);
  });

  it("gives a leap year its 29th of February", () => {
    const grid = buildYearHeatmap(2024, days([["2024-02-29", 500]]));
    const cell = placed(grid).find((p) => p.cell.date === "2024-02-29");
    expect(cell).toBeDefined();
    expect(cell!.cell.total).toBe(500);
    expect(cell!.r).toBe(weekdayIndex(at("2024-02-29")));
    // 29 February 2024 is a Thursday, so the neighbouring Wednesday is the 28th.
    expect(grid.columns[cell!.c]![cell!.r - 1]!.date).toBe("2024-02-28");
  });
});

describe("buildYearHeatmap — month marks", () => {
  it("marks twelve months, in calendar order, each over the column holding its 1st", () => {
    const grid = buildYearHeatmap(2026, []);
    expect(grid.monthMarks.map((m) => m.month)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    // Each mark's column really does carry that month's first day — a label one column off would
    // otherwise still look plausible.
    for (const mark of grid.monthMarks) {
      const mm = String(mark.month + 1).padStart(2, "0");
      const dates = grid.columns[mark.column]!.filter((cell) => cell !== null).map((c) => c.date);
      expect(dates).toContain(`2026-${mm}-01`);
    }
  });

  it("advances the columns monotonically", () => {
    const grid = buildYearHeatmap(2026, []);
    const columns = grid.monthMarks.map((m) => m.column);
    expect([...columns].sort((a, b) => a - b)).toEqual(columns);
  });
});

describe("buildYearHeatmap — the figures the panel headlines", () => {
  it("totals, peaks and counts only the days with usage", () => {
    const grid = buildYearHeatmap(
      2026,
      days([
        ["2026-01-01", 100],
        ["2026-01-02", 0],
        ["2026-01-03", 250],
      ]),
    );
    expect(grid.total).toBe(350); // 累计词元量
    expect(grid.peak).toBe(250); // 单日峰值
    expect(grid.activeDays).toBe(2); // 活跃天数
  });

  it("ignores days outside the requested year instead of counting them", () => {
    // A `from`/`to` pair is inclusive, so a neighbouring year's bucket cannot arrive — but if one
    // did, counting it would put a number in the stats that no cell on screen accounts for.
    const grid = buildYearHeatmap(
      2026,
      days([
        ["2025-12-31", 999],
        ["2026-01-01", 5],
      ]),
    );
    expect(grid.total).toBe(5);
    expect(grid.peak).toBe(5);
    expect(grid.activeDays).toBe(1);
    expect(grid.columns[0]![3]!.total).toBe(5);
  });

  it("reports an empty year without dividing by zero", () => {
    const grid = buildYearHeatmap(2026, []);
    expect(grid.total).toBe(0);
    expect(grid.peak).toBe(0);
    expect(grid.activeDays).toBe(0);
    expect(grid.columns[0]!.find((cell) => cell !== null)!.level).toBe(0);
  });
});

describe("yearRange / dailyTotals", () => {
  it("spans the first to the last day of the year, inclusive", () => {
    expect(yearRange(2026)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(yearRange(2024).to).toBe("2024-12-31");
  });

  it("carries the tooltip's fields through, not just the total", () => {
    // The cell shades on tokens but the tooltip also reports the cache hit rate, so the two
    // counters have to survive the adaptation.
    const series = [
      { bucket: "2026-01-01", total: 7, requests: 3, cacheRead: 90, cacheWrite: 10 },
    ] as unknown as Parameters<typeof dailyTotals>[0];
    expect(dailyTotals(series)).toEqual([
      { date: "2026-01-01", total: 7, requests: 3, cacheRead: 90, cacheWrite: 10 },
    ]);
  });
});
