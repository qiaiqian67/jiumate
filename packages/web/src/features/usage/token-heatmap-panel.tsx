/**
 * The year heatmap panel: one cell per day, weeks across and weekdays down, for a whole calendar
 * year — the layout of the product's reference card, with the three headline figures beside it.
 *
 * It carries its own request rather than reusing the page's. The page's window is a trailing
 * 7/30/90 days or a custom pair — a filter, and this panel is deliberately not scoped by it:
 * a year view under a seven-day filter would be blank most of the time, and the question it
 * answers ("how has this year gone") is not the question the range control asks. The Agent and
 * Model filters DO apply, because those select *whose* usage is on screen, and a heatmap that
 * ignored them would contradict every chart around it.
 *
 * The year is steppable so the panel stays useful in January, when the current year holds
 * almost nothing.
 */
import { useEffect, useMemo, useState } from "react";
import type { ModelRefDto } from "@prismshadow/jiumate-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { cacheHitRate, formatPercent, humanizeTokens } from "../../lib/format";
import { useLocale } from "../../state/locale";
import { Skeleton } from "../../components/ui/skeleton";
import { ChartCard } from "./chart-card";
import { useChartWidth } from "./chart-svg";
import { buildYearHeatmap, dailyTotals, yearRange } from "./token-heatmap";
import type { DailyTotal, HeatmapCell } from "./token-heatmap";

/**
 * The five shades, palest first — the app's own Token blue (`lib/token-colors.ts`), not a ramp of
 * this panel's own.
 *
 * A heatmap is read by comparing cells, so its scale has to be unmistakably not the surrounding
 * gray chrome. The one blue family is what the rest of the app already uses for Token magnitude
 * (cacheRead lightest / cacheWrite mid / output darkest, the same three stops in the trace
 * panel), and this card counts Tokens — so the two panels on this page read as one scale instead
 * of two unrelated colour groups. Levels 2–4 land exactly on those three shades; level 1 is one
 * step paler, so an almost-empty day still reads as a filled cell.
 *
 * Dark mode inverts the ramp's direction (level 4 is the *lightest* there) so the strongest day
 * stays the one that stands out against a dark panel.
 */
const LEVEL_CLASS: readonly string[] = [
  "bg-gray-100 dark:bg-gray-800",
  "bg-sky-100 dark:bg-sky-950/70",
  "bg-sky-300 dark:bg-sky-800/80",
  "bg-sky-500 dark:bg-sky-600",
  "bg-sky-700 dark:bg-sky-400",
];

/** Gap between cells, in px, in both directions. */
const GAP = 3;
/** The weekday-label gutter, wide enough for the longest label either dictionary carries. */
const GUTTER = 30;
/** Cell edge bounds, in px. The floor keeps a cell tappable and its level legible; the ceiling stops a 53-column grid from turning into a wall of tiles on a very wide window. */
const CELL_MIN = 10;
const CELL_MAX = 18;

/**
 * The cell edge to draw at for a grid of `columns` weeks inside `containerWidth` px.
 *
 * The grid has a fixed shape (53 weeks × 7 days) and the card does not, so the cell is what
 * gives: measured rather than fixed, it makes the year fill the card instead of leaving a column
 * of slack to its right. Pure and exported so the three things that can go wrong are asserted
 * directly — a container narrower than the grid must not produce a zero or negative cell (it
 * clamps to {@link CELL_MIN} and the scroller takes over), a very wide one must not produce a
 * tile (it clamps to {@link CELL_MAX}), and the result must never overflow its container.
 *
 * **The cell is fractional, floored to two decimals, and that is deliberate.** Whole pixels would
 * leave up to one pixel per column unspent — 45px of dead space in a 817px card, which is exactly
 * the gap this measurement exists to remove. Sub-pixel cell edges are safe here in a way they are
 * not on, say, a table border: every cell is separated from its neighbours by {@link GAP}, so
 * there are no two edges touching that could seam, and each cell is one flat fill. Flooring (not
 * rounding) keeps the grid inside the container by construction.
 */
export function heatmapCell(containerWidth: number, columns: number): number {
  if (columns <= 0 || containerWidth <= 0) return CELL_MIN;
  // The grid is `GUTTER` px of weekday labels, then `columns` cells and `columns` gaps — the
  // gutter is a flex sibling of the columns, so its gap counts too (see the render).
  const usable = containerWidth - GUTTER - columns * GAP;
  const raw = Math.floor((usable / columns) * 100) / 100;
  return Math.max(CELL_MIN, Math.min(CELL_MAX, raw));
}

