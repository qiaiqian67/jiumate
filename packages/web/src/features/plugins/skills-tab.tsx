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
  loadFilings,
  loadSwitches,
  removeCategory,
  saveCategories,
  saveFilings,
  saveSwitches,
  scopedId,
  withSwitch,
  type FilingMap,
  type SwitchMap,
} from "./extension-state";
import {
  CategoryFilterChips,
  CategoryManagerDialog,
  CategorySelect,
  ExtensionSearch,
  ExtensionSwitch,
  INHERIT,
  OriginBadge,
  OriginFilterTabs,
  newCategory,
} from "./extension-ui";
import { Button } from "../../components/ui/button";
import { EmptyState } from "../../components/ui/empty-state";
import { LibraryCard } from "./library-card";

const BOOK_ICON = "M4 5a2 2 0 0 1 2-2h11v18H6a2 2 0 0 1-2-2V5zM7 3v14";

/** Pending toggle awaiting confirmation, and what to do if it is confirmed. */
interface PendingToggle {
  skill: InstalledSkillItem;
  next: boolean;
}

export function SkillsTab({
  skills,
  agentNames,
  query,
  originFilter,
  setOriginFilter,
  pluginCategories,
}: {
  skills: readonly InstalledSkillItem[];
  /** Display names keyed by agent id, for the impact list. */
  agentNames: Readonly<Record<string, string>>;
  /**
   * The search box and origin tabs are owned by the **page**, not here, so plugins and skills are
   * filtered by the same controls in the same place — they file into the same categories, and two
   * independent filter rows for one shared taxonomy is how the two come to disagree. The counts
   * are still local, since only this tab knows its own inventory.
   */
  query: string;
  originFilter: ExtensionFilter;
  /** Shared with the plugin tab: one filter, one taxonomy, both tabs write the same value. */
  setOriginFilter: (next: ExtensionFilter) => void;
  /**
   * The installed plugins' own categories, so a bundled Skill inherits its plugin's filing instead
   * of asking the user to file the same Skill again. Keyed by plugin name; a plugin with no filing
   * is simply absent, which the tab reads as "inherit nothing".
   */
  pluginCategories: Readonly<Record<string, string | undefined>>;
}) {
  const { user } = useAuth();
  const { locale } = useLocale();
  const userId = user?.userId ?? null;

  const [switches, setSwitches] = useState<SwitchMap>(() => loadSwitches(userId));
  const [categories, setCategories] = useState(() => loadCategories(userId));
  const [filings, setFilings] = useState<FilingMap>(() => loadFilings(userId));
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [managing, setManaging] = useState(false);
  const [pending, setPending] = useState<PendingToggle | null>(null);

  const filters = useMemo(() => filtersFor(true), []);

  /**
   * Filing map: item id → category id.
   *
   * A bundled Skill inherits its **plugin's** category, because that is the filing a user already
   * made when they filed the plugin — asking them to file the same four Skills again because they
   * arrived through a plugin would be the tab punishing them for using one. The stored filing wins
   * when there is one, so a Skill can be pulled out of its plugin's category on purpose.
   *
   * A category pointing at a plugin that is no longer installed (or at nothing) reads as
   * uncategorised rather than throwing: the taxonomy outlives the inventory, which is what makes
   * it a filing at all.
   */
  const pluginCategory = useMemo(() => {
    const map: Record<string, string> = {};
    for (const [name, category] of Object.entries(pluginCategories)) {
      if (category !== undefined) map[name] = category;
    }
    return map;
  }, [pluginCategories]);

  const effectiveFilings = useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const s of skills) {
      const id = scopedId("skill", s.name, s.pluginName);
      const own = filings[id];
      if (own !== undefined) {
        map[id] = own;
        continue;
      }
      // Unfiled: fall back to the owning plugin's category, if the plugin has one.
      const inherited = s.pluginName === null ? undefined : pluginCategory[s.pluginName];
      map[id] = inherited ?? null;
    }
    return map;
  }, [skills, filings, pluginCategory]);

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
        .filter(({ origin }) => filterMatches(origin, originFilter))
        // Category last: it narrows what the origin filter already narrowed, so the counts below
        // and the cards on screen always describe the same set.
        .filter(({ id }) => categoryFilter === null || effectiveFilings[id] === categoryFilter),
    [withOrigin, query, originFilter, categoryFilter, effectiveFilings],
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

  /**
   * Category counts over the search- and origin-filtered set, plus the uncategorised bucket.
   *
   * The `__all__` key carries the total the "全部" chip shows, because that chip is a real choice
   * (it clears the category filter) and a chip whose number cannot be read would be a dead end.
   */
  const categoryCounts = useMemo(() => {
    const out: Record<string, number> = { __all__: 0 };
    const inScope = withOrigin
      .filter(({ skill }) => matchesQuery(skill, query))
      .filter(({ origin }) => filterMatches(origin, originFilter));
    out.__all__ = inScope.length;
    for (const { id } of inScope) {
      const cat = effectiveFilings[id] ?? null;
      const key = cat ?? "__uncategorized__";
      out[key] = (out[key] ?? 0) + 1;
    }
    return out;
  }, [withOrigin, query, originFilter, effectiveFilings]);

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
   * Files one skill under a category, or clears the filing with `null`.
   *
   * The stored map holds **only the user's explicit choices**. An unfiled skill writes nothing
   * rather than writing `null`, so it keeps inheriting its plugin's category — which means
   * "unfiled" stays a real state that can fall back, instead of a value that has to be kept in
   * sync with every plugin's category forever.
   */
  const persistFiling = useCallback(
    (itemId: string, categoryId: string | null) => {
      const next = { ...filings };
      if (categoryId === null) delete next[itemId];
      else next[itemId] = categoryId;
      setFilings(next);
      saveFilings(userId, next);
      // A chip whose count no longer matches the cards would be a dead end, so the filter is
      // released when the skill leaves the category it was narrowing to.
      if (categoryFilter !== null && effectiveFilings[itemId] !== categoryFilter) {
        setCategoryFilter(null);
      }
    },
    [filings, userId, categoryFilter, effectiveFilings],
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
        {/* Origin tabs, then the one category manager — the same controls, in the same order, as
            the plugin tab above it. Skills and plugins file into the same taxonomy, so they get
            the same row; only the inventory behind it differs. */}
        <OriginFilterTabs
          value={originFilter}
          onChange={setOriginFilter}
          filters={filters}
          counts={counts}
        />
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={() => setManaging(true)}>
          {S.plugins.manageCategories}
        </Button>
      </div>

      {/* Category chips on their own row, above the origin tabs in reading order — "what is this
          for" is the question a user arrives with, and "where did it come from" is the follow-up.
          Hidden until a category exists: with only the "全部" chip on screen there is nothing to
          choose, and a lone chip reads as a broken control rather than an offer. */}
      {categories.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <CategoryFilterChips
            value={categoryFilter}
            onChange={setCategoryFilter}
            categories={categories}
            counts={categoryCounts}
            uncategorizedLabel={S.plugins.allCategories}
          />
        </div>
      )}

      {visible.length === 0 ? (
        <EmptyState
          /* Two different empties, because they call for different next moves: a search that
             matched nothing needs a different term, a filter that is empty needs a different tab.
             Showing 「加载中…」 for either would be an outright lie. */
          title={query.trim() !== "" ? S.plugins.noSearchResult : S.plugins.noItemsInFilter}
          description={query.trim() !== "" ? S.plugins.noSearchResultDesc : undefined}
        />
      ) : (
        /* The same `LibraryCard` the plugin tab renders, so the two tabs are visually one page —
           a hand-rolled card here would differ in padding, tile size and meta placement, and the
           eye reads that as two different systems rather than two views of one. The origin badge
           rides in the corner slot, next to the switch, which is where a per-item control belongs;
           the owning plugin goes on the meta line so the relationship is stated without adding a
           row of its own. */
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map(({ skill, origin, id }) => {
            const on = isOn(switches, id);
            const toggleable = canToggleIndependently(origin);
            const removable = canUninstall(origin);
            const meta = [
              skill.version === null ? undefined : skill.version,
              origin === "bundled" && skill.pluginName ? skill.pluginName : undefined,
            ]
              .filter((p): p is string => p !== undefined)
              .join(" · ");
            return (
              <LibraryCard
                key={id}
                {...(skill.icon !== undefined ? { icon: skill.icon } : {})}
                name={skill.name}
                fallbackIcon={BOOK_ICON}
                description={localizedText(locale, skill.description, skill.shortDescriptionZh)}
                {...(meta === "" ? {} : { meta })}
                actionOverlay
                action={
                  <div className="flex items-center gap-1.5">
                    <OriginBadge origin={origin} />
                    {/* Filing control, present only once a category exists: a select with one
                        empty option is a control that does nothing, and it would sit in the same
                        slot as the switch on every card. */}
                    {categories.length > 0 && (
                      <CategorySelect
                        value={filings[id] ?? null}
                        categories={categories}
                        label={skill.name}
                        inheritLabel={S.plugins.categoryInherit}
                        uncategorizedLabel={S.plugins.categoryNone}
                        onChange={(next) => {
                          if (next === INHERIT) {
                            const cleared = { ...filings };
                            delete cleared[id];
                            setFilings(cleared);
                            saveFilings(userId, cleared);
                          } else {
                            persistFiling(id, next);
                          }
                        }}
                      />
                    )}
                    <ExtensionSwitch
                      on={on}
                      label={skill.name}
                      disabled={!toggleable}
                      onToggle={() => requestToggle(skill, !on)}
                    />
                  </div>
                }
                /* A bundled skill cannot be uninstalled on its own — the plugin takes it — and a
                   built-in cannot be uninstalled at all. Rather than show a control that would do
                   nothing, the reason rides on the card: "why can't I remove this" is the question
                   a bundled skill provokes, and it deserves an answer rather than a dead button. */
                {...(!removable
                  ? {
                      keyState: undefined,
                      descriptionTitle: `${localizedText(locale, skill.description, skill.shortDescriptionZh)}\n\n${
                        origin === "bundled"
                          ? S.plugins.bundledSkillNote
                          : S.plugins.builtinSkillNote
                      }`,
                    }
                  : {})}
              />
            );
          })}
        </div>
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
