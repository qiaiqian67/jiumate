/**
 * The installed-plugins tree: `agent_state/plugins/<name>@<marketplace>/`.
 *
 * A bundled Skill now lives **inside** the plugin that ships it, rather than being copied out into
 * `skills/` at install time. The change is small in code and large in what it guarantees:
 *
 *   - "which plugin is this Skill from" is answered by where the file is, so it cannot be wrong and
 *     cannot be lost by a writer that forgot to record it;
 *   - a bundled Skill has no standalone removal path, because the only operation that reaches it
 *     removes the plugin with it — 「捆绑技能不可单独卸载」 stops being a UI rule and becomes a
 *     property of the layout;
 *   - disabling is a field in `manifest.json` rather than a deletion, so switching a plugin off
 *     keeps its files and switching it back on needs no reinstall.
 *
 * An id is `<name>@<marketplace>`, the convention the wider ecosystem uses: the origin is readable
 * off the directory name with no side table, which is what lets a plugin directory be moved between
 * tools without losing where it came from.
 *
 * **Migration.** Skills installed before this layout are still in `skills/` and are still read from
 * there (`listInstalledSkills` reads both trees). `migrateFlatBundledSkills` moves the ones that
 * belong to an installed plugin; anything it cannot attribute is left exactly where it is, because
 * guessing would claim ownership of a Skill the user installed deliberately on its own.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { atomicWriteFile } from "../internal/atomic-write.js";
import { assertSafeSkillFile } from "../internal/skill-file-path.js";
import { assertValidId } from "../internal/valid-id.js";
import { pluginsDir, skillsDir } from "./paths.js";
import type { LibraryPlugin } from "../plugins/index.js";

/** The marketplace that ships with the product. Its name is part of every built-in plugin's id. */
export const BUILTIN_MARKETPLACE = "jiumate-builtin";

/** `<name>@<marketplace>` for a plugin installed from the built-in library. */
export function builtinPluginId(name: string): string {
  return `${name}@${BUILTIN_MARKETPLACE}`;
}

/**
 * The **name** part of a plugin id — what the library is keyed by.
 *
 * An id with no `@` is already a bare name, so this never fails and never throws on a plain name;
 * `pluginNameOf("@x")` returning the input rather than an empty string keeps a malformed id from
 * becoming an empty lookup key.
 */
export function pluginNameOf(id: string): string {
  const at = id.indexOf("@");
  return at <= 0 ? id : id.slice(0, at);
}

/**
 * Rejects an id that is not shaped like a plugin directory name.
 *
 * The id becomes a directory name, so it has to be validated exactly as strictly as a Skill name is
 * — otherwise `../../elsewhere` is a plugin id that writes outside the tree. Validated as a *whole*
 * rather than assembled from validated parts, because the `@` separator is what makes the shape
 * recognisable and a validated-parts version would accept things this one rejects.
 */
export function assertPluginId(id: string): void {
  if (!/^[A-Za-z0-9_-]+@[A-Za-z0-9_.-]+$/.test(id)) {
    throw new Error(
      `Invalid plugin id ${JSON.stringify(id)}: expected <name>@<marketplace> with no path separators.`,
    );
  }
}

/** The manifest written beside an installed plugin's contents. */
export interface InstalledPluginManifest {
  /** The plugin's full id, `<name>@<marketplace>`. */
  id: string;
  /** The library version this install came from (`YYYY-MM-DD.N`). */
  version: string;
  /**
   * Whether the plugin's Skills and hooks are used. Absent means enabled.
   *
   * A boolean on the plugin rather than per Skill, because that is the unit a user actually
   * switches: 「turn this plugin off」 is one decision, and offering it per member would let a
   * half-on plugin that no version of the package ever described.
   */
  enabled?: boolean;
  /** Epoch millis the install was written. */
  installedAt: number;
}

const manifestFile = "manifest.json";

/** `<agentState>/plugins/<id>`. */
export function pluginDir(
  root: string,
  projectId: string,
  agentId: string,
  id: string,
): string {
  return path.join(pluginsDir(root, projectId, agentId), id);
}

/**
 * Writes a plugin's Skills into `plugins/<id>/skills/` and its manifest beside them.
 *
 * Each Skill directory is replaced wholesale by `replaceSkillDirectory`'s staging semantics, so a
 * reinstall drops files the new version no longer ships and an interrupted write cannot leave a
 * half-written Skill under its real name.
 *
 * Hooks are **not** touched here. They already live in their own tree keyed by plugin name
 * (`hooks/<name>/`), which is unchanged by this layout, and moving them would be a second migration
 * with no bearing on whether a Skill is bundled.
 */