export function TokenHeatmap({
  projectId,
  agentId,
  model,
}: {
  projectId: string | null;
  /** The page's Agent filter, "" for all. */
  agentId: string;
  /** The page's Model filter (always a whole pair, never an id alone). */
  model: ModelRefDto | null;
}) {
  const { locale } = useLocale();
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [cells, setCells] = useState<DailyTotal[] | null>(null);
  const [failed, setFailed] = useState(false);
  /** The width the grid may fill — see heatmapCell. */
  const [gridRef, gridWidth] = useChartWidth();
  /** The hovered cell plus its grid coordinates, which is all the tooltip needs to place itself. */
  const [hover, setHover] = useState<{ cell: HeatmapCell; column: number; row: number } | null>(
    null,
  );

  useEffect(() => {
    if (projectId === null) return;
    let cancelled = false;
    setFailed(false);
    setHover(null);
    const range = yearRange(year);
    void api
      .getUsage(projectId, {
        from: range.from,
        to: range.to,
        groupBy: "date",
        granularity: "day",
        ...(agentId !== "" ? { agentId } : {}),
        ...(model !== null ? { provider: model.provider, modelId: model.modelId } : {}),
      })
      .then((res) => {
        if (!cancelled) setCells(dailyTotals(res.series));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, year, agentId, model]);

  const grid = useMemo(
    () => (cells === null ? null : buildYearHeatmap(year, cells)),
    [cells, year],
  );

  /** The cell edge for this card's width — the grid fills the card instead of a fixed 10px tile. */
  const cell = heatmapCell(gridWidth, grid?.columns.length ?? 0);

  /** Month names in the UI language, from the runtime rather than a hand-kept list of twelve. */
  const monthNames = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { month: "short" });
    return Array.from({ length: 12 }, (_, m) => fmt.format(new Date(year, m, 1)));
  }, [locale, year]);

  const dateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
    [locale],
  );

  const step = (delta: number) => setYear((y) => y + delta);
  const thisYear = new Date().getFullYear();

  const yearStepper = (
    <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
      <button
        type="button"
        title={S.usage.heatmapPrevYear}
        aria-label={S.usage.heatmapPrevYear}
        onClick={() => step(-1)}
        className="flex h-5 w-5 items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-gray-800"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden
        >
          <path d="M15 6l-6 6 6 6" />
        </svg>
      </button>
      <span className="tabular-nums">{year}</span>
      <button
        type="button"
        title={S.usage.heatmapNextYear}
        aria-label={S.usage.heatmapNextYear}
        disabled={year >= thisYear}
        onClick={() => step(1)}
        className="flex h-5 w-5 items-center justify-center rounded hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-gray-800"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>
    </div>
  );

  return (
    <ChartCard title={S.usage.heatmapTitle} extra={yearStepper}>
      <p className="mb-2 text-xs text-gray-400 dark:text-gray-500">{S.usage.heatmapDesc}</p>

      {/* The row and the grid's own container render in **every** state, loading and failed
          included, and that is load-bearing rather than tidy: `useChartWidth` measures on mount
          and observes from there, so a container that only appears once the data lands is a
          container that was never measured — every cell then stays pinned at CELL_MIN and the
          year draws at its smallest possible size with the rest of the card left blank. The
          states differ inside the container, never around it. */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        {/* `relative` so the tooltip is a sibling of the scroller rather than a child:
            `overflow-x-auto` clips absolutely-positioned descendants, which would cut the
            tooltip in half on the columns nearest the edges.
            `lg:flex-1` is what makes the cells as large as they can be: the figures beside it
            take a fixed narrow column, and every remaining pixel goes to the year rather than to
            a gap between the two (which is what `justify-between` used to produce). */}
        <div ref={gridRef} className="relative min-w-0 lg:flex-1">
          {failed ? (
            <p className="py-6 text-center text-xs text-gray-500 dark:text-gray-400">
              {S.usage.heatmapError}
            </p>
          ) : grid === null ? (
            <div className="space-y-1">
              {Array.from({ length: 7 }, (_, i) => (
                <Skeleton key={i} className="h-2.5" />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto pb-1">
              <div className="inline-block">
                {/* Month labels ride above the columns they start. Positioned from the same
                    cell pitch as the grid so a label sits over its own first week. */}
                <div className="relative mb-1 h-3" style={{ marginLeft: GUTTER }}>
                  {grid.monthMarks.map((mark) => (
                    <span
                      key={mark.month}
                      className="absolute top-0 text-[10px] leading-none text-gray-500 dark:text-gray-400"
                      style={{ left: mark.column * (cell + GAP) }}
                    >
                      {monthNames[mark.month]}
                    </span>
                  ))}
                </div>

                <div className="flex" style={{ gap: GAP }}>
                  {/* Weekday labels, one per row, aligned to the cell pitch. */}
                  <div className="flex shrink-0 flex-col" style={{ gap: GAP, width: GUTTER }}>
                    {S.usage.heatmapWeekdays.map((name) => (
                      <div
                        key={name}
                        className="flex items-center text-[10px] leading-none text-gray-400 dark:text-gray-500"
                        style={{ height: cell }}
                      >
                        {name}
                      </div>
                    ))}
                  </div>

                  {/* One column per week, each a vertical run of seven days. */}
                  <div className="flex" style={{ gap: GAP }}>
                    {grid.columns.map((column, columnIndex) => (
                      <div key={columnIndex} className="flex flex-col" style={{ gap: GAP }}>
                        {column.map((cell_, row) =>
                          cell_ === null ? (
                            // A day outside the year: blank space, not a level-0 cell, so the
                            // leading/trailing stubs read as the calendar rather than as missing data.
                            <div key={row} style={{ width: cell, height: cell }} aria-hidden />
                          ) : (
                            <div
                              key={row}
                              onMouseEnter={() =>
                                setHover({ cell: cell_, column: columnIndex, row })
                              }
                              onMouseLeave={() => setHover(null)}
                              className={`rounded-[2px] ${LEVEL_CLASS[cell_.level]}`}
                              style={{ width: cell, height: cell }}
                            />
                          ),
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Legend, under the grid and flush right — the reference card's placement. */}
                <div
                  className="mt-2 flex items-center justify-end gap-1.5 text-[10px] text-gray-400 dark:text-gray-500"
                  style={{ paddingLeft: GUTTER }}
                >
                  <span>{S.usage.heatmapLess}</span>
                  {LEVEL_CLASS.map((cls, level) => (
                    <span
                      key={level}
                      className={`rounded-[2px] ${cls}`}
                      style={{ width: cell, height: cell }}
                    />
                  ))}
                  <span>{S.usage.heatmapMore}</span>
                </div>
              </div>
            </div>
          )}

          {hover !== null && (
            <div
              className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md bg-gray-900/95 px-2.5 py-1.5 text-[11px] leading-tight whitespace-nowrap text-white shadow-lg dark:bg-gray-950/95"
              style={{
                left: GUTTER + hover.column * (cell + GAP) + cell / 2,
                top: hover.row * (cell + GAP) + 34,
              }}
            >
              <div className="mb-0.5 font-medium">
                {dateFmt.format(new Date(`${hover.cell.date}T00:00:00`))}
              </div>
              <div className="text-gray-300">
                {S.usage.heatmapTipTokens(humanizeTokens(hover.cell.total))}
              </div>
              <div className="text-gray-300">
                {S.usage.heatmapTipCache(
                  formatPercent(cacheHitRate(hover.cell.cacheRead, hover.cell.cacheWrite)),
                )}
              </div>
            </div>
          )}
        </div>

        {/* The three headline figures. Each is a value over its own label, and the label carries
            the definition the number alone cannot: a peak and a count are only meaningful once
            you know the window they were taken over.
            A narrow fixed column beside the grid on lg — narrower than the 176px it used to be,
            which is what freed the width the cells now grow into (heatmapCell) — and a
            three-column strip under the grid below lg, where no column fits beside it. The
            tighter gap on lg is deliberate: a column of three figures next to a 7-row grid is
            the taller of the two, so every pixel of internal spacing is a pixel of slack under
            the grid.
            Absent until the grid exists: there is nothing to report before the data lands, and an
            empty column would hold width the loading skeleton is using. */}
        {grid !== null && !failed && (
          <div className="grid grid-cols-3 gap-4 lg:flex lg:w-24 lg:shrink-0 lg:flex-col lg:gap-2">
            <Stat value={humanizeTokens(grid.total)} label={S.usage.heatmapTotal} />
            <Stat value={humanizeTokens(grid.peak)} label={S.usage.heatmapPeak} />
            <Stat value={String(grid.activeDays)} label={S.usage.heatmapActive} />
          </div>
        )}
      </div>
    </ChartCard>
  );
}

/** One figure of the stats column: the number, then what it counts. */
function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-xl font-semibold tabular-nums text-gray-900 dark:text-gray-100">
        {value}
      </p>
      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{label}</p>
    </div>
  );
}
