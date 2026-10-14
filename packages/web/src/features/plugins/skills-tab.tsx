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
  ExtensionSearch,
  ORIGIN_LABEL,
  OriginFilterTabs,
  newCategory,
} from "./extension-ui";
import {
  getMachineSkills,
  setMachineSkillEnabled,
  upgradeMachineSkill,
  type MachineSkill,
} from "../../api/endpoints";
import { Switch } from "../../components/ui/switch";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { ICON_SIZE } from "../../lib/icon-scale";
import { INSTALL_ICON, SEND_ICON, TRASH_ICON, UPDATE_ICON } from "./card-icons";
import { toastError, toastInfo, toastSuccess } from "../../components/ui/toast";
import { apiErrorText } from "../../lib/api-error";
import { Button } from "../../components/ui/button";
import { EmptyState } from "../../components/ui/empty-state";
import { LibraryCard } from "./library-card";
import { CardActionsMenu } from "./card-actions-menu";

const BOOK_ICON = "M4 5a2 2 0 0 1 2-2h11v18H6a2 2 0 0 1-2-2V5zM7 3v14";

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
export function hasMachineSwitch(skills: ReadonlyMap<string, MachineSkill>, name: string): boolean {
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
  machineStoreRevision,
  onQuickInvoke,
  onManageInstall,
  onDeleteSkill,
  currentAgentId,
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
  /**
   * Bumped whenever the machine store changes, which makes this tab re-read it.
   *
   * **The add dialog lives in the page, not here**, because the add button does too — it is the
   * page's one action and sits in the same header slot on every tab, so putting a second one in
   * here would put two identically labelled buttons on one screen opening different things.
   *
   * A revision rather than a list of names: the store is keyed by skill name and the whole thing is
   * one request, so handing back the names would tie this component to the shape of the add result
   * without saving anything. It is also a plain number rather than a callback, because the only
   * thing that has to happen after an add is that this tab picks up the new entry.
   */
  machineStoreRevision: number;
  /**
   * The three actions a Skill shares with a plugin card, handed down from the page.
   *
   * **They live in the page because the dialogs and the draft they write do.** 快捷调用 parks a
   * draft and navigates to a chat; 管理安装 opens a modal over the page's own agent list; 删除
   * needs the page's confirm. Each of those is one implementation — a second copy here would be
   * two places where "which agent did this install to" could be answered differently, which is the
   * question the whole plugin page exists to keep one answer to.
   */
  onQuickInvoke: (skillName: string) => void;
  /** Opens 管理安装 for this Skill. */
  onManageInstall: (skillName: string) => void;
  /** Removes this Skill from the machine store. */
  onDeleteSkill: (skillName: string) => Promise<void>;
  /**
   * The Agent selected on the page, or null when there is none.
   *
   * Read here rather than fetched, because 快捷调用 can only offer a Skill this Agent holds — the
   * same rule the plugin card follows — and the page already knows which Agent that is.
   */
  currentAgentId: string | null;
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
    // `machineStoreRevision` is the add-from-the-header signal: it changes whenever a skill was
    // added there, and this is the one thing that has to happen afterwards — the new entry has to
    // reach the map so its card gets the machine switch and the upgrade button. Depending on the
    // prop rather than on a remount means the tab can keep its scroll position and its filters.
  }, [loadMachineSkills, machineStoreRevision]);

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
        {/* **No 添加技能 button here.** Adding a skill is the page's one action, and the page
            already owns that button in its own header — it sits in the same slot on every tab,
            because three tabs that each put their add control somewhere else is exactly the kind
            of inconsistency a user has to re-learn per tab. A second one here put two identically
            labelled buttons on one screen, which is worse than either placement alone: the user
            cannot tell which is the real one, and both open different dialogs.

            The category manager stays: it is not an add, and it belongs with the category chips
            below it. */}
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
            // The machine switch **is** the enable/disable the row shows, so there is one knob and
            // not two: a machine-store Skill answers both scopes at once (the write reaches every
            // Agent), while a built-in or bundled one has no machine entry and keeps the per-Agent
            // switch. Either way exactly one control, and it means the same thing to the user.
            const switchOn = machineSkill === undefined ? on : machineOn;
            const switchOff =
              machineSkill === undefined
                ? (s: InstalledSkillItem) =>
                    requestToggle(s, !isOn(switches, scopedId("skill", s.name, s.pluginName)))
                : (s: InstalledSkillItem) => {
                    const entry = machineSkills.get(s.name);
                    if (entry !== undefined) void toggleMachineSkill(entry);
                  };
            // 快捷调用 needs a Skill the current Agent actually has, the same as the plugin card:
            // invoking a Skill no Agent holds would write a draft that names something unusable.
            const quickInvokeSkill = skill.agents.includes(currentAgentId ?? "")
              ? skill
              : undefined;
            const meta = [
              skill.version === null ? undefined : skill.version,
              ORIGIN_LABEL[origin],
              effectiveFilings[id] === null
                ? undefined
                : categories.find((c) => c.id === effectiveFilings[id])?.name,
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
                  /* The same five controls the plugin card has, in the same glyph style and
                     the same order — 升级 / 快捷调用 / 管理安装 / 启用禁用 / 删除 — so the two
                     tabs read as one page. A Skill is not a lesser plugin here: it is added
                     from a URL or an archive rather than chosen from a library, but once
                     installed it is the same unit of work and it answers the same five
                     actions. **Where they live changed; what they do did not.**

                     **No text-bearing controls.** The badge and the category select that used
                     to sit here are gone, and neither of them was an action: a badge states a
                     fact, and filing a Skill into a category is what the category chips and
                     管理分类 above are for.

                     The origin moves to the meta line, where the version already is — it is
                     information about the Skill, not a control. The category moves there too,
                     as a trailing word, so the filing is still visible without costing the row
                     a control. */
                  <CardActionsMenu
                    menuLabel={S.plugins.cardActions(skill.name)}
                    triggerLabel={skill.name}
                    items={[
                      {
                        key: "upgrade",
                        label: S.plugins.upgradeSkill,
                        icon: UPDATE_ICON,
                        disabled: machineSkill === undefined || upgrading === skill.name,
                        disabledReason:
                          machineSkill?.source === undefined
                            ? S.plugins.upgradeSkillNeedsSource
                            : S.plugins.upgradeSkill,
                        onClick: () => machineSkill && void upgradeSkill(machineSkill),
                      },
                      {
                        key: "invoke",
                        label: S.skills.quickInvoke,
                        icon: SEND_ICON,
                        disabled: !quickInvokeSkill,
                        onClick: () => quickInvokeSkill && onQuickInvoke(quickInvokeSkill.name),
                      },
                      {
                        // The per-Agent list: what is installed where is a fact about the Skill,
                        // and where it is installed is what this opens.
                        key: "install",
                        label: S.skills.manageInstall,
                        icon: INSTALL_ICON,
                        onClick: () => onManageInstall(skill.name),
                      },
                      {
                        // 卸载. The row stays listed even when it cannot run — a bundled Skill
                        // is removed with its plugin and a built-in not at all, and "why can't I
                        // remove this" deserves an answer rather than a missing row. The card
                        // also carries the reason in its description tooltip.
                        key: "delete",
                        label: S.plugins.deleteFromMachine,
                        icon: TRASH_ICON,
                        danger: true,
                        disabled: !removable,
                        onClick: () => void onDeleteSkill(skill.name),
                      },
                    ]}
                    switch={{
                      // The same reasoning as the plugin card's: a knob whose position is its
                      // state, in the panel's foot rather than among the commands.
                      // 「启用」/「禁用」 with no subject in the visible words — the card it is
                      // already open from is the one carrying the name.
                      label: switchOn ? S.plugins.disable : S.plugins.enable,
                      subject: skill.name,
                      hint: switchOn ? S.plugins.disableHint : S.plugins.enableHint,
                      checked: switchOn,
                      disabled: !toggleable,
                      onChange: () => void switchOff(skill),
                    }}
                  />
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
