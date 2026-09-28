/**
 * Year heatmap geometry and colouring (pure — no DOM, no React; unit tested in node).
 *
 * The grid is weeks across and weekdays down (GitHub's contribution layout): each column is one
 * week, each row a fixed weekday, and the month labels ride above the columns. An earlier version
 * of this panel put months down the side and days across, which reads well for "which months were
 * heavy" but wastes most of a 31-wide row on short months and cannot answer "was it weekdays or
 * weekends" at all. This layout is also the one the product's reference card uses.
 *
 * Colouring is by **quantile over the days that have usage**, not by a fraction of the maximum.
 * Token usage is spiky — one long agent run can be an order of magnitude above a typical day — so
 * a max-relative scale paints almost the whole year its palest shade and the one spike its
 * darkest, which is the opposite of informative. Quantiles put the same number of days in each of
 * the four shades, so the year's shape is what the eye reads.
 */
import type { UsageSeriesPoint } from "@prismshadow/jiumate-server/api";

/** A day's cell: `null` where the grid reaches outside the year (the leading/trailing week stubs). */
export interface HeatmapCell {
  /** `yyyy-mm-dd`, the server's day bucket key. */
  date: string;
  /** Tokens — what the shade encodes. */
  total: number;
  /** Requests, and the two cache counters, for the hover tooltip. */
  requests: number;
  cacheRead: number;
  cacheWrite: number;
  /** 0 = no usage, 1..4 = increasing intensity. */
  level: number;
}

/** Where a month's label sits: `column` holds the 1st of `month` (0-based). */
export interface HeatmapMonthMark {
  column: number;
  month: number;
}

export interface HeatmapGrid {
  year: number;
  /** `columns[week][weekday]`, Monday first, Sunday last. */
  columns: ReadonlyArray<ReadonlyArray<HeatmapCell | null>>;
  /** Twelve marks at most — one per month, in calendar order. */
  monthMarks: ReadonlyArray<HeatmapMonthMark>;
  /** Tokens over the whole year. */
  total: number;
  /** The single busiest day's total (0 for an empty year) — the panel's 单日峰值. */
  peak: number;
  /** Days with any usage — the denominator the quantiles were taken over, and the panel's 活跃天数. */
  activeDays: number;
}

/**
 * The only thing the builder reads off a series point. Spelled out rather than reusing
 * `UsageSeriesPoint` so the geometry stays independent of the API shape (and so the tests can
 * hand it five fields instead of eight).
 */
export interface DailyTotal {
  date: string;
  total: number;
  requests: number;
  cacheRead: number;
  cacheWrite: number;
}

/** Adapts the API's day series to what the builder needs. */
export function dailyTotals(series: readonly UsageSeriesPoint[]): DailyTotal[] {
  return series.map((point) => ({
    date: point.bucket,
    total: point.total,
    requests: point.requests,
    cacheRead: point.cacheRead,
    cacheWrite: point.cacheWrite,
  }));
}

/** Days in a month, honouring leap years (`month` is 0-based). */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/**
 * Monday-based weekday index: 0 for Monday … 6 for Sunday.
 *
 * `Date#getDay` counts from Sunday, and the grid's rows start on Monday, so the shift is not
 * cosmetic — without it every cell lands one row off for six of the seven days.
 */
export function weekdayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

