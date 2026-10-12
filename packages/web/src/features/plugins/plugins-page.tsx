/**
 * Plugin library page: the built-in plugin library (loaded by core from the @jiumate/* packages), shown sectioned by category.
 * A plugin ships skills and/or a hook package (scripts the harness runs at the loop's hook
 * points, e.g. after every Task), and is installed on an Agent as a whole. Groups are
 * borderless — the group header (category name + plugin count, no icon) is collapsible,
 * highlights on hover, and animates height on expand/collapse; expanded by default. Cards
 * within a group form a grid, generously sized: two per row from the sm breakpoint up, one per
 * row on narrow screens. Each card = a rounded icon tile centered against the two text rows
 * (its color comes from skillTileColor — a per-name palette hashed from the plugin name; DTO
 * icon = the plugin's raw icon.svg (beside plugin.json), rendered inline once it passes
 * sanitize, otherwise the puzzle piece) + a name (monospace) and short description on the
 * right, one line each
 * (single-line truncation, falling back to the full description when missing) + a line below
 * both with what the plugin contains ("N skills", one "<event> hook" badge per hook point)
 * and its metadata (version · usage count "used by N Agents"); group and card copy follow the
 * UI language (localizedText / localizedShortText), and groups have no description. Icon
 * buttons for actions (copy goes into aria-label and title) —
 * - Rotate "update installs" (shown only when the server lists some Agent's installed copy
 *   behind the library — `AgentSummary.pluginUpdates`; the page never compares versions
 *   itself): opens a confirm dialog (lists each Agent's old → new version and warns the
 *   overwriting reinstall drops local edits), then reinstalls the current library copy on
 *   every outdated Agent (install-again-is-update semantics), with a single success toast; the
 *   manage-installs Modal marks outdated rows with an accent "Update" button doing the same per
 *   Agent (through the same confirm);
 * - Paper plane "quick start" (plugins with at least one skill): enters /chat/new draft mode on
 *   the currently selected agent, pre-selects one of the plugin's skills the agent has
 *   installed, and pre-fills the invocation text per UI language ("use the X skill" in the
 *   active dictionary, overwriting any existing draft body); disabled unless that agent has
 *   one of the plugin's skills installed — quick start opens the draft there, so it can't
 *   pre-select a skill the current agent lacks;
 * - Download "manage installs": a Modal listing every Agent in the current Project —
 *   not-installed shows "Install", installed shows "Installed" (hover switches to
 *   "Uninstall", click to uninstall); any member can operate it; optimistic update, a
 *   top-level toast on success for install/uninstall, rollback plus a toast on failure.
 *   Installed means the whole plugin is: every one of its skills is in the Agent's installed
 *   skills and, when it ships a hook package, that package is in the Agent's installed hooks —
 *   which is why the page fetches both lists per Agent. Uninstall takes the plugin apart the
 *   same way: one DELETE per skill and one for the hook package.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import type {
  AgentSummary,
  HookItem,
  PluginGroupItem,
  PluginItem,
  InstalledPluginItem,
  InstalledSkillItem,
  InstalledSkillsResponse,
  SkillCatalogItem,
  SkillMetadataItem,
} from "@prismshadow/jiumate-server/api";
import * as api from "../../api/endpoints";
import { InstalledSkillsView } from "./installed-skills-view";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useDocumentTitle } from "../../lib/use-document-title";
import { useUpdateBadges } from "../../lib/use-update-badges";
import { dismissTodo } from "../../lib/todo-dismissals";
import { bulkOutcome, failedList, firstFailure, noticeCounts } from "../../lib/bulk-update";
import { useAuth } from "../../state/auth";
import { useLocale } from "../../state/locale";
import { agentDisplayName, useProject } from "../../state/project";
import { AgentAvatar } from "../../components/ui/agent-avatar";
import { Button } from "../../components/ui/button";
import { Chevron } from "../../components/ui/chevron";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { Input } from "../../components/ui/input";
import {
  ArrowLeftIcon,
  CheckIcon,
  HOOK_ICON,
  PLUGIN_ICON,
  PlusIcon,
  SEND_ICON,
} from "../../components/ui/icons";
import { TRASH_ICON } from "../../components/ui/session-row-menu";
import { LibraryCard } from "./library-card";
import { Modal } from "../../components/ui/modal";
import { TodoNotice } from "../../components/ui/todo-notice";
import { UpdateDot } from "../../components/ui/update-dot";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { Skeleton, SkeletonCard } from "../../components/ui/skeleton";
import { Switch } from "../../components/ui/switch";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { DRAFT_SESSION_ID } from "../chat/chat-page";
import { draftKey, loadDraft, saveDraft } from "../chat/draft-cache";
import { parkActiveDraft } from "../chat/draft-sessions";
import { BOOK_ICON, localizedShortText, localizedText } from "../chat/skill-use";
import { PluginDetailModal } from "./plugin-detail";
import { ConnectorsTab } from "./connectors-tab";
import { SkillsTab } from "./skills-tab";
import { CategoryManagerDialog, OriginFilterTabs, newCategory } from "./extension-ui";
import { AddPluginDialog } from "./add-plugin-dialog";
import { filtersFor, type ExtensionFilter } from "./extension-model";
import {
  loadCategories,
  loadFilings,
  removeCategory,
  saveCategories,
  scopedId,
  type FilingMap,
} from "./extension-state";
import { Tabs } from "../../components/ui/tabs";
import { formatRelativeDate } from "../../lib/format";
import { SkillTile } from "../skills/skill-icon-view";
import { SkillImportDialog } from "../skills/skill-import-dialog";
import { buildImportPrompt } from "../agents/skill-import-source";
import { InfoPopover } from "../../components/ui/info-popover";
import { HelpFold } from "../../components/ui/help-fold";
import { ICON_SIZE } from "../../lib/icon-scale";

/** Category chip on the library page: filled when it is the active filter, outlined otherwise. */
function chipClass(active: boolean): string {
  return `shrink-0 rounded-full px-3 py-1 text-xs transition-colors duration-150 ${
    active
      ? "bg-gray-900 font-medium text-white dark:bg-gray-100 dark:text-gray-900"
      : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
  }`;
}

/**
 * What one Agent has installed, by name → the installed copy's version (`YYYY-MM-DD.N`, or ""
 * when the files carry none): its skills and its hook packages, the two lists a plugin is
 * spread over.
 */
export interface AgentInstalls {
  skills: ReadonlyMap<string, string>;
  hooks: ReadonlyMap<string, string>;
}

/** agentId → what is installed there; in-page install-state snapshot, rewritten in place by optimistic updates. */
export type InstalledMap = ReadonlyMap<string, AgentInstalls>;

/** The three fields of a plugin the install questions below read (the card passes the whole DTO; tests can pass just these). */
export type PluginParts = Pick<PluginItem, "name" | "skills" | "hooks">;

/** "Quick start" button icon (paper plane, 24×24 line path; the path lives in `components/ui/icons.tsx` so the App Center and other surfaces can reuse it without a cross-feature import). */
/** "Manage installs" button icon (download into tray, 24×24 line path). */
const INSTALL_ICON = "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3";
/** "Update installs" button icon (rotate-cw, 24×24 line path). */
const UPDATE_ICON = "M23 4v6h-6M20.49 15a9 9 0 1 1-2.12-9.36L23 10";
const NO_INSTALLS: AgentInstalls = { skills: new Map(), hooks: new Map() };

/** The two lists an install response carries, folded into one Agent's snapshot entry. */
function installsOf(
  skills: readonly SkillMetadataItem[],
  hooks: readonly HookItem[],
): AgentInstalls {
  return {
    skills: new Map(skills.map((s) => [s.name, s.version])),
    hooks: new Map(hooks.map((h) => [h.name, h.version])),
  };
}

/**
 * Whether a plugin is installed on an Agent, meaning any part of it is: one of its skills is in
 * the Agent's installed skills, or (when it ships a hook package) that package — named after
 * the plugin — is in the Agent's installed hooks. A partial copy counts: an install of an older
 * version that shipped fewer skills, or one a skill was removed from in the Skills tab, is what
 * the server lists as behind and what an update (a whole reinstall) completes; "all parts"
 * would call it not installed and hide the update.
 */
export function pluginInstalled(plugin: PluginParts, installs: AgentInstalls | undefined): boolean {
  if (installs === undefined) return false;
  return (
    plugin.skills.some((skill) => installs.skills.has(skill.name)) ||
    (plugin.hooks.length > 0 && installs.hooks.has(plugin.name))
  );
}

/**
 * The version of a plugin's installed copy on one Agent, read off its hook package where it has
 * one and off its first installed skill otherwise (a plugin's parts ship at the plugin's
 * version), or undefined when the plugin is not installed there. Only ever displayed — the
 * "old → new" line of the update confirmation — never compared.
 */
export function installedPluginVersion(
  plugin: PluginParts,
  installs: AgentInstalls | undefined,
): string | undefined {
  if (installs === undefined) return undefined;
  if (plugin.hooks.length > 0) return installs.hooks.get(plugin.name);
  for (const skill of plugin.skills) {
    const version = installs.skills.get(skill.name);
    if (version !== undefined) return version;
  }
  return undefined;
}

/**
 * Agents the server says are behind the library on plugin `name` (the update reminder's data
 * source): read off `AgentSummary.pluginUpdates`, the same field the plugins gate counts, so
 * the card, the notice and the nav dot cannot disagree — and so the web never compares
 * `YYYY-MM-DD.N` strings itself. Not-installed Agents are never listed there.
 */
export function outdatedAgentIds(
  agents: ReadonlyArray<Pick<AgentSummary, "agentId" | "pluginUpdates">>,
  name: string,
): string[] {
  return agents
    .filter((agent) => agent.pluginUpdates.some((update) => update.name === name))
    .map((agent) => agent.agentId);
}

/**
 * What updating EVERY outdated plugin on this page would write, grouped the way it is sent.
 *
 * Read off `AgentSummary.pluginUpdates` — the same field the plugins gate counts — so the plan
 * and the notice above the button cannot describe different work. One request per Agent rather
 * than one per (Agent, plugin): the install endpoint already takes a list of names, and an Agent
 * behind on four plugins is one overwrite either way.
 *
 * `plugins` is the distinct library plugins across the whole plan, sorted, which is what the
 * confirmation lists and what the notice counts — the page shows the library once, so an update
 * touching five Agents is still one plugin to the reader.
 */
export interface PluginUpdatePlan {
  perAgent: { agentId: string; names: string[] }[];
  plugins: string[];
}

