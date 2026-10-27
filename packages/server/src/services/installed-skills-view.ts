/**
 * Turns "what is installed on disk" into "what did the user install, and as what".
 *
 * The grouping lives here rather than in the route because it is the part that is easy to get
 * subtly wrong and hard to see when it is wrong: a Skill's origin decides which card it appears
 * under, and a mistake shows up as a plausible-looking layout rather than as an error.
 *
 * Two independent facts are recovered per Skill, because they were independent facts on the way in:
 *
 *   - **install unit** — whether it arrived as part of a plugin (and which one) or on its own.
 *     `agent_state/.installs.json` answers this authoritatively for anything installed after it
 *     shipped. It cannot answer it for anything older: `installPlugin` wrote each member through
 *     `installSkill` and left nothing behind, so a plugin-installed Skill and a standalone one are
 *     byte-identical on disk. Those are inferred (see {@link inferPluginMembership}) and marked
 *     `inferred: true` so the UI can say so.
 *   - **origin** — library or the user's own import. This one *is* recoverable for old installs,
 *     because a Skill the library does not ship cannot have come from the library.
 */
import {
  builtinPluginId,
  hooksDir,
  loadLibraryPlugins,
  pluginNameOf,
  readInstalls,
  type InstallsFile,
  type LibraryPlugin,
} from "@jadelau/core";
import fs from "node:fs/promises";
import { toSkillItem } from "./plugin-library.js";

/**
 * What this module needs from a listed Skill.
 *
 * The real shape is `InstalledSkill` (core's `SkillMetadata` + an icon); this is the subset used
 * here, which is why `version` is `string` — `listInstalledSkills` always produces one, "" for a
 * Skill whose frontmatter carries none.
 */
interface ListedSkill {
  name: string;
  description: string;
  shortDescription?: string;
  version: string;
  icon?: string;
  /** Variable names the skill needs, when it declares them. */
  requiredEnv?: string[];
  /**
   * The owning plugin id, when the skill was read from `plugins/<id>/skills/` — carried through
   * from core's `InstalledSkill.plugin`. Absent for a standalone skill.
   *
   * This is the structural attribution: it comes from the directory the file was found in, so it
   * is not a deduction. Adding it to this subset is what lets the view prefer it over the inferred
   * answer, which is otherwise the only source of `pluginName` until the install path moves.
   */
  plugin?: string;
}

/** One installed Skill, as the installed-skills page needs it. */
export interface InstalledSkillView {
  name: string;
  description: string;
  shortDescription?: string;
  icon?: string;
  version: string | null;
  /**
   * "library" when the library ships it, "import" when it came from the user.
   *
   * Derived from the library's own contents rather than from the record, because the library is
   * the authority on what it ships: a stale record cannot make a user's own Skill look built-in,
   * and one recorded as an import that the library has since added is still the user's file.
   */
  origin: "library" | "import";
  /**
   * The plugin it was installed through, or null when standalone.
   *
   * `inferred` separates "the record says so" from "this was worked out from which Skills happen
   * to be present". The UI shows it, because an inferred claim should look like one.
   */
  pluginName: string | null;
  inferred: boolean;
  /** Every Agent in the Project holding it, sorted. */
  agents: string[];
}

/** One plugin as installed: its Skill members, any missing ones, and its hook packages. */
export interface InstalledPluginView {
  name: string;
  /**
   * The install id, `<name>@<marketplace>` — the directory the plugin's Skills live in.
   *
   * **Separate from `name`, not a replacement for it.** `name` is the library key every existing
   * caller joins on (`p.name === "agent-tuning"`, grouping, updates, per-agent rollups), and
   * changing its shape would silently break all of them. `id` is what addresses the install, so
   * both are reported and neither is derived by the client.
   */
  id: string;
  description: string;
  icon?: string;
  version: string | null;
  /** How many Skills the library says this plugin ships. */
  skillCount: number;
  /** Members present on disk. */
  skills: InstalledSkillView[];
  /** Members the library ships that are not present — what makes a plugin visibly incomplete. */
  missingSkills: string[];
  /** Installed hook packages: the Agents holding one, sorted; empty when the plugin has no hooks. */
  hooks: string[];
  agents: string[];
  /** True when this plugin's membership was inferred rather than recorded. */
  inferred: boolean;
}

export interface InstalledSkillsView {
  /** Plugins, complete or not. Includes hook-only plugins. */
  plugins: InstalledPluginView[];
  /** Skills installed on their own, not through any plugin. */
  skills: InstalledSkillView[];
  agentCount: number;
}

/**
 * Works out which plugin each unrecorded Skill probably belongs to.
 *
 * The rule is deliberately conservative: a Skill is attributed to a plugin only when **every**
 * Skill that plugin ships is present. The failure this avoids is the plausible one — attributing
 * a partially-installed multi-Skill plugin, which would claim ownership of Skills the user
 * installed deliberately on their own.
 *
 * What stays unknowable, and is not guessed: a single-Skill plugin's only Skill (installing the
 * plugin and installing the Skill are the same act), and a Skill from a multi-Skill plugin the
 * user installed alone while the other members were already present.
 */
