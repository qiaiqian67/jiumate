/**
 * Cost and usage center:
 * top filters for Agent / Model + a date-range preset (trailing last hour /
 * last 24 hours, calendar 7/30/90 days, or a custom pair of date inputs);
 * the range alone decides the time-series precision, so there is no second
 * control for it (controls have no external title — the explanation is
 * written into the dropdown options themselves);
 * three summary cards (today / last 7 days / cumulative, each stat on its own row);
 * a 2x2 grid of time-series charts over the shared range and precision —
 * requests + success rate broken down by Agent and, beside it, the same by
 * Model (requests stacked on the left axis, one rate line per entity on a
 * right 0–100% axis), then Token buckets (stacked bars + a dashed
 * cache-hit-rate curve in front) and cost (line + points + area). Charts
 * always fit their card — nothing scrolls; below them is a full-width
 * "errors" panel (stats + a paged errors table). Currency follows the user's
 * settings.
 *
 * Every chart draws the same buckets: compactSeries runs **once**, here, and
 * all four are fed its result, so the grid keeps one shared x axis. It drops
 * only the buckets where nothing at all was recorded — emptiness is a
 * property of the interval, not of one entity in it, so a bucket any entity
 * ran in stays and the idle entities show their zeros and dashes there. The
 * per-entity counts arrive index-aligned with `series`, so they are
 * re-indexed through the same `kept` list (compactCounts); one list for all
 * of them is what keeps an entity's history from sliding onto the wrong
 * intervals. Each chart marks the skipped intervals on its own axis.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import type { ModelRefDto, UsageBucket, UsageResponse } from "@jiumate/server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useDocumentTitle } from "../../lib/use-document-title";
import { formatMoney, humanizeTokens } from "../../lib/format";
import { catalogEntryFor } from "@jiumate/core/model-catalog";
import { agentDisplayName, useProject } from "../../state/project";
import { useTheme } from "../../state/theme";
import { Input } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import { Skeleton } from "../../components/ui/skeleton";
import { TrendChart } from "./trend-chart";
import { ChartCard } from "./chart-card";
import { TokenHeatmap } from "./token-heatmap-panel";
import { RequestsChart, TokenBarChart, TokenLegend, type TokenLegendKey } from "./usage-charts";
import {
  compactCounts,
  compactSeries,
  presetDefaultGranularity,
  presetRange,
  presetTsWindow,
  rangeDays,
  type EntityCounts,
  type RangePreset,
} from "./usage-controls";

/** A summary card's stat row: name on the left, value on the right — each item on its own row, so a narrow card no longer crams them into one wrapping line. */
function SummaryRow({
  label,
  value,
  muted,
  sup,
}: {
  label: string;
  value: string;
  muted?: boolean;
  /** Show a superscript marker (the cost row's "includes unpriced records" asterisk sits next to the **name**, not stuck after the number). */
  sup?: boolean;
}) {
  const tone = muted ? "text-gray-500 dark:text-gray-400" : "text-gray-900 dark:text-gray-100";
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
        {label}
        {sup && <sup className="ml-px">*</sup>}
      </span>
      <span className={`min-w-0 truncate font-mono text-sm font-semibold tabular-nums ${tone}`}>
        {value}
      </span>
    </div>
  );
}

/** Usage summary card: a title + Token / request count / cost each on their own row. */
function SummaryCard({
  title,
  bucket,
  currency,
}: {
  title: string;
  bucket: UsageBucket;
  currency: "USD" | "CNY";
}) {
  return (
    <div className="rounded-md border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <p className="mb-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">{title}</p>
      <div className="space-y-0.5">
        <SummaryRow label={S.usage.tokens} value={humanizeTokens(bucket.total)} />
        <SummaryRow label={S.usage.requests} value={String(bucket.requests)} muted />
        {/* The unpriced-records asterisk sits on the word "cost" (superscript), keeping the number clean and readable; see the footer for the explanation */}
        <SummaryRow
          label={S.common.cost}
          value={formatMoney(bucket.cost, currency)}
          sup={bucket.hasUncosted}
        />
      </div>
    </div>
  );
}

