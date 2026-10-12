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
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { AddSkillDialog } from "./add-skill-dialog";
import {
  getMachineSkills,
  setMachineSkillEnabled,
  upgradeMachineSkill,
  type MachineSkill,
} from "../../api/endpoints";
import { Switch } from "../../components/ui/switch";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { ICON_SIZE } from "../../lib/icon-scale";
import { toastError, toastInfo, toastSuccess } from "../../components/ui/toast";
import { apiErrorText } from "../../lib/api-error";
import { Button } from "../../components/ui/button";
import { EmptyState } from "../../components/ui/empty-state";
import { LibraryCard } from "./library-card";

const BOOK_ICON = "M4 5a2 2 0 0 1 2-2h11v18H6a2 2 0 0 1-2-2V5zM7 3v14";

/**
 * 升级图标（rotate-cw，24×24 线性路径）。
 *
 * 与插件卡片上那个是同一条路径，这里各写一份而不是从 `plugins-page.tsx` 导入：那个常量没有导出，
 * 而为一个图标在两个 feature 之间开一条跨目录依赖，比重复这一行路径更糟——两处将来会各自改一处，
 * 然后两个页面的同一个动作长得不一样。
 */
const UPDATE_ICON = "M23 4v6h-6M20.49 15a9 9 0 1 1-2.12-9.36L23 10";

/**
 * 一个技能在本机是否启用。
 *
 * **默认「开」，和服务器同一个规则。** 本机技能库里的每一项都是被添加进来的，而添加本身不含关闭；
 * 而且服务器把「不在关闭名单里」也读作开启，所以客户端必须给出同一个答案，否则卡片会与运行时
 * 说的相反。
 */
export function isMachineSkillOn(skills: ReadonlyMap<string, MachineSkill>, name: string): boolean {
  const entry = skills.get(name);
  if (entry === undefined) return true;
  return (entry as { enabled?: boolean }).enabled !== false;
}

/**
 * 这张卡片上要不要画机器级开关。
 *
 * **只有从本机技能库添加来的技能才有。** 内置技能与插件带来的技能不在库里：给它们挂一个机器开关，
 * 写下去的那个值没有任何技能读——一个改不动任何东西的控件比没有更糟。
 */
export function hasMachineSwitch(
  skills: ReadonlyMap<string, MachineSkill>,
  name: string,
): boolean {
  return skills.has(name);
}

/**
 * 这张卡片上要不要画升级按钮。
 *
 * **有来源记录才画。** 压缩包来源也有按钮——服务端能回答，而它的回答是「无从检查」，那是一个如实的
 * 结果；没有来源记录（手工复制进来的目录）才连按钮都不给，因为那里**没有任何地方**可以查，而一个
 * 永远道歉的按钮的提示没人会读第二遍。
 */