export function pluginUpdatePlan(
  agents: ReadonlyArray<Pick<AgentSummary, "agentId" | "pluginUpdates">>,
): PluginUpdatePlan {
  const perAgent: { agentId: string; names: string[] }[] = [];
  const plugins = new Set<string>();
  for (const agent of agents) {
    const names = agent.pluginUpdates.map((u) => u.name).sort();
    if (names.length === 0) continue;
    perAgent.push({ agentId: agent.agentId, names });
    for (const name of names) plugins.add(name);
  }
  return { perAgent, plugins: [...plugins].sort() };
}

export function PluginsPage() {
  useDocumentTitle(S.nav.plugins);
  const [tab, setTab] = useState<"plugins" | "skills" | "connectors">("plugins");
  const [libraryView, setLibraryView] = useState<"plugins" | "skills" | "hooks">("plugins");
  /** Origin filter, shared by the plugin and skills tabs — they file into the SAME categories. */
  const [originFilter, setOriginFilter] = useState<ExtensionFilter>("all");
  /** Add-plugin dialog: URL / archive / this machine. */
  const [addOpen, setAddOpen] = useState(false);
  /** Tags dialog (the plugin tab's 管理标签 button). */
  const [tagsOpen, setTagsOpen] = useState(false);
  /** Bumped by the connectors tab's add button to ask its own dialog to open. */
  const [connectorsAddNonce, setConnectorsAddNonce] = useState(0);
  /**
   * Whether the installed-skills full-screen page is open.
   *
   * Its own view rather than a fourth tab: the marketplace and the installed list are two
   * different questions, and a tab makes them look like two views of one question. The reference
   * layout makes the count a button that opens a page with a back arrow, which says "this is
   * somewhere else" in the affordance itself.
   */
  const [showInstalled, setShowInstalled] = useState(false);
  /** The full-screen page's own search, independent of the library's. */
  const [installedQuery, setInstalledQuery] = useState("");
  /**
   * Installed Skills the library has since renamed (null while unknown, [] when there are none).
   *
   * Fetched only while the installed page is open: it is a Project-wide read, and the page is the
   * only place that offers the fix, so fetching it earlier would be work nobody could see the
   * result of.
   */
  const [legacy, setLegacy] = useState<readonly api.RenamableSkill[] | null>(null);
  /** Library search: filters the cards inside their categories (see the title row). */
  const [query, setQuery] = useState("");
  /** Active category chip (null = all): narrows the sections to one, like the reference chips. */
  const [groupFilter, setGroupFilter] = useState<string | null>(null);
  /**
   * Which kind of thing the library is showing.
   *
   * Drives the flat card grid only, and is set from the top tabs rather than by its own row: the
   * reference has one set of tabs (插件 / 技能 / 连接器), and this is the "which members of a
   * plugin do I show" switch behind the 技能 one. `hooks` is kept because a hook-only plugin still
   * needs somewhere to list its hook points, even though no tab selects it directly yet — removing
   * the value would strand that data rather than delete it.
   *
   * The reference layout puts these as three peer tabs over one card grid, and it is the right
   * shape here because they really are three things a user looks for separately: a plugin as a
   * bundle, one skill they want on its own, and a hook that has no skill at all. Filtering to a
   * single kind rather than blending them stops "which of these do I install" being a question
   * about cards of different shapes.
   *
   * Note this does not change what an install *does* — still the whole plugin, per the decision to
   * keep installs at the plugin unit; it changes only which things are listed to choose from.
   */
  /** Add-a-skill dialog (open flag + the source text the caller owns). */
  const [importOpen, setImportOpen] = useState(false);
  const [importSource, setImportSource] = useState("");
  const navigate = useNavigate();
  const { locale } = useLocale();
  const userId = useAuth().user?.userId ?? null;
  /**
   * The user's own tags over the library, loaded and saved exactly as the skills tab loads them.
   * The two tabs list the same plugins and the same skills, so a tag filed on one has to be the
   * same tag on the other — sharing the storage is what makes that true rather than a coincidence.
   */
  const [categories, setCategories] = useState(() => loadCategories(userId));
  /** Item name -> category id, holding only the user's explicit choices (see extension-state). */
  const [filings, setFilings] = useState<FilingMap>(() => loadFilings(userId));
  const persistCategories = useCallback(
    (next: typeof categories) => {
      setCategories(next);
      saveCategories(userId, next);
    },
    [userId],
  );
  const { currentProject, agents, currentAgent, setCurrentAgentId, reloadAgents } = useProject();
  /**
   * Agent id -> display name, for the impact dialog. Built once per agents change rather than
   * inside the tab so a dialog that lists twenty Agents does not rebuild the lookup per row.
   * An Agent missing from the list is left out and `affectedAgents` falls back to the raw id —
   * the alternative is showing a blank row for a deleted Agent.
   */
  const agentNameMap = useMemo(() => {
    const out: Record<string, string> = {};
    for (const a of agents) out[a.agentId] = agentDisplayName(a);
    return out;
  }, [agents]);
  const projectId = currentProject?.projectId ?? null;

  /** The plugins trail's raised badge, or undefined — the notice under the title acts on it or clears it. */
  const todo =
    useUpdateBadges().todos
      .plugins; /** The bulk update's confirmation is open (null = closed); it holds the plan it will run. */
  const [pendingBulk, setPendingBulk] = useState<PluginUpdatePlan | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);

  const [groups, setGroups] = useState<PluginGroupItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [installed, setInstalled] = useState<InstalledMap>(new Map());
  /**
   * Every skill in the Project, unioned over its Agents (null until loaded).
   *
   * This is what the catalog tab lists. The plugin library below it answers a different question
   * — what *can* be installed — and it cannot answer "what is installed": a skill added straight
   * to one Agent belongs to no plugin, so it appeared in that Agent's tab and nowhere on this
   * page. Keeping both, under separate tabs, is what makes the difference legible instead of
   * merging "available" and "installed" into one list that is wrong about both.
   */
  const [catalog, setCatalog] = useState<InstalledSkillsResponse | null>(null);
  /** Collapsed groups (all expanded by default; same convention as the model page's provider groups). */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Library list: readable once logged in, fetched once on page entry.
  useEffect(() => {
    let cancelled = false;
    setError(null);
    api
      .getPluginLibrary()
      .then((res) => {
        if (!cancelled) setGroups(res.groups);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(apiErrorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Re-read the plugin library. Exposed because a credential write can change what the listing
   * says (see the detail Modal's credential section), and the card's key glyph is drawn from
   * `requiredEnvReady`, which the server resolves per request rather than caching.
   *
   * Not re-run on every render — the mount effect below is the page's one initial read, and this
   * exists so a specific action can ask for a fresh one afterwards.
   */
  const reloadLibrary = useCallback(() => {
    let cancelled = false;
    api
      .getPluginLibrary()
      .then((res) => {
        if (!cancelled) setGroups(res.groups);
      })
      .catch(() => {
        // A failed refresh keeps the previous list: it is stale rather than wrong, and blanking
        // the whole page would be a worse answer than a glyph that has not turned yet.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Installed skills and hook packages for every Agent in the current Project (fetched in
  // parallel, same convention as the sessions context): a single Agent's failure is silently
  // treated as "nothing installed" and doesn't break the whole page.
  const agentIdsKey = agents.map((a) => a.agentId).join(",");
  useEffect(() => {
    // Clear the snapshot before fetching: agentId (e.g. default_agent) is
    // reused across Projects, and leftover state from the previous project
    // would otherwise overwrite the new data when merged below, leaving the
    // page permanently showing the old project's install state.
    setInstalled(new Map());
    if (!projectId || agentIdsKey === "") return;
    let cancelled = false;
    const ids = agentIdsKey.split(",");
    void Promise.all(
      ids.map(async (agentId) => {
        try {
          const [skills, hooks] = await Promise.all([
            api.getAgentSkills(projectId, agentId),
            api.getAgentHooks(projectId, agentId),
          ]);
          return [agentId, installsOf(skills.skills, hooks.hooks)] as const;
        } catch {
          return [agentId, NO_INSTALLS] as const;
        }
      }),
    ).then((entries) => {
      // Merge instead of replacing the whole table: an Agent the user has
      // already interacted with during the fetch keeps its interaction result
      // (an optimistic state or an install/uninstall response is newer than
      // this mount-time snapshot), so a late-arriving initial snapshot never
      // regresses the UI.
      if (!cancelled)
        setInstalled((prev) => {
          const next = new Map<string, AgentInstalls>(entries);
          for (const [agentId, m] of prev) next.set(agentId, m);
          return next;
        });
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, agentIdsKey]);

  /** Rewrite one Agent's snapshot entry in place (shared by optimistic updates, install responses and failure rollback). */
  const setAgentInstalls = (agentId: string, installs: AgentInstalls) =>
    setInstalled((prev) => new Map(prev).set(agentId, installs));

  /**
   * Re-read the catalog. Called after any install or uninstall, since both change which Agents
   * hold a skill — the per-plugin `installed` map updates optimistically, but the catalog's
   * union has to be rebuilt from the server to stay truthful about the other Agents.
   */
  const reloadCatalog = useCallback(() => {
    if (!projectId) {
      setCatalog(null);
      return;
    }
    let cancelled = false;
    void api
      .getInstalledSkills(projectId)
      .then((res) => {
        if (!cancelled) setCatalog(res);
      })
      .catch((e: unknown) => {
        // The catalog tab degrades to empty rather than taking the page down: the plugin library
        // below it is a separate request and stays usable.
        if (!cancelled) setError(apiErrorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => reloadCatalog(), [reloadCatalog]);

  /**
   * Each installed plugin's own category, so a bundled Skill inherits its plugin's filing instead
   * of being uncategorised purely for having arrived through one.
   *
   * Read from the **same** filing store the Skills write to, keyed by the plugin's scoped id — one
   * taxonomy, one place. A separate map for plugins would be a second answer to "what category is
   * this in", and the two would disagree the first time a user filed the same thing twice.
   */
  const installedPluginCategories = useMemo(() => {
    const out: Record<string, string> = {};
    const filings = userId === null ? {} : loadFilings(userId);
    for (const p of catalog?.plugins ?? []) {
      const filed = filings[scopedId("plugin", p.name)];
      if (filed !== undefined && filed !== null) out[p.name] = filed;
    }
    return out;
  }, [catalog, userId]);

  // The rename candidates, fetched only while the installed page is open — it is a Project-wide
  // read and the page is the only surface that offers the fix. An error leaves the list null, so
  // the banner simply does not appear: no renameable Skills is indistinguishable from "could not
  // check", and showing an empty "nothing to do" would claim a check that never succeeded.
  useEffect(() => {
    if (!showInstalled || !projectId) return;
    void api.getRenamableSkills(projectId).then(
      (res) => setLegacy(res.items),
      // Left as null, so the banner does not appear: "no renameable Skills" and "could not check"
      // are indistinguishable to the user, and claiming the first when it is the second would be
      // a wrong reassurance.
      () => setLegacy(null),
    );
  }, [showInstalled, projectId]);

  /**
   * One Agent's snapshot entry with a plugin marked present (at the library's version) or
   * absent — its skills and, when it ships one, its hook package, all at once.
   */
  const withPlugin = (installs: AgentInstalls, plugin: PluginItem, on: boolean): AgentInstalls => {
    const skills = new Map(installs.skills);
    const hooks = new Map(installs.hooks);
    for (const skill of plugin.skills) {
      if (on) skills.set(skill.name, plugin.version);
      else skills.delete(skill.name);
    }
    if (plugin.hooks.length > 0) {
      if (on) hooks.set(plugin.name, plugin.version);
      else hooks.delete(plugin.name);
    }
    return { skills, hooks };
  };

  /**
   * Install / uninstall on one Agent (any member can do this): optimistic update, a
   * confirmation toast on success, rollback plus a toast on failure. Install is one request for
   * the whole plugin; uninstall is **one plugin-level request**, not a DELETE per skill — a bundled
   * Skill lives inside its plugin's directory, so the per-skill endpoint has no path that reaches
   * it and a skill-by-skill uninstall would report success while removing nothing.
   *
   * The Agent list is re-read afterwards either way: the card's counts and its `pluginUpdates`
   * moved, and both are read off that list.
   */
  const toggleInstall = async (agentId: string, plugin: PluginItem, on: boolean) => {
    if (!projectId) return;
    const prev = installed.get(agentId) ?? NO_INSTALLS;
    setAgentInstalls(agentId, withPlugin(prev, plugin, on));
    const target = agents.find((a) => a.agentId === agentId);
    const agentName = target ? agentDisplayName(target) : agentId;
    try {
      if (on) {
        const res = await api.installAgentPlugins(projectId, agentId, [plugin.name]);
        setAgentInstalls(agentId, installsOf(res.skills, res.hooks));
        toastSuccess(
          `${S.plugins.installedToast(plugin.name, agentName)}${S.agent.takesEffectSuffix}`,
        );
      } else {
        // The hook package is not part of the plugin directory, so it is removed by its own
        // endpoint alongside the plugin — the plugin request clears the Skills, this clears the
        // hooks the plugin installed. A 404 means "already not installed", i.e. the state we were
        // heading for, so it must not fail the uninstall (otherwise the row would sit at
        // "Installed" whenever this page's snapshot is stale).
        const gone = (e: unknown) => {
          if (e instanceof ApiError && e.status === 404) return;
          throw e;
        };
        await api.uninstallPlugin(projectId, agentId, plugin.name);
        if (plugin.hooks.length > 0) {
          await api.uninstallAgentHook(projectId, agentId, plugin.name).catch(gone);
        }
        toastSuccess(
          `${S.plugins.uninstalledToast(plugin.name, agentName)}${S.agent.takesEffectSuffix}`,
        );
      }
    } catch (e) {
      setAgentInstalls(agentId, prev);
      toastError(apiErrorText(e));
      return;
    }
    void reloadAgents();
    reloadCatalog();
  };

  /**
   * Machine-level uninstall — the card's 卸载 button.
   *
   * Removes the plugin from this machine's disk, and the server reports which Agents had it so the
   * confirm can name them. Every affected Agent's install state is dropped locally too: leaving a
   * card claiming an Agent still has a plugin whose files no longer exist would be a lie the UI
   * tells until it is manually reloaded.
   */
  const deleteFromMachine = async (plugin: PluginItem) => {
    if (!projectId) return;
    try {
      const res = await api.deletePlugin(projectId, plugin.id);
      for (const agentId of res.affectedAgents) {
        setAgentInstalls(agentId, withPlugin(installed.get(agentId) ?? NO_INSTALLS, plugin, false));
      }
      reloadCatalog();
      void reloadAgents();
      toastSuccess(S.plugins.deletedToast(plugin.name));
    } catch (e) {
      toastError(apiErrorText(e));
    }
  };

  /**
   * Update reminder action: reinstall the current library copy on every outdated Agent
   * (install-again-is-update semantics). One success toast for the whole batch; on partial
   * failure the succeeded Agents keep their calibrated state and the first error is toasted.
   */
  const updateOutdated = async (name: string, agentIds: string[]) => {
    if (!projectId || agentIds.length === 0) return;
    const results = await Promise.allSettled(
      agentIds.map(async (agentId) => {
        const res = await api.installAgentPlugins(projectId, agentId, [name]);
        setAgentInstalls(agentId, installsOf(res.skills, res.hooks));
      }),
    );
    const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (!failed) toastSuccess(S.plugins.updatedToast(name, agentIds.length));
    else toastError(apiErrorText(failed.reason));
    // The outdated marks and the nav badge are both read off `AgentSummary.pluginUpdates`,
    // which this page's install map does not feed: without reloading the Agent list the dot
    // would survive the very update it led the user to. Runs after a partial failure too —
    // some Agent moved.
    void reloadAgents();
    reloadCatalog();
  };

  /**
   * The notice's bulk action: reinstall the library copy of every outdated plugin, on every
   * Agent behind on it — the per-card update, over the whole page. The per-card and per-Agent
   * controls are untouched and remain the way to update just one.
   *
   * `Promise.allSettled` over one request per Agent, the shape the per-plugin update already
   * uses, and the same reload afterwards: the gate reads `AgentSummary.pluginUpdates`, which
   * this page's install map does not feed, so without it the dot would survive the very update
   * it led the user to. What is new is that a partial failure NAMES the Agents that did not take
   * it — on a control whose whole point is "all of them at once", a first-error toast leaves the
   * user unable to tell which half they are looking at.
   */
  const runBulkUpdate = async (plan: PluginUpdatePlan) => {
    if (!projectId || plan.perAgent.length === 0) return;
    setBulkRunning(true);
    const labels = plan.perAgent.map(({ agentId }) => {
      const agent = agents.find((a) => a.agentId === agentId);
      return agent ? agentDisplayName(agent) : agentId;
    });
    const results = await Promise.allSettled(
      plan.perAgent.map(async ({ agentId, names }) => {
        const res = await api.installAgentPlugins(projectId, agentId, names);
        setAgentInstalls(agentId, installsOf(res.skills, res.hooks));
      }),
    );
    const outcome = bulkOutcome(labels, results);
    if (outcome.allOk) toastSuccess(S.todo.bulkDone(outcome.ok));
    else {
      toastError(
        `${S.todo.bulkPartial(outcome.ok, failedList(outcome.failed, S.todo.listSeparator))} — ${apiErrorText(firstFailure(results))}`,
      );
    }
    // Runs after a partial failure too — some Agent moved, and the gate has to see it. Guarded,
    // because `reloadAgents` rejects on a failed list read and the busy flag disables every
    // control here, the dialog's Cancel included: a reload that failed after the writes landed
    // would otherwise leave the page frozen with nothing saying why.
    try {
      await reloadAgents();
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBulkRunning(false);
      setPendingBulk(null);
    }
    reloadCatalog();
  };

  /**
   * Quick start: pre-selects one of the plugin's skills in the draft cache (the `skills`
   * field, used by ChatInput as its initial selection on mount), pre-fills the invocation text
   * per UI language (overwriting any existing draft body — quick start's intent is
   * unambiguous, and leftover draft text would only be noise here), and opens the draft on the
   * currently selected Agent — the route state carries its agentId explicitly. handoffAgentId
   * must be cleared: a leftover handoff target would forward the whole skill invocation to a
   * different Agent. The button is gated on the current Agent having the skill (see
   * PluginCard.quickStartSkill), so agentId is present here.
   */
  const quickInvoke = (skillName: string) => {
    const agentId = currentAgent?.agentId;
    if (!agentId) return;
    if (userId && projectId) {
      // Typed-but-unsent draft text becomes a parked draft conversation instead of being
      // clobbered by the canned invocation body (draft-sessions.ts).
      parkActiveDraft(userId, projectId);
      const key = draftKey(userId, projectId);
      saveDraft(key, {
        ...loadDraft(key),
        agentId,
        text: S.skills.quickInvokeText(skillName),
        skills: [skillName],
        handoffAgentId: undefined,
      });
    }
    setCurrentAgentId(agentId);
    navigate(`/chat/${DRAFT_SESSION_ID}`, { state: { agentId } });
  };

  /**
   * "Add skill": opens a chat on the Agent selected up top to run the install prompt for
   * whatever source was typed. Mirrors quickInvoke — the draft cache is the same mechanism —
   * with two differences that matter: the text is the generated install prompt rather than a
   * canned invocation body, and `skills` is cleared because installing a skill is not invoking
   * one (a leftover pre-selection would ride along). `handoffAgentId` is cleared for the same
   * reason quickInvoke clears it: a stale handoff target would forward the install prompt to a
   * different Agent than the one selected here.
   */
  const openSkillImportChat = () => {
    const agentId = currentAgent?.agentId;
    const trimmed = importSource.trim();
    if (!agentId || trimmed === "") return;
    if (userId && projectId) {
      parkActiveDraft(userId, projectId);
      const key = draftKey(userId, projectId);
      saveDraft(key, {
        ...loadDraft(key),
        agentId,
        text: buildImportPrompt(trimmed),
        skills: [],
        handoffAgentId: undefined,
      });
    }
    setCurrentAgentId(agentId);
    setImportOpen(false);
    navigate(`/chat/${DRAFT_SESSION_ID}`, { state: { agentId } });
  };

  /**
   * The library narrowed by the search box: a plugin matches on its name and on whichever
   * description applies to the active language, and a category left with no match drops out
   * entirely — an empty group header is noise, and browsing by category is still the point
   * of the page, so the query narrows what is there instead of replacing it with a flat list.
   */
  /**
   * The library narrowed by the search box: a plugin matches on its name and on whichever
   * description applies to the active language, and a category left with no match drops out
   * entirely — an empty group header is noise, and browsing by category is still the point
   * of the page, so the query narrows what is there instead of replacing it with a flat list.
   *
   * Only the plugin view uses this. The skill and hook views are flat and do not go through a
   * category at all (see {@link flatLibraryCards}), so mixing the two shapes into one variable
   * would put a union on every read below for no gain.
   */
  const visibleGroups = useMemo(() => {
    if (groups === null || libraryView !== "plugins") return null;
    const q = query.trim().toLowerCase();
    const byCategory = groupFilter === null ? groups : groups.filter((g) => g.id === groupFilter);
    // The origin tab narrows the list too. It used to only change which pill was filled while the
    // cards below stayed as they were, which reads as a broken control: a tab that says 「用户安装」
    // and then shows every built-in plugin is worse than having no tab at all.
    //
    // Every library plugin is **built-in** — the library ships with the product and nothing has been
    // added to it by anyone, which is why 「用户安装」 counts 0. Saying so in one place means the
    // day a user plugin can actually be added, this is the single line that changes.
    const byOrigin =
      originFilter === "all" || originFilter === "builtin"
        ? byCategory
        : byCategory
            .map((group) => ({ ...group, plugins: [] as PluginItem[] }))
            .filter((group) => group.plugins.length > 0);
    if (q === "") return byOrigin;
    return byOrigin
      .map((group) => ({
        ...group,
        plugins: group.plugins.filter((plugin) =>
          [plugin.name, localizedText(locale, plugin.description, plugin.descriptionZh)]
            .join(" ")
            .toLowerCase()
            .includes(q),
        ),
      }))
      .filter((group) => group.plugins.length > 0);
  }, [groups, query, locale, groupFilter, libraryView, originFilter]);

  /**
   * Library plugins by origin, for the filter tabs.
   *
   * Counted over the whole library rather than over `visibleGroups`, because a count that shifted
   * with the other filters would be circular: the tab you are deciding whether to click would
   * already have applied that filter. It is also counted before the category and query cuts, for
   * the same reason — the tabs answer "what would I get", not "what is on screen".
   *
   * A library plugin is **built-in**: it ships with the product and was not added by anyone. That
   * is the whole distinction here, so the counts are structural rather than stored — the server
   * has no origin field on a library plugin because there is nothing to record.
   */
  const originCounts = useMemo(() => {
    if (groups === null) return { all: 0, builtin: 0, user: 0, bundled: 0 };
    const out = { all: 0, builtin: 0, user: 0, bundled: 0 };
    for (const group of groups) {
      for (const plugin of group.plugins) {
        out.all += 1;
        out.builtin += 1;
      }
    }
    return out;
  }, [groups]);

  /**
   * The skill and hook views as one flat card list.
   *
   * Flat rather than per category: a skill belongs to a plugin, but the question here is "which
   * skill do I want", and nesting that answer under categories buries it a level deeper than it
   * needs to be. The owning plugin rides on each card's meta line, so the relationship is stated
   * without being the structure.
   *
   * A hook package is identified by its plugin — `installHook` writes `hooks/<plugin name>/` — so
   * one card per plugin that ships one, naming the hook points it answers at rather than a
   * description it has none of.
   */
  const flatLibraryCards = useMemo<LibraryCardEntry[]>(() => {
    if (groups === null || libraryView === "plugins") return [];
    const q = query.trim().toLowerCase();
    const cards: LibraryCardEntry[] = [];
    for (const group of groupFilter === null
      ? groups
      : groups.filter((g) => g.id === groupFilter)) {
      for (const plugin of group.plugins) {
        if (libraryView === "skills") {
          for (const skill of plugin.skills) {
            cards.push({
              key: skill.name,
              name: skill.name,
              description: localizedText(locale, skill.description, skill.shortDescriptionZh),
              ...(skill.icon !== undefined ? { icon: skill.icon } : {}),
              meta: plugin.name,
            });
          }
        } else if (plugin.hooks.length > 0) {
          cards.push({
            key: plugin.name,
            name: plugin.name,
            description: localizedText(locale, plugin.description, plugin.descriptionZh),
            ...(plugin.icon !== undefined ? { icon: plugin.icon } : {}),
            meta: S.plugins.hookPoints(plugin.hooks),
          });
        }
      }
    }
    if (q === "") return cards;
    return cards.filter((card) =>
      [card.name, card.description, card.meta].join(" ").toLowerCase().includes(q),
    );
  }, [groups, query, locale, groupFilter, libraryView]);

  /**
   * The catalog narrowed by the same search box, on the same terms as the library above it: name
   * and the description that applies to the active language. Memoized for the same reason — the
   * filter runs on every render of a tab that re-renders whenever an install changes `installed`.
   */
  /**
   * How many skills are installed in total, across the plugins and the standalone ones.
   *
   * Counts **skills**, not install units: a plugin carrying four skills is four skills, and this
   * number is what the marketplace pill and the installed page title both claim. Counting cards
   * instead would be the same confusion the grouping exists to remove — 19 skills shown as 11
   * would put the original question straight back.
   */
  const installedCount = useMemo(() => {
    if (catalog === null) return null;
    return catalog.plugins.reduce((n, p) => n + p.skills.length, 0) + catalog.skills.length;
  }, [catalog]);

  /**
   * How many library plugins the currently selected Agent has. Per Agent rather than per
   * user — installation is an Agent's own state, so a count that ignored which Agent is
   * selected would be a number about nothing.
   */
  // The installed-skills page replaces the marketplace wholesale rather than sitting beside it:
  // a back arrow and its own title bar say "you went somewhere", and two lists of skills on one
  // scroll is how the marketplace and the inventory get read as one.
  if (showInstalled) {
    return (
      <InstalledSkillsPage
        catalog={catalog}
        query={installedQuery}
        onQueryChange={setInstalledQuery}
        onBack={() => {
          setInstalledQuery("");
          setShowInstalled(false);
        }}
        agentNamesOf={(ids) => agentNamesOf(ids, agents)}
        // `null` upstream means "no Project chosen"; the page reads that as absent rather than
        // passing a null through as a string.
        projectId={projectId ?? undefined}
        legacy={legacy}
        reloadCatalog={reloadCatalog}
      />
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-6xl">
        {/* One bar, as the reference layout has it: the switcher on the left, the active tab's
            search and its own count on the right. No page heading above them — the nav entry
            already says where you are, and the tabs say what is behind it. The description
            moves into the help fold below, because a circled "?" is an anchored mark and there
            is no title left for it to anchor to (see disclosure-anchor.test.ts). */}
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
          <Tabs
            items={[
              // Three top-level kinds, exactly as the reference has them. 插件 is the packaging unit (skills,
              // hooks, or both — installable whole); 技能 is a standalone instruction, and per the
              // reference's own note the skills *inside* a plugin are NOT listed here, only the
              // independent ones; 连接器 is an external MCP service.
              //
              // The reference's second row (插件 / 技能 / 钩子) is annotated 去掉 — it duplicated
              // the top tabs with a coarser split, and 钩子 could never have been installable on
              // its own (a hook ships inside a plugin), so its presence implied an action that
              // does not exist. `libraryView` now drives only the flat skill/hook rendering that
              // the top tabs select between.
              { key: "plugins", label: S.plugins.tabPlugins },
              { key: "skills", label: S.plugins.tabSkills },
              { key: "connectors", label: S.plugins.tabConnectors },
            ]}
            active={tab}
            onChange={(key) => {
              setTab(key);
              // The flat views hang off the top tabs now: 技能 shows standalone skills, and the
              // plugin list is the categorised grid. Kept in one place so the two can never
              // disagree about which is on screen.
              setLibraryView(key === "plugins" ? "plugins" : "skills");
            }}
            variant="pill"
          />
          <span className="min-w-0 flex-1" />
          <div className="flex min-w-0 items-center gap-2">
            {/* ONE search for the whole page, and it lives here — in the top bar, beside the tabs
                it filters. It used to be duplicated inside the skills tab as well, which put two
                identical 「搜索技能」 boxes on one screen; two boxes bound to the same state is worse
                than one, because editing the "other" one silently does nothing. */}
            <div className="w-40 sm:w-56">
              <Input
                size="sm"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={
                  tab === "connectors"
                    ? S.plugins.searchConnectorsPlaceholder
                    : S.plugins.searchPlaceholder
                }
                aria-label={
                  tab === "connectors" ? S.plugins.searchConnectorsLabel : S.plugins.searchLabel
                }
              />
            </div>
            {/* The installed-skills count is a **button**, not a badge: the reference layout has it
                open a full-screen page of what is installed. A count you cannot click cannot be
                the door to that page, and leaving it inert is why "installed 19" sat on the
                catalog tab while nothing on screen showed what those 19 were. */}
            {installedCount !== null && (
              <button
                type="button"
                onClick={() => setShowInstalled(true)}
                title={S.plugins.installedTitle(installedCount)}
                className="shrink-0 whitespace-nowrap rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 transition-colors hover:border-gray-300 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-bg)] dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-gray-700 dark:hover:bg-gray-800"
              >
                {S.plugins.installedTitle(installedCount)}
              </button>
            )}
            {/* The add button is the page's one action, so it takes the same slot on every tab —
                skills, plugins and connectors alike. Three tabs that each put their add control
                somewhere else is the kind of inconsistency a user has to re-learn per tab. */}
            {tab === "skills" && (
              <Button
                size="sm"
                variant="primary"
                className="shrink-0 whitespace-nowrap"
                disabled={currentAgent === null}
                title={
                  currentAgent === null ? S.plugins.addSkillNeedsAgent : S.plugins.addSkillHint
                }
                onClick={() => {
                  setImportSource("");
                  setImportOpen(true);
                }}
              >
                <PlusIcon size={13} strokeWidth={1.7} />
                {S.plugins.addSkill}
              </Button>
            )}
            {tab === "plugins" && (
              <>
                <Button
                  size="sm"
                  variant="primary"
                  className="shrink-0 whitespace-nowrap"
                  title={S.plugins.addPluginHint}
                  onClick={() => setAddOpen(true)}
                >
                  <PlusIcon size={13} strokeWidth={1.7} />
                  {S.plugins.addPlugin}
                </Button>
                {/* How the library is tagged — the same dialog the skills tab opens, over the same
                    stored tags, so filing a plugin here and a skill there lands in one place. */}
                <Button
                  size="sm"
                  variant="secondary"
                  className="shrink-0 whitespace-nowrap"
                  title={S.plugins.manageCategoriesHint}
                  onClick={() => setTagsOpen(true)}
                >
                  {S.plugins.manageCategories}
                </Button>
              </>
            )}
            {tab === "connectors" && (
              /* The connectors registry owns its own add dialog, so this opens that one rather
                 than a second path to the same thing — two buttons reaching the same dialog is
                 indistinguishable from two different actions. */
              <Button
                size="sm"
                variant="primary"
                className="shrink-0 whitespace-nowrap"
                title={S.plugins.addConnectorHint}
                onClick={() => setConnectorsAddNonce((n) => n + 1)}
              >
                <PlusIcon size={13} strokeWidth={1.7} />
                {S.plugins.addConnector}
              </Button>
            )}
          </div>
        </div>
        {tab === "connectors" ? (
          <div className="mt-6">
            <ConnectorsTab
              query={query}
              originFilter={originFilter}
              setOriginFilter={setOriginFilter}
              addNonce={connectorsAddNonce}
            />
          </div>
        ) : tab === "skills" && catalog !== null ? (
          /* Bundled skills ARE listed here, badged 「插件捆绑」 and separately filterable — this was
             a reported bug: the 「插件捆绑」 tab sat permanently at 0 because only standalone
             skills were passed. (The reference's note that bundled skills are not repeated here
             is read as "not given their own top-level card", not "absent from the list": the
             requirement for a bundled filter only means something if they appear.)

             Lifted from each plugin's `skills` with the plugin's name and Agents attached, so the
             tab can tell a bundled skill from a standalone one and the impact dialog can name who
             would be affected. `pluginName` is what marks it — the same field the server records. */
          <div className="mt-6">
            <SkillsTab
              skills={[
                ...catalog.skills,
                ...catalog.plugins.flatMap((p) =>
                  p.skills.map((s) => ({
                    ...s,
                    origin: "library" as const,
                    pluginName: p.name,
                    inferred: false,
                    agents: p.agents,
                  })),
                ),
              ]}
              agentNames={agentNameMap}
              query={query}
              originFilter={originFilter}
              setOriginFilter={setOriginFilter}
              pluginCategories={installedPluginCategories}
            />
          </div>
        ) : (
          <>
            {/* Last stop on the plugins trail: what the sidebar's dot was pointing at, the control
            that takes all of it in one press, and the way to clear it for someone who has looked
            and decided to stay on the installed copies. A plugin is never NEW here — one nobody
            has installed is not waiting for anyone — so the line states the upgradable count
            alone rather than padding it with a zero. The per-card update buttons below remain
            the way to take just one. */}
            {todo && (
              <TodoNotice
                text={S.todo.changesUpgradable(noticeCounts(todo).updated)}
                actionLabel={S.todo.updateNow}
                busy={bulkRunning}
                onAction={() => setPendingBulk(pluginUpdatePlan(agents))}
                dismissLabel={S.todo.dismiss}
                onDismiss={() => dismissTodo(projectId, "plugins", todo.signature)}
              />
            )}

            {error ? (
              <div className="mt-6 flex items-center gap-3">
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                <Button size="sm" onClick={() => window.location.reload()}>
                  {S.common.retry}
                </Button>
              </div>
            ) : groups === null ? (
              <div className="mt-6 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }, (_, i) => (
                  <SkeletonCard key={i} className="p-4">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="mt-2 h-4 w-3/4" />
                    <Skeleton className="mt-3 h-6 w-36" />
                  </SkeletonCard>
                ))}
              </div>
            ) : libraryView !== "plugins" ? (
              /* The skill and hook views are one grid, not categories: the question is "which one
                 do I want", and answering it one category deep would bury it. The owning plugin
                 rides on each card's meta line, so the relationship is stated without being the
                 structure. */
              <div className="mt-5 grid grid-cols-1 gap-2.5 p-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {flatLibraryCards.map((card) => (
                  <LibraryCard
                    key={card.key}
                    icon={card.icon}
                    name={card.name}
                    fallbackIcon={libraryView === "hooks" ? HOOK_ICON : BOOK_ICON}
                    description={card.description}
                    meta={card.meta}
                  />
                ))}
              </div>
            ) : visibleGroups === null ? (
              <p className="mt-6 text-sm text-gray-500 dark:text-gray-400">
                {S.plugins.noMatch(query.trim())}
              </p>
            ) : (
              <div className="mt-5">
                {/* What kind of thing is listed, as the reference layout has it: three peer tabs
                    over one grid. They are peers because a plugin, a single skill and a hook are
                    three separate things to look for — a bundle, one unit of it, and something
                    with no skill at all. Category chips stay below them and only narrow within the
                    active view. */}
                {/* Category chips, as the reference layout has them: one row of categories, the
                    active one filled. Selecting a chip narrows to that category — the same
                    relationship the search box has to the cards, one level up. Hidden for the flat
                    views, where there is no category grouping left to narrow. */}
                {libraryView === "plugins" && (
                  <div className="mt-4">
                    {/* Origin first, then category: origin answers "is this mine or the product's",
                        category answers "what kind". Origin is the coarser cut, so it sits above —
                        and the category row below hides itself when a category has nothing left in
                        it, rather than offering a chip that leads to an empty section. */}
                    <OriginFilterTabs
                      value={originFilter}
                      onChange={setOriginFilter}
                      filters={filtersFor(false)}
                      counts={originCounts}
                    />
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setGroupFilter(null)}
                        className={chipClass(groupFilter === null)}
                      >
                        {S.plugins.allCategories}
                      </button>
                      {(groups ?? []).map((group) => (
                        <button
                          key={group.id}
                          type="button"
                          onClick={() => setGroupFilter(groupFilter === group.id ? null : group.id)}
                          className={chipClass(groupFilter === group.id)}
                        >
                          {localizedText(locale, group.title, group.titleZh)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-6 space-y-7">
                  {(visibleGroups ?? []).map((group) => {
                    const open = !collapsed.has(group.id);
                    return (
                      <section key={group.id}>
                        {/* Section heading: a plain bold title with the count beside it, the way the
                        reference lays its sections out — no tinted bar and no box around the cards,
                        so the grid itself is the grouping. The whole row still toggles collapse. */}
                        <button
                          type="button"
                          aria-expanded={open}
                          onClick={() =>
                            setCollapsed((prev) => {
                              const next = new Set(prev);
                              if (next.has(group.id)) next.delete(group.id);
                              else next.add(group.id);
                              return next;
                            })
                          }
                          className="flex w-full items-center gap-2.5 py-1 text-left"
                        >
                          {/* Group name can truncate (min-w-0): the count and collapse arrow must not shrink. */}
                          <span className="min-w-0 truncate text-base font-semibold">
                            {localizedText(locale, group.title, group.titleZh)}
                          </span>
                          <span className="shrink-0 whitespace-nowrap font-mono text-xs text-gray-400">
                            {S.plugins.pluginCount(group.plugins.length)}
                          </span>
                          <span className="min-w-0 flex-1" />
                          <Chevron open={open} className="text-gray-400" />
                        </button>

                        {/* Expand/collapse height transition: grid-template-rows tweens between
                        0fr and 1fr, with the inner overflow-hidden clipping the content
                        (same convention as the model page). */}
                        <div
                          className={`grid transition-[grid-template-rows] duration-200 ease-out ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
                        >
                          {/* inert while collapsed: cards at zero height shouldn't still be Tab-focusable or clickable. */}
                          <div className="overflow-hidden" inert={!open}>
                            {/* Cards: 3 columns ≥lg, 2 ≥sm, 1 on narrow screens. `grid-cols-1` is
                            load-bearing, not redundant: with no declared track the single implicit
                            column is `auto`-sized, and an auto track never goes below
                          the widest card's min-content width — which `truncate` does not lower,
                          since `nowrap` leaves no wrap opportunity and `overflow: hidden` only
                          clips at paint time. A card then overflows the section's `overflow-hidden`
                          and its action buttons land off-viewport, unreachable. Tailwind's
                          `grid-cols-*` is `minmax(0, 1fr)`, which clamps that floor to 0. */}
                            <div
                              className={`grid grid-cols-1 gap-2.5 p-2.5 transition-opacity duration-200 sm:grid-cols-2 lg:grid-cols-3 ${open ? "opacity-100" : "opacity-0"}`}
                            >
                              {group.plugins.map((plugin) => (
                                <PluginCard
                                  key={plugin.name}
                                  plugin={plugin}
                                  installed={installed}
                                  onQuickInvoke={quickInvoke}
                                  onToggleInstall={toggleInstall}
                                  onUpdateOutdated={updateOutdated}
                                  onDeleteFromMachine={deleteFromMachine}
                                  onRefreshLibrary={reloadLibrary}
                                />
                              ))}
                            </div>
                          </div>
                        </div>
                      </section>
                    );
                  })}

                  {/* The empty state lives *inside* the list, below the origin tabs — never in
                      place of them. An empty result is the state in which a user most needs to
                      change the filter that produced it, so a tab row that disappears with the
                      content it filters leaves them with no way back and no explanation. */}
                  {visibleGroups !== null && visibleGroups.length === 0 && (
                    <p className="mt-6 text-sm text-gray-500 dark:text-gray-400">
                      {S.plugins.noMatch(query.trim())}
                    </p>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Bulk update confirmation. Same warning as the per-plugin confirm — an update is an
          overwriting reinstall — and the same primary (overwrite) tone, with the list naming
          every plugin the batch would rewrite. Confirm-first is the point of the button: it
          overwrites many installs in one press, and a single one already asks. */}
      {/* Add-a-skill: the same source dialog the Agent's Skills tab opens, minus its archive
          upload — that one writes to an Agent's own directory, which this page has no way to
          name. The chat it opens lands on the Agent selected up top. */}
      <SkillImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        source={importSource}
        onSourceChange={setImportSource}
        onOpenChat={openSkillImportChat}
      />

      {/* The plugin tab's 插件来源 button opens the sources manager. */}
      {/* Tag management over the library, the same dialog and the same stored tags the skills tab
          uses. Rendered unconditionally so a rename here is reflected there without a reload. */}
      <CategoryManagerDialog
        open={tagsOpen}
        onClose={() => setTagsOpen(false)}
        categories={categories}
        filings={filings}
        onCreate={(name) => persistCategories([...categories, newCategory(name)])}
        onRename={(cid, name) =>
          persistCategories(categories.map((c) => (c.id === cid ? { ...c, name } : c)))
        }
        onDelete={(cid) => persistCategories(removeCategory(categories, cid, filings).categories)}
      />

      {/* Add plugin: from a URL, an archive, or one already on this machine. The library is reloaded
          on success because the import writes into the store `loadPluginGroups` reads — the new
          plugin is not in the data this page already has, and the alternative (patching the list
          from the name we got back) would re-implement the reader the server already ran. */}
      {addOpen && projectId !== null && (
        <AddPluginDialog
          projectId={projectId}
          onClose={() => setAddOpen(false)}
          onImported={() => {
            setAddOpen(false);
            void reloadCatalog();
          }}
        />
      )}
      {pendingBulk !== null && (
        <ConfirmModal
          open
          title={S.todo.pluginsConfirmTitle(pendingBulk.plugins.length)}
          tone="primary"
          confirmLabel={S.skills.updateAction}
          busy={bulkRunning}
          onClose={() => setPendingBulk(null)}
          onConfirm={() => void runBulkUpdate(pendingBulk)}
        >
          <div className="space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-300">{S.todo.pluginsConfirmBody}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">{S.todo.willTouch}</p>
            <ul className="max-h-60 divide-y divide-gray-100 overflow-y-auto rounded-md border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
              {pendingBulk.plugins.map((name) => (
                <li key={name} className="px-3 py-1.5 font-mono text-xs">
                  {name}
                </li>
              ))}
            </ul>
          </div>
        </ConfirmModal>
      )}
    </div>
  );
}

/**
 * Display names for the Agents a skill is installed on, in the order the catalog returned them.
 *
 * Uses the app's own `agentDisplayName`, which falls back to the raw id — so an Agent deleted
 * since the catalog was fetched still reads as its id rather than as a blank.
 */
/**
 * One card in the flat skill / hook views.
 *
 * Declared here rather than inline because `visibleGroups` returns two different shapes (category
 * groups for the plugin view, this flat list for the other two) and the render branch casts to it
 * — one named type is what keeps that cast honest.
 */
type LibraryCardEntry = {
  key: string;
  name: string;
  description: string;
  icon?: string;
  meta: string;
};

function agentNamesOf(agentIds: readonly string[], agents: readonly AgentSummary[]): string[] {
  return agentIds.map((id) => {
    const found = agents.find((a) => a.agentId === id);
    return found === undefined ? id : agentDisplayName(found);
  });
}

/**
 * The installed-skills page: everything this Project has, grouped by install unit.
 *
 * Laid out as the reference page is — back arrow, the count in the title, its own search on the
 * right, then one section per kind of install. The count is a heading rather than a pill because on
 * this page it *is* the subject; the marketplace keeps the pill as the way in.
 *
 * The grouping is the content, not decoration. A plugin carrying four skills is one install, and
 * showing it as one card is what makes "19 skills" and "11 plugins" reconcile instead of looking
 * like eight missing.
 */
function InstalledSkillsPage({
  catalog,
  query,
  onQueryChange,
  onBack,
  agentNamesOf,
  projectId,
  legacy,
  reloadCatalog,
}: {
  catalog: InstalledSkillsResponse | null;
  query: string;
  onQueryChange: (next: string) => void;
  onBack: () => void;
  agentNamesOf: (ids: readonly string[]) => string[];
  /** The Project these Skills belong to; the rename's scope. */
  projectId: string | undefined;
  /** Installed Skills the library has since renamed, or null while unknown. */
  legacy: readonly api.RenamableSkill[] | null;
  /** Re-reads the catalog, so a rename's effect is shown rather than assumed. */
  reloadCatalog: () => void;
}) {
  const { locale } = useLocale();
  const total =
    catalog === null
      ? 0
      : catalog.plugins.reduce((n, p) => n + p.skills.length, 0) + catalog.skills.length;

  // Filtering happens before grouping, and a match inside a plugin keeps the plugin card: the
  // install unit is the thing being described, so a hit on one of its skills should not scatter
  // the card's other members across the page.
  const { plugins, skills } = useMemo(() => {
    if (catalog === null) return { plugins: [], skills: [] };
    const q = query.trim().toLowerCase();
    const hit = (name: string, text: string) => `${name} ${text}`.toLowerCase().includes(q);
    return {
      plugins: catalog.plugins.filter(
        (p) =>
          q === "" ||
          hit(p.name, localizedText(locale, p.description, p.descriptionZh)) ||
          p.skills.some((s) =>
            hit(s.name, localizedText(locale, s.description, s.shortDescriptionZh)),
          ),
      ),
      skills: catalog.skills.filter(
        (s) => q === "" || hit(s.name, localizedText(locale, s.description, s.shortDescriptionZh)),
      ),
    };
  }, [catalog, query, locale]);

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-6xl">
        {/* The reference page's top row: back, title-with-count, then the search. The title is the
            count, so it is a heading rather than a pill — nothing else here competes to be the
            subject. */}
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            aria-label={S.plugins.back}
            title={S.plugins.back}
            className="shrink-0 rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-bg)] dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
          >
            <ArrowLeftIcon size={18} strokeWidth={1.8} />
          </button>
          <h2 className="min-w-0 truncate text-base font-semibold text-gray-900 dark:text-gray-100">
            {S.plugins.installedTitle(total)}
          </h2>
          <span className="min-w-0 flex-1" />
          <div className="flex min-w-0 items-center gap-2">
            <div className="w-40 sm:w-56">
              <Input
                size="sm"
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder={S.plugins.searchInstalledPlaceholder}
                aria-label={S.plugins.searchInstalledLabel}
              />
            </div>
          </div>
        </div>
        {catalog === null ? (
          <div className="mt-6 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <SkeletonCard key={i} className="p-4">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="mt-2 h-4 w-3/4" />
                <Skeleton className="mt-3 h-6 w-36" />
              </SkeletonCard>
            ))}
          </div>
        ) : plugins.length === 0 && skills.length === 0 ? (
          // One empty state for both "nothing installed" and "nothing matched": telling them apart
          // needs a sentence about installing skills, which would be wrong advice for someone who
          // has skills and mistyped a filter.
          <p className="mt-6 text-sm text-gray-500 dark:text-gray-400">
            {catalog.plugins.length === 0 && catalog.skills.length === 0
              ? `${S.plugins.catalogEmpty}。${S.plugins.catalogEmptyHint}`
              : S.plugins.noMatch(query.trim())}
          </p>
        ) : (
          <div className="mt-6">
            <InstalledSkillsView
              plugins={plugins}
              skills={skills}
              agentNamesOf={agentNamesOf}
              projectId={projectId}
              legacy={legacy ?? undefined}
              onRenamed={() => void reloadCatalog()}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/** A single plugin card: metadata display (contents badges + a semantic metadata line) + update reminder + quick start + "manage installs" Modal. */
function PluginCard({
  plugin,
  installed,
  onQuickInvoke,
  onToggleInstall,
  onUpdateOutdated,
  onDeleteFromMachine,
  onRefreshLibrary,
}: {
  plugin: PluginItem;
  installed: InstalledMap;
  onQuickInvoke: (skillName: string) => void;
  onToggleInstall: (agentId: string, plugin: PluginItem, on: boolean) => Promise<void>;
  onUpdateOutdated: (name: string, agentIds: string[]) => Promise<void>;
  /** Machine-level uninstall: delete it from this machine's disk, and report who was using it. */
  onDeleteFromMachine: (plugin: PluginItem) => Promise<void>;
  /** Re-read the library listing, so the key glyph reflects a credential the user just saved. */
  onRefreshLibrary: () => void;
}) {
  const { locale } = useLocale();
  const { agents, currentAgent, currentProject } = useProject();
  const projectId = currentProject?.projectId;
  const [installOpen, setInstallOpen] = useState(false);
  // Agents pending an update confirmation (null = none): an update is an overwriting reinstall, so it needs a confirm + a per-agent version list before it runs.
  const [pendingUpdate, setPendingUpdate] = useState<string[] | null>(null);
  const [updating, setUpdating] = useState(false);
  /**
   * Awaiting confirmation of a **machine-wide** delete (false = not asking).
   *
   * Distinct from the per-Agent removal in 管理安装: this one takes the plugin off this machine's
   * disk, so every Agent that had it loses it at once. The confirm names those Agents, read from
   * the server when the confirm opens — a list computed at render time would be stale the moment
   * anything else changes, and a warning that under-reports is worse than none.
   */
  const [pendingDelete, setPendingDelete] = useState(false);
  /**
   * The Agents the pending delete would affect. Empty until the confirm opens.
   *
   * Computed from the page's install map at the moment the confirm opens, rather than fetched: the
   * map is re-read after every install action, so it is current, and the server independently
   * reports the same list on the delete itself — which is what makes the confirm trustworthy
   * rather than merely reassuring.
   */
  const [deleteAffects, setDeleteAffects] = useState<string[]>([]);
  /**
   * Agent pending a **per-Agent** removal from 管理安装 (null = not asking).
   *
   * A separate flag from `pendingDelete` on purpose: removing one Agent's copy keeps the plugin on
   * this machine, deleting the plugin does not. Sharing one flag would let a confirm opened for
   * one be confirmed as the other, and one of those two is irreversible.
   */
  const [pendingAgentRemove, setPendingAgentRemove] = useState<string | null>(null);
  /** In-flight machine delete, so a double click cannot land two. */
  const [deleting, setDeleting] = useState(false);
  /** Whether the current Agent has this plugin switched on; null while unknown. */
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [togglingEnabled, setTogglingEnabled] = useState(false);
  /**
   * The machine-level switch, seeded from the listing and then owned locally while a write is in
   * flight.
   *
   * `undefined` means "no local answer yet, use the listing's" — a null would be a third state the
   * listing cannot produce, and treating it as off would show every plugin as disabled until the
   * first write. The page re-reads the library on mount and after every install, so the server's
   * value is the baseline and this only overrides it between a click and its response.
   */
  const [machineOverride, setMachineOverride] = useState<boolean | undefined>(undefined);
  const [togglingMachine, setTogglingMachine] = useState(false);
  const setMachineEnabled = (next: boolean) => setMachineOverride(next);
  /** What the card's machine switch shows: the local answer while one exists, else the listing's. */
  const machineEnabled = machineOverride ?? plugin.enabled;

  // The switch's own state, read whenever the current Agent or the plugin changes. Kept separate
  // from the install snapshot because "installed" and "switched on" are different questions, and
  // answering the second from the first would make a disabled plugin look uninstalled.
  useEffect(() => {
    const agentId = currentAgent?.agentId;
    if (!projectId || agentId === undefined) {
      setEnabled(null);
      return;
    }
    let cancelled = false;
    void api
      .getInstalledPlugins(projectId, agentId)
      .then((res) => {
        if (cancelled) return;
        const entry = res.plugins.find((p) => p.name === plugin.name);
        setEnabled(entry?.enabled ?? null);
      })
      .catch(() => {
        // Unreadable is "unknown", not "off": showing the switch as on when it is off would be a
        // claim we cannot support, and hiding it would strand the user with no way back.
        if (!cancelled) setEnabled(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, currentAgent?.agentId, plugin.name]);

  /**
   * Switches the plugin on or off for **this machine**.
   *
   * The state lives on the card rather than being read back from a request: `plugin.enabled` is the
   * listing's answer and the listing is re-read on the next load, so a local copy plus a rollback is
   * enough and avoids a round trip to confirm a boolean the card already knows.
   *
   * **Every Agent's runtime is invalidated server-side** when this lands, so a Session that already
   * assembled its prompt stops offering the plugin without waiting to be evicted — the reason the
   * card can claim the change took effect rather than "at your next task".
   */
  const toggleMachineEnabled = async () => {
    if (togglingMachine) return;
    const next = !machineEnabled;
    setTogglingMachine(true);
    setMachineEnabled(next);
    try {
      const res = await api.setPluginEnabledMachine(plugin.id, next);
      setMachineEnabled(res.enabled);
      // Re-read the listing rather than only trusting the local copy: the per-Agent install
      // availability is drawn from it, and this is the one moment that changed.
      onRefreshLibrary();
      toastSuccess(
        `${next ? S.plugins.enabledToast(plugin.name) : S.plugins.disabledToast(plugin.name)}${S.agent.takesEffectSuffix}`,
      );
    } catch (e) {
      setMachineEnabled(machineEnabled);
      toastError(apiErrorText(e));
    } finally {
      setTogglingMachine(false);
    }
  };

  const toggleEnabled = async () => {
    const agentId = currentAgent?.agentId;
    if (!projectId || agentId === undefined || enabled === null || togglingEnabled) return;
    const next = !enabled;
    setEnabled(next);
    setTogglingEnabled(true);
    try {
      // Optimistic, like the install toggle; rolled back below on failure.
      const res = await api.setPluginEnabled(projectId, agentId, plugin.id, next);
      setEnabled(res.enabled);
    } catch (e) {
      setEnabled(enabled);
      toastError(apiErrorText(e));
      return;
    } finally {
      setTogglingEnabled(false);
    }
    toastSuccess(
      `${next ? S.plugins.enabledToast(plugin.name) : S.plugins.disabledToast(plugin.name)}${S.agent.takesEffectSuffix}`,
    );
  };

  const confirmUpdate = async () => {
    if (!pendingUpdate) return;
    setUpdating(true);
    await onUpdateOutdated(plugin.name, pendingUpdate);
    setUpdating(false);
    setPendingUpdate(null);
  };

  /**
   * Whether this plugin is an **added** one, i.e. one the user brought onto this machine.
   *
   * Read from the id's marketplace segment rather than from the library's own `origin` flag, because
   * the id is what the delete route checks before it will remove anything — if the two disagreed,
   * the button would offer a delete the server then refuses.
   */
  const isOnThisMachine = plugin.id.endsWith("@local");

  /**
   * Opens the machine delete confirm.
   *
   * The affected Agents are computed here from the page's own install map rather than fetched: the
   * map is re-read after every install action, so it is current, and a delete is rare enough that
   * the extra request would buy nothing. The server independently reports the same list on the
   * delete itself, which is what makes the confirm trustworthy rather than merely informative.
   */
  const confirmMachineDelete = () => {
    const affected: string[] = [];
    for (const [agentId, installs] of installed) {
      if (pluginInstalled(plugin, installs)) affected.push(agentId);
    }
    setDeleteAffects(affected);
    setPendingDelete(true);
  };

  const runMachineDelete = async () => {
    setDeleting(true);
    try {
      await onDeleteFromMachine(plugin);
      setPendingDelete(false);
      setDeleteAffects([]);
    } finally {
      setDeleting(false);
    }
  };

  let installedCount = 0;
  for (const m of installed.values()) if (pluginInstalled(plugin, m)) installedCount += 1;
  /** Whether the Agent selected right now has this plugin — what the corner button toggles. */
  const isInstalledOnCurrentAgent =
    currentAgent !== null && pluginInstalled(plugin, installed.get(currentAgent.agentId));
  // The server's list of Agents behind on this plugin, minus any this page has since uninstalled
  // it from (the list is re-read after every install action, but the snapshot moves first).
  const outdated = outdatedAgentIds(agents, plugin.name).filter((agentId) =>
    pluginInstalled(plugin, installed.get(agentId)),
  );
  // Quick start opens a draft on the currently selected Agent and pre-selects one of this
  // plugin's skills there, so it's only offered once that Agent has one installed — otherwise
  // it would pre-select a skill the Agent lacks. A plugin with no skill has nothing to start.
  const currentInstalls = currentAgent === null ? undefined : installed.get(currentAgent.agentId);
  const quickStartSkill =
    currentInstalls === undefined
      ? undefined
      : plugin.skills.find((skill) => currentInstalls.skills.has(skill.name));

  // The card's detail Modal (the model library's card pattern): what the plugin ships,
  // with a per-skill SKILL.md reader. Rendered below the card rather than by the page, since
  // one card's detail has to know that card's own `installedCount`.
  const [detailOpen, setDetailOpen] = useState(false);
  // Short description takes priority, falling back to the full description
  // when missing (per UI language); title carries the full description for hover reading.
  const description = localizedShortText(locale, plugin);
  const fullDescription = localizedText(locale, plugin.description, plugin.descriptionZh);
  // Metadata line: version · how long ago that version's date is · usage count — plain
  // readable phrases, no badges.
  //
  // The version is split rather than printed whole because `2026-08-04.1` is not a version
  // number — it is a date and a revision welded together, and printing it as `v2026-08-04.1`
  // left people asking which of the two they were looking at. The date part is what they were
  // reading anyway (the relative phrase beside it already came from it), so it gets its own
  // label and the `.N` stays as the revision.
  const versionDate = plugin.version ? plugin.version.split(".")[0]! : null;
  const versionRevision = plugin.version ? plugin.version.split(".")[1] : null;
  // Key state for the whole card: a plugin is only as ready as the least-ready skill it ships,
  // so any skill waiting on a credential tints the card. The names go in the tooltip so the
  // mark says *what* to set, not merely that something is unset.
  const envSkills = plugin.skills.filter((skill) => (skill.requiredEnv?.length ?? 0) > 0);
  const envNames = [...new Set(envSkills.flatMap((skill) => skill.requiredEnv ?? []))];
  const keyState =
    envNames.length === 0
      ? undefined
      : envSkills.every((skill) => skill.requiredEnvReady)
        ? "ready"
        : "unset";
  const meta = [
    versionDate
      ? S.plugins.versionLabel(
          versionDate,
          versionRevision === undefined ? null : Number(versionRevision),
          formatRelativeDate(versionDate, locale),
        )
      : null,
    S.plugins.usedByAgents(installedCount),
  ]
    .filter((v): v is string => v !== null)
    .join(" · ");
  return (
    <>
      <LibraryCard
        icon={plugin.icon}
        name={plugin.name}
        fallbackIcon={PLUGIN_ICON}
        description={description}
        descriptionTitle={fullDescription}
        meta={meta}
        keyState={keyState}
        keyLabel={envNames.length === 0 ? undefined : S.plugins.needsEnv(envNames)}
        onOpen={() => setDetailOpen(true)}
        actionOverlay
        action={
          // Shown on hover (or focus, so the keyboard reaches them): a group this wide on a card
          // this narrow would otherwise cost the name a third of its width, so they lay over
          // its tail instead — see `actionOverlay`.
          //
          // 28px squares rather than the 32px the app's other icon buttons use. These five sit on
          // a 3-up grid where the card is a third of the page, so the button group is competing
          // with the name for the same row; at 32px the group is ~136px and the name truncates
          // inside fifteen characters. The glyph keeps `iconButton` — at 15px in a 28px button it
          // still reads as a glyph rather than a speck, and inventing a rung below it for one
          // card would put two sizes in the scale that no other caller shares.
          <div className="flex shrink-0 items-center gap-1">
            {/*
              升级. **Goes back to the source the plugin was installed from and re-fetches** — the
              behaviour the button is specified to have, and the reason `.provenance.json` exists.
              Always present so the affordance is findable; a plugin with no recorded source (one
              added from a folder) says so in its tooltip rather than being hidden, because "why
              can't I upgrade this" is a question the absence would leave unanswered.

              Carries the update dot itself when something IS waiting — straddling the top-right
              corner of the button's border, the anchoring rule update-dot.tsx states for a button.
            */}
            <Button
              size="sm"
              variant="secondary"
              className="relative h-7 w-7 shrink-0 justify-center p-0"
              aria-label={`${S.plugins.upgradeAction} ${plugin.name}`}
              title={
                outdated.length > 0
                  ? S.plugins.updateOutdated(outdated.length)
                  : S.plugins.upgradeHint
              }
              disabled={outdated.length === 0}
              onClick={() => setPendingUpdate(outdated)}
            >
              <GlyphIcon d={UPDATE_ICON} size={ICON_SIZE.iconButton} />
              {outdated.length > 0 && (
                <UpdateDot
                  size="inline"
                  position="right-0.5 top-0.5 -translate-y-1/2 translate-x-1/2"
                />
              )}
            </Button>
            {plugin.skills.length > 0 && (
              <Button
                size="sm"
                variant="secondary"
                className="h-7 w-7 shrink-0 justify-center p-0"
                aria-label={`${S.skills.quickInvoke} ${plugin.name}`}
                title={quickStartSkill ? S.skills.quickInvoke : S.plugins.quickInvokeNeedsInstall}
                disabled={quickStartSkill === undefined}
                onClick={() => {
                  if (quickStartSkill) onQuickInvoke(quickStartSkill.name);
                }}
              >
                <GlyphIcon d={SEND_ICON} size={ICON_SIZE.iconButton} />
              </Button>
            )}
            {/* Managing the other Agents: the per-Agent list, unchanged. */}
            <Button
              size="sm"
              variant="secondary"
              className="h-7 w-7 shrink-0 justify-center p-0"
              aria-label={`${S.skills.manageInstall} ${plugin.name}`}
              title={S.skills.manageInstall}
              onClick={() => setInstallOpen(true)}
            >
              <GlyphIcon d={INSTALL_ICON} size={ICON_SIZE.iconButton} />
            </Button>
            {/* Switch the plugin on or off for the Agent selected right now, shown only once it is
              installed there — a switch for something that is not installed has nothing to act on.
              Switching off keeps the files, so it is reversible without a reinstall.

              {/* **本机开关** — the machine-level switch, on every card.

                Not gated on `isInstalledOnCurrentAgent`, and that is the whole change. A switch that
                only exists for a plugin installed on the Agent currently selected answers a
                question about that Agent, not about the plugin: a plugin installed on some other
                Agent would show no switch at all, as if it could not be turned off. "Should this
                plugin be available on this computer" is answerable for every plugin in the library,
                including one no Agent has — which is the state where the decision actually matters.

                Distinct from the per-Agent switch below, and shown **next to** it rather than
                replacing it: they are two different acts with two different scopes. Switching the
                machine off stops the plugin loading anywhere and blocks new installs; switching one
                Agent off leaves the machine-level decision alone. Both must be on for the plugin to
                run (see plugin-machine-state.ts). */}
            <span className="inline-flex shrink-0 items-center">
              <Switch
                size="sm"
                checked={machineEnabled}
                onChange={() => void toggleMachineEnabled()}
                disabled={togglingMachine}
                aria-label={`${machineEnabled ? S.plugins.disableMachine : S.plugins.enableMachine} ${plugin.name}`}
                title={machineEnabled ? S.plugins.disableMachineHint : S.plugins.enableMachineHint}
              />
            </span>
            {/* The per-Agent switch, shown only once the plugin is installed there — a switch for
              something that is not installed has nothing to act on. Switching off keeps the files,
              so it is reversible without a reinstall.

              A `Switch` rather than one more icon button, and that is the point of it. In a row of
              glyphs the power mark was the only one whose state lived in the glyph rather than in
              its shape: a filled vs. outline power icon is a difference nobody reads at a glance,
              while a knob at one end or the other says its own state without being hovered.

              Sized `sm` — the component's `base` is tuned for a labelled form row, and a
              full-size switch beside 28px glyph buttons would stand taller than every one of
              them. */}
            {isInstalledOnCurrentAgent && enabled !== null && (
              <span className="inline-flex shrink-0 items-center">
                <Switch
                  size="sm"
                  checked={enabled}
                  onChange={() => void toggleEnabled()}
                  disabled={togglingEnabled}
                  aria-label={`${enabled ? S.plugins.disableForAgent : S.plugins.enableForAgent} ${plugin.name}`}
                  title={enabled ? S.plugins.disableForAgentHint : S.plugins.enableForAgentHint}
                />
              </span>
            )}
            {/* 卸载 — delete this plugin from this machine, irreversibly.

                **Only on the machine level, never per-Agent.** Distinct from 管理安装's per-Agent
                uninstall, which removes one Agent's copy and leaves the files; this one takes the
                plugin off the disk, so it wears the danger variant and confirms first, naming the
                Agents that lose access — that list is the difference between a warning the user can
                reason about and one they have to accept on trust.

                **Only on a plugin the user added.** A built-in plugin ships with the app, so its
                files are not a library copy the user owns and deleting it would be removing the
                product rather than a plugin from it. The server refuses it too; hiding it here
                keeps a button that could only ever fail off the card.

                **No 安装 counterpart on the card, by design.** This is a local client: every plugin
                the page lists is already on this machine, so a 「下载到本地」 button on a card would
                be offering to fetch something the user is already looking at. Getting a plugin onto
                the machine is one act — 添加插件 in the top right — and that is the only place it
                belongs. */}
            {isOnThisMachine && (
              <Button
                size="sm"
                variant="danger"
                className="h-7 w-7 shrink-0 justify-center p-0"
                aria-label={`${S.plugins.deleteFromMachine} ${plugin.name}`}
                title={S.plugins.deleteFromMachineHint}
                disabled={deleting}
                onClick={confirmMachineDelete}
              >
                <GlyphIcon d={TRASH_ICON} size={ICON_SIZE.iconButton} />
              </Button>
            )}
          </div>
        }
      />
      {detailOpen && (
        <PluginDetailModal
          plugin={plugin}
          meta={meta}
          installedCount={installedCount}
          // Re-read the plugin listing after a credential save, so the card's key glyph turns
          // green from the server's own answer rather than from an assumption about what the
          // write did. The listing resolves each variable against the **server's** environment,
          // which is what the skills' `curl` calls actually inherit.
          onCredentialsChanged={() => void onRefreshLibrary()}
          onClose={() => setDetailOpen(false)}
        />
      )}
      {installOpen && (
        <Modal
          open
          title={S.skills.manageInstallTitle(plugin.name)}
          onClose={() => setInstallOpen(false)}
        >
          <div className="space-y-0.5">
            {agents.length === 0 && (
              <p className="py-1.5 text-xs text-gray-400">{S.common.loading}</p>
            )}
            {agents.map((a) => (
              <InstallRow
                key={a.agentId}
                agentId={a.agentId}
                name={agentDisplayName(a)}
                installed={pluginInstalled(plugin, installed.get(a.agentId))}
                outdated={outdated.includes(a.agentId)}
                machineEnabled={machineEnabled}
                onToggle={(on) => {
                  // Install runs directly. Uninstall here is the **per-Agent** one — it removes
                  // that Agent's copy and leaves the plugin on this machine — so it keeps its own
                  // confirm, distinct from the card's machine-wide 卸载.
                  if (on) void onToggleInstall(a.agentId, plugin, true);
                  else setPendingAgentRemove(a.agentId);
                }}
                onUpdate={() => setPendingUpdate([a.agentId])}
              />
            ))}
          </div>
        </Modal>
      )}
      {pendingUpdate && (
        <ConfirmModal
          open
          title={S.plugins.updateConfirmTitle(plugin.name)}
          tone="primary"
          confirmLabel={S.skills.updateAction}
          busy={updating}
          onClose={() => setPendingUpdate(null)}
          onConfirm={() => void confirmUpdate()}
        >
          <div className="space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {S.plugins.updateConfirmWarning(plugin.name)}
            </p>
            {/* Per-agent old → new version, so it's clear exactly which installs get overwritten. */}
            <ul className="max-h-60 divide-y divide-gray-100 overflow-y-auto rounded-md border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
              {pendingUpdate.map((agentId) => {
                const oldVersion = installedPluginVersion(plugin, installed.get(agentId));
                const target = agents.find((a) => a.agentId === agentId);
                return (
                  <li
                    key={agentId}
                    className="flex items-center justify-between gap-3 px-3 py-1.5 text-xs"
                  >
                    <span className="min-w-0 truncate">
                      {target ? agentDisplayName(target) : agentId}
                    </span>
                    <span className="shrink-0 font-mono text-gray-500 dark:text-gray-400">
                      {oldVersion || "?"} → {plugin.version}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </ConfirmModal>
      )}
      {/*
        The **per-Agent** removal from 管理安装. Deliberately separate from the machine-wide delete
        below: this one leaves the plugin on this machine and takes away only this Agent's use of
        it, which is reversible with 启用. Sharing a confirm between the two would let a user confirm
        "remove from this agent" and destroy the plugin instead.
      */}
      {pendingAgentRemove !== null && (
        <ConfirmModal
          open
          title={S.plugins.uninstallConfirmTitle(plugin.name)}
          confirmLabel={S.skills.uninstall}
          onClose={() => setPendingAgentRemove(null)}
          onConfirm={() => {
            const agentId = pendingAgentRemove;
            setPendingAgentRemove(null);
            void onToggleInstall(agentId, plugin, false);
          }}
        >
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {S.plugins.uninstallConfirmBody(
              plugin.name,
              agents.find((a) => a.agentId === pendingAgentRemove)
                ? agentDisplayName(agents.find((a) => a.agentId === pendingAgentRemove)!)
                : pendingAgentRemove,
            )}
          </p>
        </ConfirmModal>
      )}
      {pendingDelete && (
        <ConfirmModal
          open
          title={S.plugins.deleteConfirmTitle(plugin.name)}
          confirmLabel={S.plugins.deleteFromMachine}
          tone="danger"
          onClose={() => {
            if (!deleting) setPendingDelete(false);
          }}
          onConfirm={() => void runMachineDelete()}
        >
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {S.plugins.deleteConfirmBody(plugin.name)}
          </p>
          {/*
            The affected Agents, named before the irreversible button is pressed. Rendered from
            what the card's own install state says rather than from a separate fetch, because the
            card already holds that list; an empty one reads as "no agent uses this" only when the
            state is actually known, hence the explicit no-agents line.
          */}
          <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">
            {deleteAffects.length > 0
              ? S.plugins.deleteAffectsAgents(
                  deleteAffects
                    .map((id) => agents.find((a) => a.agentId === id))
                    .filter((a) => a !== undefined)
                    .map(agentDisplayName)
                    .join("、"),
                )
              : S.plugins.deleteAffectsNone}
          </p>
        </ConfirmModal>
      )}
    </>
  );
}

/**
 * One Agent row in the "manage installs" Modal: not-installed shows
 * "Install"; installed shows "Installed", switching to "Uninstall" on hover
 * (same button, click to uninstall); an installed copy the server lists as behind the
 * library additionally shows an accent "Update" button (reinstall = update). Install
 * and uninstall go through optimistic updates (toggleInstall), rolling back on
 * failure.
 */
function InstallRow({
  agentId,
  name,
  installed,
  outdated,
  machineEnabled,
  onToggle,
  onUpdate,
}: {
  agentId: string;
  name: string;
  installed: boolean;
  outdated: boolean;
  /**
   * The machine-level switch. Gates the **install** half only: an Agent that already has the plugin
   * can still uninstall it (that removes files, which a disabled plugin does not stop being able to
   * do), but cannot install it while the machine has it switched off.
   */
  machineEnabled: boolean;
  onToggle: (on: boolean) => void;
  onUpdate: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md px-1.5 py-1.5 transition-colors duration-150 hover:bg-gray-50 dark:hover:bg-gray-800/60">
      <AgentAvatar id={agentId} name={name} size={22} className="shrink-0 rounded" />
      <span className="min-w-0 flex-1 truncate text-sm" title={agentId}>
        {name}
      </span>
      {installed && outdated && (
        <Button
          size="sm"
          variant="secondary"
          className="shrink-0"
          aria-label={`${S.skills.updateAction} ${agentId}`}
          onClick={onUpdate}
        >
          {S.skills.updateAction}
        </Button>
      )}
      {installed ? (
        // group: on hover the button's copy switches "Installed" → "Uninstall" (the same button carries the uninstall action).
        <Button
          size="sm"
          variant="ghost"
          className="group shrink-0"
          aria-label={`${S.skills.uninstall} ${agentId}`}
          onClick={() => onToggle(false)}
        >
          <span className="group-hover:hidden">{S.skills.installed}</span>
          <span className="hidden text-red-600 group-hover:inline dark:text-red-400">
            {S.skills.uninstall}
          </span>
        </Button>
      ) : (
        <Button
          size="sm"
          className="shrink-0"
          aria-label={`${S.skills.install} ${agentId}`}
          // Disabled rather than hidden: a user who wants this plugin and finds no install button
          // cannot tell "switched off on purpose" from "this app cannot install it". The tooltip
          // names the action that would unblock it.
          disabled={!machineEnabled}
          title={machineEnabled ? undefined : S.plugins.installNeedsMachineEnabled}
          onClick={() => onToggle(true)}
        >
          {S.skills.install}
        </Button>
      )}
    </div>
  );
}
