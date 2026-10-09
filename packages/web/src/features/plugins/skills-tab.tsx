/**
 * The skills tab: the installed-skill inventory, with origin, on/off state, categories and search.
 *
 * **Why this is its own component and not more of `plugins-page.tsx`.** That file is 1500+ lines
 * and already owns the library listing, the install manager and two tabs. Threading five more
 * pieces of state (filter, query, switches, categories, pending impact) through it as a sixth
 * would make every later change a merge hazard. This owns them locally and takes the data as
 * props, so the page's job stays "fetch and hand over".
 *
 * **What the tab is for.** The library tab answers "what can I install"; this one answers "what
 * do I have, where did it come from, and what breaks if I turn it off". Those are different
 * questions, and the second is the one that needs the origin distinction: a bundled skill looks
 * identical to a standalone one in a plain list, yet behaves completely differently — it cannot be
 * removed on its own, and its switch dies with its plugin.
 *
 * **Switching off asks first, when it would reach someone.** Turning something off looks local —
 * one toggle, one card — but an Agent holding it loses it, and one that had it *selected*
 * changes behaviour on its next turn with nothing on screen saying so. So a toggle that reaches
 * any Agent routes through the impact dialog listing them, and one that reaches nobody fires
 * immediately: a confirmation for a change with no consequence is a dialog teaching the user to
 * click through them.
 */
import { useCallback, useMemo, useState } from "react";
import type { InstalledSkillItem } from "@prismshadow/jiumate-server/api";
import { S } from "../../lib/strings";
import { useAuth } from "../../state/auth";
import { useLocale } from "../../state/locale";
import { localizedText } from "../chat/skill-use";
import { AffectedAgentsDialog } from "./affected-agents-dialog";
import {
  affectedAgents,
  canToggleIndependently,
  canUninstall,
  changeNeedsConfirming,
  filterMatches,
  filtersFor,
  matchesQuery,
  skillOrigin,
  type ExtensionFilter,
} from "./extension-model";
import {
  isOn,
  loadCategories,
  loadSwitches,
  removeCategory,
  saveCategories,
  saveSwitches,
  scopedId,
  withSwitch,
  type SwitchMap,
} from "./extension-state";
import {
  CategoryManagerDialog,
  ExtensionSearch,
  ExtensionSwitch,
  OriginBadge,
  OriginFilterTabs,
  newCategory,
} from "./extension-ui";
import { Button } from "../../components/ui/button";
import { EmptyState } from "../../components/ui/empty-state";
import { GlyphIcon } from "../../components/ui/glyph-icon";

const BOOK_ICON = "M4 5a2 2 0 0 1 2-2h11v18H6a2 2 0 0 1-2-2V5zM7 3v14";

/** Pending toggle awaiting confirmation, and what to do if it is confirmed. */
interface PendingToggle {
  skill: InstalledSkillItem;
  next: boolean;
}

