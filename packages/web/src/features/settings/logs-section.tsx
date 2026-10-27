/**
 * The System settings 日志 page: the server error log, with a time range of its own.
 *
 * It moved here from the cost center, where it was a card that inherited that page's date
 * filter — reading the log meant changing what the charts were showing. The range is now the
 * page's alone, which is also why the panel below no longer takes an agent filter: there is no
 * agent control on this page, so there is nothing for one to narrow.
 *
 * **The page opens on 近 7 天, and that default is load-bearing.** The anomaly badge probes the
 * same window (`use-project-todos.ts`, `ERROR_RANGE_PRESET`), so a wider default would raise a
 * dot that leads to a table with no rows in it. Changing the default here without changing the
 * probe would break exactly that.
 *
 * **Why it reads the whole usage aggregate for an error table.** The four stats above the table
 * need more than the paged `/usage/errors` route returns: `unexpected`, `topCode`, and — the one
 * that matters most — `clearable`, which is what lets the clear confirmation name the number of
 * rows that will really go (an admin's read includes unattributed rows that no clear removes).
 * Those three are computed only in the dashboard aggregate's `errors` block, so that is what this
 * page asks for and all it reads back. A dedicated `/usage/errors/summary` route would carry less
 * on the wire; it would also be a new endpoint for a page that opens occasionally, so the
 * trade-off went the other way.
 */
import { useEffect, useMemo, useState } from "react";
import type { UsageErrors, UsageResponse } from "@jadelau/server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useProject } from "../../state/project";
import { useUpdateBadges } from "../../lib/use-update-badges";
import { dismissTodo } from "../../lib/todo-dismissals";
import { refreshProjectTodos } from "../../lib/use-project-todos";
import { isoDate, presetRange } from "../usage/usage-controls";
import { Select } from "../../components/ui/select";
import { Skeleton } from "../../components/ui/skeleton";
import { TodoNotice } from "../../components/ui/todo-notice";
import { LogsPanel } from "./logs-panel";

/** The page's own presets, in rail order. Not the dashboard's list: "last hour" and a custom
 * pair are chart controls, and an error log has no use for either. */
type LogsRangePreset = "today" | "7d" | "30d" | "all";

const RANGE_PRESETS: readonly LogsRangePreset[] = ["today", "7d", "30d", "all"];

function presetLabel(preset: LogsRangePreset): string {
  if (preset === "today") return S.logs.rangeToday;
  if (preset === "7d") return S.logs.range7d;
  if (preset === "30d") return S.logs.range30d;
  return S.logs.rangeAll;
}

/**
 * The page's range as the API wants it: an ISO date pair, or nothing at all for 全部.
 *
 * Pure and exported so the one rule that can silently mislead is asserted directly: 全部 returns
 * **no bounds** rather than a very wide pair. The route reads an absent bound as "unbounded", and
 * the clear confirmation has a sentence for exactly that case (see logs-panel.tsx) — inventing a
 * wide range instead would make the confirmation name two dates nobody chose.
 */
export function logsRange(preset: LogsRangePreset, now: Date): { from?: string; to?: string } {
  if (preset === "all") return {};
  if (preset === "today") {
    const from = new Date(now);
    from.setHours(0, 0, 0, 0);
    const to = new Date(now);
    to.setHours(23, 59, 59, 999);
    return { from: isoDate(from), to: isoDate(to) };
  }
  return presetRange(preset === "7d" ? "7d" : "30d", now);
}