export async function writePluginInstall(
  root: string,
  projectId: string,
  agentId: string,
  plugin: LibraryPlugin,
  id = builtinPluginId(plugin.name),
): Promise<void> {
  assertValidId("project_id", projectId);
  assertValidId("agent_id", agentId);
  assertPluginId(id);
  const dir = pluginDir(root, projectId, agentId, id);
  await fs.mkdir(dir, { recursive: true });

  // A reinstall replaces the plugin's Skills wholesale, the same semantics `installSkill` had for
  // each flat directory: a Skill the new version no longer ships is dropped, so the directory
  // always matches the plugin being installed rather than accumulating Skills across versions.
  // Pruned *before* the new ones land, so a partially-failed install leaves fewer Skills, never a
  // mixture of two versions.
  const keep = new Set(plugin.skills.map((s) => s.name));
  for (const stale of await skillDirNames(path.join(dir, "skills"))) {
    if (!keep.has(stale)) {
      await fs.rm(path.join(dir, "skills", stale), { recursive: true, force: true });
    }
  }

  for (const skill of plugin.skills) {
    const auxiliary = Object.entries(skill.files ?? {});
    for (const [rel] of auxiliary) assertSafeSkillFile(rel);
    const content = skill.content.endsWith("\n") ? skill.content : `${skill.content}\n`;
    await writeSkillDir(path.join(dir, "skills", skill.name), [
      ["SKILL.md", content],
      ...(skill.icon !== undefined ? ([["icon.svg", skill.icon]] as Array<[string, string]>) : []),
      ...auxiliary,
    ]);
  }

  // Written last: a manifest present next to complete content is the consistent state, whereas a
  // manifest written first would claim an install whose Skills are not all there yet.
  const manifest: InstalledPluginManifest = {
    id,
    version: plugin.version,
    enabled: true,
    installedAt: Date.now(),
  };
  await atomicWriteFile(path.join(dir, manifestFile), `${JSON.stringify(manifest, null, 2)}\n`);

  // Provenance is still recorded, for the plugin-level upgrade to know which Skills it brought. It
  // is a cache of where things came from, not the thing that makes them bundled — the path does
  // that now — so a failure here costs history, never content.
  try {
    const { updateInstalls } = await import("./installs.js");
    await updateInstalls(root, projectId, agentId, undefined, (file) => {
      file.plugins[plugin.name] = {
        version: plugin.version,
        skills: [...plugin.skills.map((s) => s.name)].sort(),
        hooks: plugin.hooks === undefined ? [] : [plugin.name],
      };
      for (const skill of plugin.skills) delete file.skills[skill.name];
    });
  } catch {
    // As above: the install has already succeeded on disk.
  }
}

