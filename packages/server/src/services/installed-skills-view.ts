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
  loadLibraryPlugins,
  readInstalls,
  type InstallsFile,
  type LibraryPlugin,
} from "@prismshadow/jiumate-core";
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
  description: string;
  icon?: string;
  version: string | null;
  /** How many Skills the library says this plugin ships. */
  skillCount: number;
  /** Members present on disk. */
  skills: InstalledSkillView[];
  /** Members the library ships that are not present — what makes a plugin visibly incomplete. */
  missingSkills: string[];
  /** Installed hook package names. */
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
    // Recorded wins; otherwise the inferred attribution, if any. Null means standalone.
    const claimed = recordedPluginOf.get(name) ?? inferred.pluginOf.get(name) ?? null;
    // `toSkillItem` owns the credential rule (a blank variable counts as unset), so it is
    // reused rather than restated here — a second copy of that rule is how the two drift.
    const common = toSkillItem(entry.skill);
    return {
      ...common,
      version: recordedSkill.get(name)?.version ?? entry.skill.version,
      origin: librarySkillNames.has(name) ? "library" : "import",
      pluginName: claimed,
      // Only an inferred attribution needs saying; a recorded one is simply true.
      inferred: claimed !== null && !recordedPluginOf.has(name),
      agents: entry.agents.sort(),
    };
  };

  const plugins: InstalledPluginView[] = [];
  const consumed = new Set<string>();
  for (const pluginName of [...new Set([...recordedPlugins, ...inferred.plugins])].sort()) {
    const plugin = libraryPlugins.get(pluginName);
    // A record naming a plugin this build no longer ships is dropped rather than shown as a
    // nameless card: its Skills still appear below as standalone, which is the honest reading.
    if (plugin === undefined) continue;
    const wanted = plugin.skills.map((s) => s.name).sort();
    const present = wanted.filter((n) => installed.has(n));
    // Two ways a plugin is admitted, and the reason matters below:
    //   - its record names it → it is installed, even with no member left on disk;
    //   - a member is on disk with no record → inference put it here.
    // A hook-only plugin ships no Skills, so for one "nothing present" is the normal state rather
    // than evidence of absence — and it can only ever be admitted by its record, because there is
    // no directory to infer from.
    const recorded = recordedPlugins.has(pluginName);
    if (present.length === 0 && !recorded) continue;
    for (const name of present) consumed.add(name);
    plugins.push({
      name: pluginName,
      description: plugin.description,
      ...(plugin.icon !== undefined ? { icon: plugin.icon } : {}),
      version: recordedPluginVersion(records, pluginName) ?? plugin.version,
      skillCount: wanted.length,
      skills: present.map(toView),
      missingSkills: wanted.filter((n) => !installed.has(n)),
      hooks: plugin.hooks === undefined ? [] : [pluginName],
      agents: agentIdList.filter((a) => present.some((n) => byName.get(n)!.agents.includes(a))),
      inferred: !recorded,
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