export function SkillsTab({
  skills,
  agentNames,
}: {
  skills: readonly InstalledSkillItem[];
  /** Display names keyed by agent id, for the impact list. */
  agentNames: Readonly<Record<string, string>>;
}) {
  const { user } = useAuth();
  const { locale } = useLocale();
  const userId = user?.userId ?? null;

  const [filter, setFilter] = useState<ExtensionFilter>("all");
  const [query, setQuery] = useState("");
  const [switches, setSwitches] = useState<SwitchMap>(() => loadSwitches(userId));
  const [categories, setCategories] = useState(() => loadCategories(userId));
  const [managing, setManaging] = useState(false);
  const [pending, setPending] = useState<PendingToggle | null>(null);

  const filters = useMemo(() => filtersFor(true), []);

  /**
   * Filing map: item id -> category. Built from the user's own list plus a file the caller owns —
   * a skill with no entry is simply uncategorised, which is a real bucket and not a missing one.
   */
  const filings = useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const s of skills) map[scopedId("skill", s.name, s.pluginName)] = null;
    return map;
  }, [skills]);

  const withOrigin = useMemo(
    () =>
      skills.map((s) => ({
        skill: s,
        origin: skillOrigin(s),
        id: scopedId("skill", s.name, s.pluginName),
      })),
    [skills],
  );

  /**
   * Counts are computed over the **query-filtered** set but not over the origin filter, so the
   * tabs answer "how many would I get if I clicked this" rather than "how many are on screen" —
   * the latter is always the active tab's own number, which tells the reader nothing.
   */
  const visible = useMemo(
    () =>
      withOrigin
        .filter(({ skill }) => matchesQuery(skill, query))
        .filter(({ origin }) => filterMatches(origin, filter)),
    [withOrigin, query, filter],
  );

  const counts = useMemo(() => {
    const searched = withOrigin.filter(({ skill }) => matchesQuery(skill, query));
    const out: Record<ExtensionFilter, number> = { all: 0, builtin: 0, user: 0, bundled: 0 };
    for (const { origin } of searched) {
      out.all += 1;
      out[origin] += 1;
    }
    return out;
  }, [withOrigin, query]);

  const persist = useCallback(
    (next: SwitchMap) => {
      setSwitches(next);
      saveSwitches(userId, next);
    },
    [userId],
  );

  const persistCategories = useCallback(
    (next: typeof categories) => {
      setCategories(next);
      saveCategories(userId, next);
    },
    [userId],
  );

  /**
   * Toggling routes through the impact dialog only when an Agent would actually be reached.
   *
   * The affected list comes from the skill's own `agents` (the server's install list) unioned with
   * a `selected` claim — the caller cannot supply selections per skill, so the installed list is
   * what we have, and an Agent that merely has it installed is still affected (it loses the skill).
   */
  const requestToggle = useCallback(
    (skill: InstalledSkillItem, next: boolean) => {
      const affected = affectedAgents(skill.agents, { displayNames: agentNames });
      if (!changeNeedsConfirming(affected)) {
        persist(withSwitch(switches, scopedId("skill", skill.name, skill.pluginName), next));
        return;
      }
      setPending({ skill, next });
    },
    [agentNames, switches, persist],
  );

  const confirmToggle = useCallback(() => {
    if (pending) {
      persist(
        withSwitch(
          switches,
          scopedId("skill", pending.skill.name, pending.skill.pluginName),
          pending.next,
        ),
      );
    }
    setPending(null);
  }, [pending, switches, persist]);

  const pendingAffected = useMemo(
    () => (pending ? affectedAgents(pending.skill.agents, { displayNames: agentNames }) : []),
    [pending, agentNames],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <OriginFilterTabs value={filter} onChange={setFilter} filters={filters} counts={counts} />
        <span className="flex-1" />
        <div className="w-40 sm:w-56">
          <ExtensionSearch
            value={query}
            onChange={setQuery}
            placeholder={S.plugins.searchPlaceholder}
          />
        </div>
        <Button size="sm" variant="ghost" onClick={() => setManaging(true)}>
          {S.plugins.manageCategories}
        </Button>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          /* Two different empties, because they call for different next moves: a search that
             matched nothing needs a different term, a filter that is empty needs a different tab.
             Showing 「加载中…」 for either would be an outright lie. */
          title={query.trim() !== "" ? S.plugins.noSearchResult : S.plugins.noItemsInFilter}
          description={query.trim() !== "" ? S.plugins.noSearchResultDesc : undefined}
        />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {visible.map(({ skill, origin, id }) => {
            const on = isOn(switches, id);
            const toggleable = canToggleIndependently(origin);
            const removable = canUninstall(origin);
            return (
              <li
                key={id}
                className="flex items-start gap-2 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900"
              >
                <GlyphIcon d={BOOK_ICON} size={18} className="mt-0.5 shrink-0 text-gray-400" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-mono text-sm text-gray-900 dark:text-gray-100">
                      {skill.name}
                    </span>
                    <OriginBadge origin={origin} />
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs text-gray-500 dark:text-gray-400">
                    {localizedText(locale, skill.description, skill.shortDescriptionZh)}
                  </p>
                  {skill.pluginName && (
                    <p className="mt-0.5 text-[11px] text-gray-400 dark:text-gray-500">
                      {skill.pluginName}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <ExtensionSwitch
                    on={on}
                    label={skill.name}
                    disabled={!toggleable}
                    onToggle={() => requestToggle(skill, !on)}
                  />
                  {!removable && (
                    /* Not a dead control: the reason is on it, since "why can't I remove this"
                       is the question a bundled skill provokes. */
                    <span
                      className="text-[11px] text-gray-400 dark:text-gray-500"
                      title={
                        origin === "bundled"
                          ? (skill.pluginName ?? undefined)
                          : S.plugins.originBuiltin
                      }
                    >
                      {origin === "bundled" ? S.plugins.originBundled : S.plugins.originBuiltin}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <CategoryManagerDialog
        open={managing}
        onClose={() => setManaging(false)}
        categories={categories}
        filings={filings}
        onCreate={(name) => persistCategories([...categories, newCategory(name)])}
        onRename={(cid, name) =>
          persistCategories(categories.map((c) => (c.id === cid ? { ...c, name } : c)))
        }
        onDelete={(cid) => persistCategories(removeCategory(categories, cid, filings).categories)}
      />

      <AffectedAgentsDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        onConfirm={confirmToggle}
        title={pending?.next ? S.plugins.enable : S.plugins.disable}
        description={S.plugins.disableHint}
        note={pending?.skill.pluginName ?? undefined}
        affected={pendingAffected}
        confirmLabel={pending?.next ? S.plugins.enable : S.plugins.disable}
      />
    </div>
  );
}