/** Whether a directory exists (the plugins tree is absent until something is installed into it). */
async function dirExists(dir: string): Promise<boolean> {
  try {
    return (await fs.stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

/** Skill directory names under `skillsDir`, ignoring staging directories and absent trees. */
async function skillDirNames(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/** One Skill directory written from `relative path → content`, replacing anything already there. */async function writeSkillDir(
  target: string,
  files: Array<[string, string]>,
): Promise<void> {
  const staging = path.join(path.dirname(target), `.${path.basename(target)}.staging`);
  await fs.rm(staging, { recursive: true, force: true });
  await fs.mkdir(staging, { recursive: true });
  for (const [rel, content] of files) {
    const file = path.join(staging, rel);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content, "utf8");
  }
  await fs.rm(target, { recursive: true, force: true });
  await fs.rename(staging, target);
}

/**
 * Switches a plugin on or off by rewriting one field of its manifest.
 *
 * The Skills stay on disk. That is the point: switching off must be reversible without a reinstall
 * and without a network fetch, and a plugin that has been off for a week should come back exactly
 * as it was.
 *
 * Returns the state written, so a caller can report what happened rather than what it intended.
 */
export async function setPluginEnabled(
  root: string,
  projectId: string,
  agentId: string,
  id: string,
  enabled: boolean,
): Promise<boolean> {
  assertValidId("project_id", projectId);
  assertValidId("agent_id", agentId);
  assertPluginId(id);
  const file = path.join(pluginDir(root, projectId, agentId, id), manifestFile);
  let manifest: InstalledPluginManifest;
  try {
    manifest = JSON.parse(await fs.readFile(file, "utf8")) as InstalledPluginManifest;
  } catch {
    // Nothing installed under this id, so there is no state to change. Reported as "still on"
    // rather than invented: the caller asked to switch something that is not there.
    return true;
  }
  if (!manifest || typeof manifest !== "object") return true;
  manifest.enabled = enabled;
  await atomicWriteFile(file, `${JSON.stringify(manifest, null, 2)}\n`);
  return enabled;
}

/** One installed plugin, as the listings report it. */
export interface InstalledPluginEntry {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  installedAt: number;
  skills: string[];
}

/**
 * Every plugin installed on the Agent, id-sorted.
 *
 * Reads the manifests rather than inferring from directory contents, so a plugin with a corrupt
 * manifest is still listed (as enabled, which is the safe default) instead of disappearing — the
 * listing's job is to say what is installed, not to judge whether it is usable.
 */
export async function listInstalledPlugins(
  root: string,
  projectId: string,
  agentId: string,
): Promise<InstalledPluginEntry[]> {
  const base = pluginsDir(root, projectId, agentId);
  let entries;
  try {
    entries = await fs.readdir(base, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: InstalledPluginEntry[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const dir = path.join(base, entry.name);
    let manifest: Partial<InstalledPluginManifest> = {};
    try {
      const parsed: unknown = JSON.parse(
        await fs.readFile(path.join(dir, manifestFile), "utf8"),
      );
      if (parsed && typeof parsed === "object") {
        manifest = parsed as Partial<InstalledPluginManifest>;
      }
    } catch {
      // Left empty; the directory still proves an install happened.
    }
    let skills: string[] = [];
    try {
      skills = (await fs.readdir(path.join(dir, "skills"), { withFileTypes: true }))
        .filter((e) => e.isDirectory() && !e.name.startsWith("."))
        .map((e) => e.name)
        .sort();
    } catch {
      // A plugin with no Skills (hook-only) legitimately has no skills/ directory.
    }

    out.push({
      id: entry.name,
      name: pluginNameOf(entry.name),
      version: typeof manifest.version === "string" ? manifest.version : "",
      // Absent means enabled, matching the reader in agent-state.ts. Two places decide this, and
      // they must agree or a plugin would be listed as off while still loading.
      enabled: manifest.enabled !== false,
      installedAt: typeof manifest.installedAt === "number" ? manifest.installedAt : 0,
      skills,
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** What a migration moved, so a caller can report it rather than guess. */
export interface MigrationReport {
  /** Plugin ids that gained a `plugins/` directory. */
  migrated: string[];
  /** Skills moved into a plugin directory. */
  movedSkills: string[];
  /**
   * Flat skills left alone because no installed plugin claims them.
   *
   * Reported explicitly rather than silently skipped: "I did not touch these" is the answer to
   * "why is this still in skills/", and it is the list a user may want to act on themselves.
   */
  leftAlone: string[];
}

/**
 * Moves pre-migration Skills into the plugins tree, where they belong.
 *
 * Only a Skill that is a **member of an installed plugin** and that already has a plugin directory
 * is moved. A Skill no plugin claims is left in `skills/`, because the flat tree is exactly where a
 * standalone Skill belongs and moving it anywhere else would invent an owner.
 *
 * Idempotent by construction: a Skill already inside a plugin is not in `skills/` to be moved, and a
 * plugin with no directory is skipped until its install writes one. So re-running after a partial
 * run, or after the user installs something new, converges rather than duplicating.
 */
export async function migrateFlatBundledSkills(
  root: string,
  projectId: string,
  agentId: string,
  installedPluginNames: readonly string[],
  versionOf: (name: string) => string = () => "",
): Promise<MigrationReport> {
  const report: MigrationReport = { migrated: [], movedSkills: [], leftAlone: [] };
  const flat = skillsDir(root, projectId, agentId);
  let entries;
  try {
    entries = await fs.readdir(flat, { withFileTypes: true });
  } catch {
    return report;
  }
  const flatNames = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name);

  // Which plugin claims which flat Skill. Built from the caller's installed-plugin list so this
  // function needs no knowledge of the library — it moves directories, it does not decide meaning.
  const claimedBy = new Map<string, string>();
  for (const pluginName of installedPluginNames) {
    for (const member of await pluginMemberNames(root, projectId, agentId, pluginName)) {
      if (!claimedBy.has(member)) claimedBy.set(member, pluginName);
    }
  }

  for (const name of flatNames) {
    const owner = claimedBy.get(name);
    if (owner === undefined) {
      report.leftAlone.push(name);
      continue;
    }
    const id = builtinPluginId(owner);
    const target = path.join(pluginDir(root, projectId, agentId, id), "skills", name);
    // Already inside the plugin (a previous run): nothing to move, and re-reporting it would make
    // the caller think it had just been handled again.
    if (await dirExists(target)) {
      report.leftAlone.push(name);
      continue;
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    try {
      await fs.rename(path.join(flat, name), target);
      report.movedSkills.push(name);
      if (!report.migrated.includes(id)) report.migrated.push(id);
    } catch {
      // A copy that cannot be moved (locked on Windows, cross-device link) stays where it is and
      // is still readable from the flat tree, so this degrades to "not migrated", never to "lost".
      report.leftAlone.push(name);
    }
  }
  return report;
}

/**
 * The Skill names an installed plugin brought, from `.installs.json`.
 *
 * Read from the provenance record rather than from the library: this runs during migration, and a
 * plugin the current build no longer ships still has members on disk that must be moved to the
 * right place.
 */
async function pluginMemberNames(
  root: string,
  projectId: string,
  agentId: string,
  pluginName: string,
): Promise<string[]> {
  try {
    const { readInstalls } = await import("./installs.js");
    const file = await readInstalls(root, projectId, agentId);
    return file.plugins[pluginName]?.skills ?? [];
  } catch {
    return [];
  }
}