/** `yyyy-mm-dd` in the server's bucket format, from local calendar fields (never UTC — a bucket key is a local date). */
function dayKey(year: number, month: number, day: number): string {
  const mm = String(month + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/**
 * The quantile cut points for four shades, over the non-zero totals.
 *
 * Returns four ascending values: a day at or above `cut[i]` is at least level `i + 1`. Ties are
 * unavoidable when a year has few active days (four shades cannot be told apart across three
 * days), and they degrade honestly — the extra days simply land in a higher shade.
 */
export function levelCuts(nonZeroSorted: readonly number[]): number[] {
  if (nonZeroSorted.length === 0) return [Infinity, Infinity, Infinity, Infinity];
  const at = (q: number) =>
    nonZeroSorted[Math.min(nonZeroSorted.length - 1, Math.floor(q * nonZeroSorted.length))]!;
  return [at(0.2), at(0.4), at(0.6), at(0.8)];
}

/** Which shade a total wears, given the cuts. Zero usage is always level 0 (the empty cell). */
export function levelFor(total: number, cuts: readonly number[]): number {
  if (total <= 0) return 0;
  let level = 1;
  for (let i = 0; i < cuts.length; i += 1) if (total >= cuts[i]!) level = i + 1;
  return level;
}

/**
 * Builds the year's grid from the server's zero-filled day series.
 *
 * The first column starts on the Monday on or before 1 January and the last ends on the Sunday on
 * or after 31 December, so every column is a full week and the weekday rows stay straight. The
 * days those stubs cover belong to the neighbouring years, so they are `null` — drawn as blanks,
 * not as level-0 cells: "no data because it is not this year" and "no usage" must not look alike.
 *
 * Days the response does not mention (a range that does not cover them) render as level 0 rather
 * than being omitted, because there a missing cell and an empty one do mean the same thing.
 */
export function buildYearHeatmap(year: number, days: readonly DailyTotal[]): HeatmapGrid {
  const byDate = new Map<string, DailyTotal>();
  for (const day of days) byDate.set(day.date, day);

  // Scoped to the requested year before anything is counted. A `from`/`to` pair is inclusive, so
  // a neighbouring year's bucket should never arrive — but if one did, counting it would put a
  // number in the stats that no cell on screen accounts for.
  const prefix = `${year}-`;
  const inYear = [...byDate.entries()].filter(([date]) => date.startsWith(prefix));
  const nonZero = inYear
    .map(([, day]) => day.total)
    .filter((total) => total > 0)
    .sort((a, b) => a - b);
  const cuts = levelCuts(nonZero);

  // The Monday on or before 1 January. `weekdayIndex` is 0 for Monday, so this is how many days
  // of the previous year the first column has to absorb.
  const first = new Date(year, 0, 1);
  const cursor = new Date(year, 0, 1 - weekdayIndex(first));

  const columns: Array<Array<HeatmapCell | null>> = [];
  const monthMarks: HeatmapMonthMark[] = [];
  const lastDay = new Date(year, 11, 31);

  while (cursor <= lastDay) {
    const column: Array<HeatmapCell | null> = [];
    // The 1st of whichever month this week contains, for the label row above.
    let labelled = -1;
    for (let row = 0; row < 7; row += 1) {
      const cellYear = cursor.getFullYear();
      const cellMonth = cursor.getMonth();
      const cellDay = cursor.getDate();
      if (cellYear !== year) {
        column.push(null);
      } else {
        if (cellDay === 1 && labelled === -1) labelled = cellMonth;
        const date = dayKey(cellYear, cellMonth, cellDay);
        const day = byDate.get(date);
        column.push({
          date,
          total: day?.total ?? 0,
          requests: day?.requests ?? 0,
          cacheRead: day?.cacheRead ?? 0,
          cacheWrite: day?.cacheWrite ?? 0,
          level: levelFor(day?.total ?? 0, cuts),
        });
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    if (labelled !== -1) monthMarks.push({ column: columns.length, month: labelled });
    columns.push(column);
  }

  return {
    year,
    columns,
    monthMarks,
    total: nonZero.reduce((a, b) => a + b, 0),
    peak: nonZero.length > 0 ? nonZero[nonZero.length - 1]! : 0,
    activeDays: nonZero.length,
  };
}

/** The window a year's query spans, as `yyyy-mm-dd` (the API's `from`/`to` are inclusive dates). */
export function yearRange(year: number): { from: string; to: string } {
  return { from: dayKey(year, 0, 1), to: dayKey(year, 11, 31) };
}