export function LogsSection() {
  const { currentProject } = useProject();
  const badges = useUpdateBadges();
  const projectId = currentProject?.projectId ?? null;

  const [preset, setPreset] = useState<LogsRangePreset>("7d");
  /** "" means no Agent filter — the same spelling the route reads as "all agents". */
  const [agentId, setAgentId] = useState("");
  const [agentIds, setAgentIds] = useState<readonly string[]>([]);
  const [errors, setErrors] = useState<UsageErrors | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  // Bumped by the panel after a clear: the stats above the table are this page's data, so the
  // whole response is refetched rather than patched in place.
  const [reload, setReload] = useState(0);

  // Memoized on the preset and Agent alone: the fetch effect below depends on this object's
  // identity, and a fresh pair every render would loop. `new Date()` is read once per range change
  // on purpose — a range that recomputed on every render would move the window out from under a
  // request. The Agent is part of the same object because the panel's rows, its later pages and
  // its clear all have to name one same set.
  const range = useMemo(() => logsRange(preset, new Date()), [preset]);
  const filters = useMemo(
    () => ({ ...range, ...(agentId !== "" ? { agentId } : {}) }),
    [range, agentId],
  );

  useEffect(() => {
    if (projectId === null) return;
    let cancelled = false;
    setFailed(null);
    api
      .getUsage(projectId, {
        groupBy: "date",
        // Every preset here is a calendar range, so the series is always drawn daily — the
        // aggregate is read for its `errors` block alone (see the file header), and the series
        // is only along for the ride. The Agent filter is sent for the same reason the panel
        // sends it: the stats must count the same set the table shows.
        granularity: "day",
        ...filters,
      })
      .then((res: UsageResponse) => {
        if (cancelled) return;
        setErrors(res.errors);
        // Unaffected by the filters (see UsageResponse.agentIds), so this list is stable across
        // range and Agent changes — it is the Project's Agents, not the ones that happen to have
        // errors in the window.
        setAgentIds(res.agentIds);
      })
      .catch((e: unknown) => {
        if (!cancelled) setFailed(apiErrorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, filters, reload]);

  // The anomaly trail's own notice, unchanged from the cost center: what is waiting, and the
  // control that puts the dot down. Rendered here rather than left to the rail because a dot with
  // no way down is a dot that stops meaning anything (see todo-notice.tsx).
  const todo = badges.todos.errors;

  return (
    <div className="space-y-4">
      {todo && (
        <TodoNotice
          text={S.todo.unexpectedErrors(todo.count)}
          dismissLabel={S.todo.markRead}
          onDismiss={() => dismissTodo(projectId, "errors", todo.signature)}
        />
      )}

      {/* Filters on the right, the way the cost center's own filter row read — this page's toolbar
          is that row, minus the model filter (errors have no Model dimension) and with the range
          list cut down to the presets an error log has a use for. No heading here: the pane's own
          title already says 日志. */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <div className="w-40">
          <Select
            size="sm"
            value={agentId}
            aria-label={S.logs.agentLabel}
            onChange={(e) => setAgentId(e.target.value)}
          >
            <option value="">{S.logs.allAgents}</option>
            {/* The selected Agent is always in `agentIds` (the list is unfiltered), but keep the
                guard: a Project whose Agents changed under a cached list must still show the
                filter it is applying rather than silently falling back to "all". */}
            {agentId !== "" && !agentIds.includes(agentId) && (
              <option value={agentId}>{agentId}</option>
            )}
            {agentIds.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-32">
          <Select
            size="sm"
            value={preset}
            aria-label={S.logs.rangeLabel}
            onChange={(e) => setPreset(e.target.value as LogsRangePreset)}
          >
            {RANGE_PRESETS.map((p) => (
              <option key={p} value={p}>
                {presetLabel(p)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {failed !== null ? (
        <p className="py-6 text-center text-xs text-gray-400">{failed}</p>
      ) : errors === null ? (
        <Skeleton className="h-40" />
      ) : (
        <LogsPanel
          errors={errors}
          projectId={projectId ?? ""}
          filters={filters}
          // Clearing the log is a Project-level management operation, gated on the owner by the
          // route; a member reads the panel without the action.
          canClear={currentProject?.role === "owner"}
          onCleared={() => {
            // The notice above and the rail's dot are gated on a probe cached per Project for the
            // browser session, not on this response — without the re-probe an emptied table would
            // sit under a dot still pointing at the rows that just went.
            refreshProjectTodos(projectId);
            setReload((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}