function inferPluginMembership(installed: ReadonlySet<string>): {
  pluginOf: Map<string, string>;
  plugins: Set<string>;
} {
  const pluginOf = new Map<string, string>();
  const plugins = new Set<string>();
  for (const plugin of loadLibraryPlugins()) {
    if (plugin.skills.length === 0) continue;
    if (!plugin.skills.every((s) => installed.has(s.name))) continue;
    plugins.add(plugin.name);
    for (const skill of plugin.skills) pluginOf.set(skill.name, plugin.name);
  }
  return { pluginOf, plugins };
}

/**
 * Which hook packages are on disk, per Agent.
 *
 * Needed because a hook-only plugin has no Skill directory to infer from: `goal` and
 * `continual-learning` ship no Skills at all, so with only a Skills scan they are invisible even
 * when `hooks/<name>/` is right there proving they were installed. Their directory name is the
 * plugin name (`installHook` writes `hooks/<plugin>/`), so presence is as good as a record.
 */
async function readInstalledHooks(
  root: string,
  projectId: string,
  agentIds: readonly string[],
): Promise<Map<string, Set<string>>> {
  const byAgent = new Map<string, Set<string>>();
  await Promise.all(
    agentIds.map(async (agentId) => {
      const dir = hooksDir(root, projectId, agentId);
      let entries: string[];
      try {
        entries = (await fs.readdir(dir, { withFileTypes: true }))
          .filter((e) => e.isDirectory() && !e.name.startsWith("."))
          .map((e) => e.name);
      } catch {
        entries = [];
      }
      byAgent.set(agentId, new Set(entries));
    }),
  );
  return byAgent;
}

/** The recorded plugin version for a plugin, or null when no Agent recorded one. */
function recordedPluginVersion(
  records: readonly InstallsFile[],
  pluginName: string,
): string | null {
  for (const file of records) {
    const version = file.plugins[pluginName]?.version;
    if (version !== undefined && version !== null) return version;
  }
  return null;
}

/**
 * Builds the page's whole view for one Project.
 *
 * `skillsByAgent` is what `listInstalledSkills` returned per Agent; taking it as an argument keeps
 * this function free of directory access and testable against fixtures.
 */