export function hasUpgrade(skills: ReadonlyMap<string, MachineSkill>, name: string): boolean {
  return skills.get(name)?.source !== undefined;
}

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
  /** 添加技能弹窗是否打开。 */
  const [adding, setAdding] = useState(false);
  /**
   * 本机技能库：技能名 → 它的来源与版本。
   *
   * **只有从本机库里添加来的技能才有这一项。** 内置技能与插件带来的技能不在本机库里，它们各自的
   * 来源由别处记着；所以升级按钮对它们不存在，而不是给一个按下去只会说「无从检查」的按钮。
   */
  const [machineSkills, setMachineSkills] = useState<ReadonlyMap<string, MachineSkill>>(
    () => new Map(),
  );
  /** 正在切换本机开关 / 正在升级的技能名，各一个，用来只禁用自己那一张卡。 */
  const [togglingMachine, setTogglingMachine] = useState<string | null>(null);
  const [upgrading, setUpgrading] = useState<string | null>(null);

  const loadMachineSkills = useCallback(() => {
    void getMachineSkills()
      .then((res) => setMachineSkills(new Map(res.skills.map((s) => [s.name, s]))))
      // 读不到就当作本机库里没有：技能仍然照常显示，只是没有升级按钮——一个读不出来的列表不该
      // 让整个技能页变空。
      .catch(() => setMachineSkills(new Map()));
  }, []);

  useEffect(() => {
    loadMachineSkills();
  }, [loadMachineSkills]);

  /**
   * 本机启用/关闭一个技能。
   *
   * 服务器端会作废**每一个**运行时，所以这一步的成功之后，Agent 就真的不再调用它了——不是像
   * 之前那个 localStorage 开关那样，只改了一下浏览器里的一个值。
   */
  const toggleMachineSkill = async (skill: MachineSkill) => {
    if (togglingMachine !== null) return;
    const next = !isMachineSkillOn(machineSkills, skill.name);
    setTogglingMachine(skill.name);
    try {
      const res = await setMachineSkillEnabled(skill.name, next);
      setMachineSkills((prev) => {
        const next = new Map(prev);
        next.set(skill.name, { ...skill, ...res });
        return next;
      });
      toastSuccess(next ? S.plugins.enabledToast(skill.name) : S.plugins.disabledToast(skill.name));
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setTogglingMachine(null);
    }
  };

  /**
   * 回到当初的来源去查新版本。
   *
   * **「无从检查」是一个结果，不是一个失败**：压缩包解完之后原始文件不在机器上，而谎称「已是最新」
   * 会让用户以为这个技能有人维护。
   */
  const upgradeSkill = async (skill: MachineSkill) => {
    if (upgrading !== null) return;
    setUpgrading(skill.name);
    try {
      const res = await upgradeMachineSkill(skill.name);
      if (!res.upgradable) {
        toastInfo(S.plugins.upgradeSkillNeedsSource);
        return;
      }
      if (!res.upgraded) {
        toastInfo(S.plugins.upgradeSkillUpToDate);
        return;
      }
      toastSuccess(S.plugins.upgradeSkillDone(res.version ?? ""));
      loadMachineSkills();
    } catch (e) {
      toastError(`${S.plugins.upgradeSkillFailed}：${apiErrorText(e)}`);
    } finally {
      setUpgrading(null);
    }
  };

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
        {/* Add, then manage categories: adding is the action a user arrives with; managing the
            taxonomy is the occasional one. The dialog states that what it adds lands 待启用, since
            "added" and "in use" are different states and only one of them is this button. */}
        <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
          {S.plugins.addSkill}
        </Button>
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
            // Only a skill that was **added to this machine** has a machine-store entry, and
            // therefore the wider switch and the upgrade. A bundled skill inherits its plugin's
            // switch instead — two switches for one thing is how a half-on plugin gets written.
            const machineSkill = machineSkills.get(skill.name);
            const machineOn = isMachineSkillOn(machineSkills, skill.name);
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
                    {/* A machine-store skill carries its own two switches, because it genuinely has
                        two: this one for the machine, and the ExtensionSwitch above for whichever
                        Agent is selected. Only added skills have them — a built-in or a
                        plugin-bundled skill has no machine-store entry, and giving it a machine
                        switch would be a control that writes nothing.

                        The machine switch is the wider one and is drawn first: switching it off
                        stops the skill for every Agent at once, which is the act a user reaches for
                        when they want it gone from their machine's behaviour. */}
                    {machineSkill !== undefined && (
                      <>
                        <Switch
                          size="sm"
                          checked={machineOn}
                          onChange={() => void toggleMachineSkill(machineSkill)}
                          disabled={togglingMachine === skill.name}
                          aria-label={`${machineOn ? S.plugins.disableMachine : S.plugins.enableMachine} ${skill.name}`}
                          title={
                            machineOn ? S.plugins.disableMachineHint : S.plugins.enableMachineHint
                          }
                        />
                        {/* Upgrade only where there is something to check. A skill from an archive
                            has no source left, so the button is absent rather than present-and-
                            apologetic: the user learns why from its absence, and the tooltip on a
                            permanently-disabled button is a thing nobody reads twice. */}
                        {machineSkill.source !== undefined && (
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-7 w-7 shrink-0 justify-center p-0"
                            aria-label={`${S.plugins.upgradeSkill} ${skill.name}`}
                            title={S.plugins.upgradeSkill}
                            disabled={upgrading === skill.name}
                            onClick={() => void upgradeSkill(machineSkill)}
                          >
                            <GlyphIcon d={UPDATE_ICON} size={ICON_SIZE.iconButton} />
                          </Button>
                        )}
                      </>
                    )}
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

      {adding && (
        <AddSkillDialog
          categories={categories}
          onFiled={(names, categoryId) => {
            // File what was just added, so the skill lands in the chosen category rather than
            // needing a second trip through every card. Scoped the same way the existing filings
            // are, so a skill filed here and a skill filed by hand are the same record.
            if (categoryId !== null) {
              const next = { ...filings };
              for (const name of names) next[scopedId("skill", name, null)] = categoryId;
              setFilings(next);
              saveFilings(userId, next);
            }
            loadMachineSkills();
            setAdding(false);
          }}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  );
}