export function UsagePage() {
  useDocumentTitle(S.usage.title);
  const { currency } = useTheme();
  const { currentProject, agents } = useProject();
  const projectId = currentProject?.projectId ?? null;
  /** agentId → display name, for the filter's options and the charts' legends (see agentEntities). */
  const agentNameById = useMemo(
    () => new Map(agents.map((a) => [a.agentId, agentDisplayName(a)])),
    [agents],
  );

  // ?agentId= deep link (from the Agents page's "cost" entry point): the URL
  // parameter is the single source of truth for this filter — including
  // clearing it (/usage?agentId=A → clicking nav to /usage doesn't remount,
  // so the filter must be reset); manually changing the filter doesn't write
  // back to the URL (consistent with the existing convention that the model
  // / date filters likewise don't enter the URL — the effect never overrides a manual selection when the parameter is unchanged).
  const [searchParams] = useSearchParams();
  const paramAgentId = searchParams.get("agentId");
  const [agentFilter, setAgentFilter] = useState<string>(paramAgentId ?? "");
  // Model filtering is a **paired reference** (the same model_id can coexist
  // under multiple providers); the dropdown's option value uses the
  // candidate's index rather than a concatenated string — the reference is always passed as a pair, never concatenated into an id.
  const [modelFilter, setModelFilter] = useState<ModelRefDto | null>(null);
  useEffect(() => {
    setAgentFilter(paramAgentId ?? "");
  }, [paramAgentId]);
  // Date range: a trailing window (last hour / last 24 hours), a calendar
  // preset (7/30/90 days), or a custom from/to pair — plus the time-series
  // precision. A range change keeps the precision when the new preset still
  // offers it, otherwise snaps to the preset's default.
  const [preset, setPreset] = useState<RangePreset>("7d");
  const [from, setFrom] = useState(() => presetRange("7d", new Date()).from);
  const [to, setTo] = useState(() => presetRange("7d", new Date()).to);
  const applyRange = (nextPreset: RangePreset, nextFrom: string, nextTo: string) => {
    setPreset(nextPreset);
    setFrom(nextFrom);
    setTo(nextTo);
  };
  const [data, setData] = useState<UsageResponse | null>(null);
  /**
   * The date window the dashboard actually READ, which is not always the one the picker holds.
   * A trailing preset computes its window at load time and deliberately leaves `from`/`to` on
   * whatever the last calendar preset put there, so the two diverge the moment "last hour" is
   * chosen. The error panel pages against this window and, for an owner, DELETES against it —
   * so it has to be the window whose rows are on screen, never the stale pair behind them.
   * Kept as two primitives so the memo below holds its identity across a reload that changes
   * nothing (the panel's fetch effect depends on that identity).
   */
  const [loadedFrom, setLoadedFrom] = useState(from);
  const [loadedTo, setLoadedTo] = useState(to);
  const [error, setError] = useState<string | null>(null);
  // The legend / control state that lives in the card headers (ChartCard's
  // extra) while the marks live inside the cards, lifted to this level.
  const [tokenBucket, setTokenBucket] = useState<TokenLegendKey | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    setError(null);
    try {
      // The trailing presets recompute their window at load time, so a reload
      // keeps trailing "now"; the calendar presets use the stored date pair.
      const range =
        preset === "1h" || preset === "1d" ? presetTsWindow(preset, new Date()) : { from, to };
      const res = await api.getUsage(projectId, {
        ...range,
        // The detail table has been removed, superseded by the charts above; groupBy is still a required query parameter, fixed to group by date.
        groupBy: "date",
        // The range picks the precision — there is no separate control, and this
        // is the only place the choice is made (see presetDefaultGranularity).
        granularity: presetDefaultGranularity(preset, rangeDays(from, to)),
        ...(agentFilter ? { agentId: agentFilter } : {}),
        ...(modelFilter ? { provider: modelFilter.provider, modelId: modelFilter.modelId } : {}),
      });
      setData(res);
      setLoadedFrom(range.from);
      setLoadedTo(range.to);
    } catch (e) {
      setError(apiErrorText(e));
    }
  }, [projectId, preset, from, to, agentFilter, modelFilter?.provider, modelFilter?.modelId]);

  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  if (!projectId) return null;

  // Model filter candidates and the currently selected item's index (the option value uses the index, avoiding concatenating an id as the key).
  const modelOptions = data?.models ?? [];
  const selectedModelIndex = modelFilter
    ? modelOptions.findIndex(
        (m) => m.provider === modelFilter.provider && m.modelId === modelFilter.modelId,
      )
    : -1;
  const modelFilterIndex = selectedModelIndex >= 0 ? String(selectedModelIndex) : "";

  const summary = data?.summary;
  const hasUncostedRows =
    (summary?.today.hasUncosted ?? false) ||
    (summary?.last7d.hasUncosted ?? false) ||
    (summary?.total.hasUncosted ?? false);

  // One compaction for the whole page (see the file header): every chart draws
  // these buckets, and every per-entity series is re-indexed through the same
  // kept list, so nothing can drift out of alignment with the axis.
  const plotted = compactSeries(data?.series ?? []);
  // The two requests charts each get one dimension's entity list, already
  // sorted by total requests descending and arriving index-aligned with the
  // full `series` (the server's contract) — compactCounts moves it onto the
  // drawn buckets; the charts fold their own tails.
  // Agents are labelled by display name, not id: the id is an address, and the reader knows the
  // Agent by its name (the sidebar, the pickers and the chat header all say the name). The map
  // falls back to the id for an Agent whose name is unset, which is the same rule agentDisplayName
  // applies everywhere else.
  const agentEntities: EntityCounts[] = (data?.byAgentSeries ?? []).map((s) => ({
    label: agentNameById.get(s.agentId) ?? s.agentId,
    ...compactCounts(s, plotted.kept),
  }));
  const modelEntities: EntityCounts[] = (data?.byModelSeries ?? []).map((s) => ({
    label: catalogEntryFor(s.provider, s.modelId)?.displayName ?? s.modelId,
    ...compactCounts(s, plotted.kept),
  }));
  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      {/* `max-w-6xl`, the width the plugin and skill pages use: one app, one content width. */}
      <div className="mx-auto max-w-6xl space-y-4">
        {/* Top filters: controls have no external title (the explanation is written into the "all …" option), so they're baseline-centered with the page title */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">{S.usage.title}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-32">
              <Select
                size="sm"
                value={agentFilter}
                onChange={(e) => setAgentFilter(e.target.value)}
              >
                <option value="">{S.usage.filterAllAgents}</option>
                {/* The deep-linked agent must still show as the selected option even if it has no usage records yet (not in agentIds) */}
                {agentFilter && !(data?.agentIds ?? []).includes(agentFilter) && (
                  <option value={agentFilter}>
                    {agentNameById.get(agentFilter) ?? agentFilter}
                  </option>
                )}
                {(data?.agentIds ?? []).map((a) => (
                  <option key={a} value={a}>
                    {agentNameById.get(a) ?? a}
                  </option>
                ))}
              </Select>
            </div>
            <div className="w-32">
              <Select
                size="sm"
                value={modelFilterIndex}
                onChange={(e) => {
                  const i = e.target.value;
                  setModelFilter(i === "" ? null : (modelOptions[Number(i)] ?? null));
                }}
              >
                <option value="">{S.usage.filterAllModels}</option>
                {modelOptions.map((m, i) => (
                  <option key={`${m.provider}:${m.modelId}`} value={String(i)}>
                    {catalogEntryFor(m.provider, m.modelId)?.displayName ?? m.modelId}
                  </option>
                ))}
              </Select>
            </div>
            {/* Date range: trailing windows and quick presets, with "custom" revealing the two date inputs */}
            <div className="w-28">
              <Select
                size="sm"
                value={preset}
                aria-label={S.usage.rangeLabel}
                onChange={(e) => {
                  const next = e.target.value as RangePreset;
                  if (next === "7d" || next === "30d" || next === "90d") {
                    const r = presetRange(next, new Date());
                    applyRange(next, r.from, r.to);
                  } else {
                    // Trailing windows compute their bounds at load time; custom keeps the dates already picked.
                    applyRange(next, from, to);
                  }
                }}
              >
                <option value="1h">{S.usage.rangeHour}</option>
                <option value="1d">{S.usage.rangeDay}</option>
                <option value="7d">{S.usage.range7d}</option>
                <option value="30d">{S.usage.range30d}</option>
                <option value="90d">{S.usage.range90d}</option>
                <option value="custom">{S.usage.rangeCustom}</option>
              </Select>
            </div>
            {preset === "custom" && (
              /* A dash between the two inputs stands in for a "from/to" label */
              <div className="flex items-center gap-1.5">
                <Input
                  size="sm"
                  type="date"
                  aria-label={S.usage.from}
                  value={from}
                  onChange={(e) => applyRange("custom", e.target.value, to)}
                />
                <span className="shrink-0 text-gray-400" aria-hidden>
                  –
                </span>
                <Input
                  size="sm"
                  type="date"
                  aria-label={S.usage.to}
                  value={to}
                  onChange={(e) => applyRange("custom", from, e.target.value)}
                />
              </div>
            )}
          </div>
        </div>

        {/* The error log used to sit here as a card, inheriting this page's date filter — reading
            it meant changing what the charts showed. It lives on the System settings 日志 page
            now, with a range of its own, and this page's anomaly trail moved with it: the dot and
            the "N unexpected errors / mark as read" notice are on that page and its rail row.
            Nothing about errors is left on the cost center, so nothing here points at them. */}

        {/* Summary cards (today / last 7 days / cumulative) */}
        {data ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <SummaryCard title={S.usage.today} bucket={data.summary.today} currency={currency} />
            <SummaryCard title={S.usage.last7d} bucket={data.summary.last7d} currency={currency} />
            <SummaryCard title={S.usage.total} bucket={data.summary.total} currency={currency} />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
        )}

        {/* The year at a glance. Sits above the time-series charts because it is the only panel
            here that ignores the range filter — it answers "how has this year gone", which is
            the wider question, and reading it after four range-scoped charts would invite the
            assumption that it shares their window. */}
        <TokenHeatmap projectId={projectId} agentId={agentFilter} model={modelFilter} />

        {/* Time-series charts, all over the shared range + precision: requests +
            success rate by Agent and by Model on the first row, Token buckets +
            cache hit rate and cost on the second. Charts always fit their card — nothing scrolls. */}
        {data ? (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <ChartCard title={S.usage.chartRequestsByAgent}>
              <RequestsChart
                series={plotted.points}
                entities={agentEntities}
                granularity={data.granularity}
                breaks={plotted.breaks}
              />
            </ChartCard>
            <ChartCard title={S.usage.chartRequestsByModel}>
              <RequestsChart
                series={plotted.points}
                entities={modelEntities}
                granularity={data.granularity}
                breaks={plotted.breaks}
              />
            </ChartCard>
            {/* The Token legend lives in its card header while its marks live inside the card, so that state is lifted to this level */}
            <ChartCard
              title={S.usage.chartTokenTrend}
              extra={<TokenLegend active={tokenBucket} onHover={setTokenBucket} />}
            >
              <TokenBarChart
                series={plotted.points}
                granularity={data.granularity}
                legend={tokenBucket}
                breaks={plotted.breaks}
              />
            </ChartCard>
            <ChartCard title={S.usage.chartCostTrend}>
              <TrendChart
                series={plotted.points}
                granularity={data.granularity}
                currency={currency}
                breaks={plotted.breaks}
              />
            </ChartCard>
          </div>
        ) : (
          <Skeleton className="h-64" />
        )}

        {/* Errors (a single full-width panel: stats + a recent-errors table) */}
        {hasUncostedRows && <p className="text-xs text-gray-400">{S.usage.uncostedNote}</p>}
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </div>
  );
}