export async function buildInstalledSkillsView(
  root: string,
  projectId: string,
  agentIds: readonly string[],
  skillsByAgent: ReadonlyMap<string, readonly ListedSkill[]>,
): Promise<InstalledSkillsView> {
  const agentIdList = [...agentIds].sort();
  const libraryPlugins = new Map<string, LibraryPlugin>(
    loadLibraryPlugins().map((p) => [p.name, p]),
  );
  const librarySkillNames = new Set<string>();
  for (const plugin of libraryPlugins.values()) {
    for (const skill of plugin.skills) librarySkillNames.add(skill.name);
  }

  // One entry per Skill, holding the Agents it is on: a Skill is one card no matter how many
  // Agents have it, which is the whole point of a project-wide view.
  const byName = new Map<string, { skill: ListedSkill; agents: string[] }>();
  for (const agentId of agentIdList) {
    for (const skill of skillsByAgent.get(agentId) ?? []) {
      const entry = byName.get(skill.name);
      if (entry === undefined) byName.set(skill.name, { skill, agents: [agentId] });
      else entry.agents.push(agentId);
    }
  }
  const installed = new Set(byName.keys());
  const inferred = inferPluginMembership(installed);

  // The record is authoritative where it exists; inference only fills the gaps.
  const hooksByAgent = await readInstalledHooks(root, projectId, agentIdList);
  const records: InstallsFile[] = await Promise.all(
    agentIdList.map((agentId) => readInstalls(root, projectId, agentId)),
  );
  const recordedPluginOf = new Map<string, string>();
  const recordedSkill = new Map<string, { version: string | null; source: "library" | "import" }>();
  const recordedPlugins = new Set<string>();
  for (const file of records) {
    for (const [pluginName, record] of Object.entries(file.plugins)) {
      recordedPlugins.add(pluginName);
      for (const skillName of record.skills) recordedPluginOf.set(skillName, pluginName);
    }
    for (const [skillName, record] of Object.entries(file.skills)) {
      recordedSkill.set(skillName, { version: record.version, source: record.source });
    }
  }

  const toView = (name: string): InstalledSkillView => {
    const entry = byName.get(name)!;
    // Three sources, strongest first:
    //   1. structural — the skill sits in `plugins/<id>/skills/`, so the path answers it
    //   2. recorded   — installs.json names the owning plugin
    //   3. inferred   — deduced from which skills happen to be present
    //
    // The structural one is new and wins outright. It is the only one that cannot be wrong, so
    // when it disagrees with the other two, the other two are the stale ones — and that is worth
    // knowing during the migration window rather than silently preferring a guess.
    const structural = entry.skill.plugin;
    // The structural source arrives as an id and is reduced to the bare name, because
    // `pluginName` is joined against library plugin names everywhere downstream and a skill whose
    // owner read `agent-tuning@jiumate-builtin` where its siblings said `agent-tuning` would not
    // match the card it is supposed to appear under.
    const claimed =
      (structural === undefined ? undefined : pluginNameOf(structural)) ??
      recordedPluginOf.get(name) ??
      inferred.pluginOf.get(name) ??
      null;
    // `toSkillItem` owns the credential rule (a blank variable counts as unset), so it is
    // reused rather than restated here — a second copy of that rule is how the two drift.
    const common = toSkillItem(entry.skill);
    return {
      ...common,
      // Reported as the bare library name, the same value `pluginName` carries and the same key the
      // plugin cards are indexed by. The full id is available on the plugin's own `id`.
      ...(claimed !== null ? { plugin: claimed } : {}),
      version: recordedSkill.get(name)?.version ?? entry.skill.version,
      origin: librarySkillNames.has(name) ? "library" : "import",
      pluginName: claimed,
      // True only when the claim is a deduction. A structural or recorded attribution is simply
      // true, and labelling it as inferred would make the UI hedge about something it knows.
      inferred: claimed !== null && structural === undefined && !recordedPluginOf.has(name),
      agents: entry.agents.sort(),
    };
  };

  const plugins: InstalledPluginView[] = [];
  const consumed = new Set<string>();
  // Every hook-only plugin in the library joins the candidates: there is no Skill to infer one
  // from, so without this a hook plugin that predates provenance could only be admitted by its
  // record, and would be reported as not installed while `hooks/<name>/` is on disk.
  const hookOnlyCandidates = [...libraryPlugins.values()]
    .filter((p) => p.skills.length === 0 && p.hooks !== undefined)
    .map((p) => p.name);
  // Structurally-attributed plugins join too. Before this, a plugin could only enter the list via
  // its record or by inference from its member set, so a skill sitting in `plugins/<id>/skills/`
  // would be attributed to a plugin that then never appeared — the card would be invisible while
  // claiming its skills.
  //
  // Ids may carry an `@<marketplace>` suffix (the on-disk directory name), so the **name part**
  // is what the library is keyed by; the full id is what gets reported, since that is where the
  // skill actually lives.
  const structuralOf = new Map<string, string>();
  for (const entry of byName.values()) {
    const id = entry.skill.plugin;
    if (id !== undefined) structuralOf.set(pluginNameOf(id), id);
  }
  for (const pluginName of [
    ...new Set([
      ...recordedPlugins,
      ...inferred.plugins,
      ...hookOnlyCandidates,
      ...structuralOf.keys(),
    ]),
  ].sort()) {
    const plugin = libraryPlugins.get(pluginName);
    // A record naming a plugin this build no longer ships is dropped rather than shown as a
    // nameless card: its Skills still appear below as standalone, which is the honest reading.
    if (plugin === undefined) continue;
    const wanted = plugin.skills.map((s) => s.name).sort();
    const present = wanted.filter((n) => installed.has(n));
    // Two ways a plugin is admitted, and the reason matters below:
    //   - its record names it → installed, even with no member left on disk;
    //   - a member (or its hook package) is on disk with no record → inference put it here.
    // The hook check is what keeps a hook-only plugin visible for an install that predates
    // provenance: it ships no Skills, so `present` is legitimately empty and a Skills-only test
    // would report it as not installed while `hooks/goal/` sits right there.
    const recorded = recordedPlugins.has(pluginName);
    const hasHook = agentIdList.some((a) => hooksByAgent.get(a)?.has(pluginName));
    // A structural attribution is as good as a record for admitting the plugin: the skill was
    // found inside this plugin's directory, so there is nothing left to prove.
    const structural = structuralOf.has(pluginName);
    if (present.length === 0 && !recorded && !structural && !hasHook) continue;
    for (const name of present) consumed.add(name);
    plugins.push({
      // `name` stays the library key — every caller joins on it — and `id` carries the directory
      // the install actually lives under, so the two conventions do not have to be reconciled by
      // whoever is reading this.
      name: pluginName,
      id: structuralOf.get(pluginName) ?? builtinPluginId(pluginName),
      description: plugin.description,
      ...(plugin.descriptionZh !== undefined ? { descriptionZh: plugin.descriptionZh } : {}),
      ...(plugin.icon !== undefined ? { icon: plugin.icon } : {}),
      version: recordedPluginVersion(records, pluginName) ?? plugin.version,
      skillCount: wanted.length,
      skills: present.map(toView),
      missingSkills: wanted.filter((n) => !installed.has(n)),
      hooks:
        plugin.hooks === undefined
          ? []
          : agentIdList.filter((a) => hooksByAgent.get(a)?.has(pluginName)),
      // Per Agent, not project-wide: a hook held by one Agent is not held by the rest, and
      // listing all Agents for a plugin only one of them has would be the same class of lie the
      // page exists to stop. A hook-only plugin therefore resolves entirely from this.
      agents: agentIdList.filter(
        (a) =>
          hooksByAgent.get(a)?.has(pluginName) === true ||
          present.some((n) => byName.get(n)!.agents.includes(a)),
      ),
      inferred: !recorded && !structural,
    });
  }

  return {
    plugins,
    skills: [...byName.keys()]
      .filter((n) => !consumed.has(n))
      .sort()
      .map(toView),
    agentCount: agentIdList.length,
  };
}
