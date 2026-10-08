/**
 * Where each installed Skill and Hook package came from: `agent_state/.installs.json`.
 *
 * This exists because the filesystem cannot answer the question. `installPlugin` writes each of a
 * plugin's skills through `installSkill` and nothing else, so a skill installed *as part of* a
 * plugin and the same skill installed *on its own* leave byte-identical directories. Without a
 * record, "which skills came as one plugin" has no answer — and that answer is what a plugin-level
 * upgrade, a plugin-level uninstall and a card's own layout all need.
 *
 * **Not inside the Skill directories.** `replaceSkillDirectory` removes a directory and renames a
 * staged copy over it, so a receipt written as `skills/<name>/.receipt.json` would be deleted by
 * the next reinstall — and deleting it is the one thing this file must never do. It sits beside
 * `skills/` and `hooks/` instead, and it is a *cache of provenance*, not the truth: every writer
 * here derives the record from what it just wrote to disk, and a failed write degrades to "unknown
 * origin" rather than to a wrong answer.
 *
 * Two tables, because there are two things to track a version for. A plugin install records the
 * whole set it brought (`plugins[<name>].skills`) so an upgrade knows which directories are its
 * own to overwrite; a standalone install records one entry so the same skill later arriving via a
 * plugin can be recognised as having moved from one to the other.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { agentStateDir } from "./paths.js";

/**
 * Id rule for the project/agent this file is keyed by (prevents path traversal).
 *
 * Deliberately a private copy rather than an import of `agent-state`'s `assertValidId`: this
 * module is imported *by* `agent-state`, so sharing the helper would be a cycle, and moving it
 * into a third module to break that would be a larger change than the rule is worth. Both copies
 * test the same pattern, which is asserted in this file's tests.
 */
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Schema version, bumped when the on-disk shape changes incompatibly.
 *
 * A file carrying a version this build does not know is treated as absent rather than parsed
 * best-effort: a future shape read with today's reader could produce confidently wrong provenance,
 * which is worse than admitting the origin is unknown.
 */
export const INSTALLS_SCHEMA_VERSION = 1;

/** Conventional filename beside `skills/`. Dot-prefixed so it is never mistaken for content. */
export const INSTALLS_FILENAME = ".installs.json";

/** How one installed Skill arrived. */
export type InstallSource = "library" | "import";

/** A plugin as installed on one Agent: the version, and every directory it brought with it. */
export interface PluginInstallRecord {
  /** The library version installed, or null for one installed before versions were recorded. */
  version: string | null;
  /**
   * Skill names this plugin install brought.
   *
   * Not a cache of the library's own skill list: a skill the user deleted afterwards is
   * deliberately still named here, because that is what lets an upgrade tell "mine to overwrite"
   * from "not mine", and what makes an incomplete plugin visible rather than silently whole.
   */
  skills: string[];
  /** Hook package names, when the plugin ships one (recorded for the same reason). */
  hooks: string[];
}

/** A Skill installed on its own rather than through a plugin. */
export interface SkillInstallRecord {
  /** The library version, or null for an import (which carries its own, if any). */
  version: string | null;
  source: InstallSource;
}

export interface InstallsFile {
  version: number;
  /** Plugin name → what installing it brought. */
  plugins: Record<string, PluginInstallRecord>;
  /** Skill name → how it arrived, for skills that did not arrive through a plugin. */
  skills: Record<string, SkillInstallRecord>;
}

const EMPTY: InstallsFile = { version: INSTALLS_SCHEMA_VERSION, plugins: {}, skills: {} };

/** Absolute path to one Agent's install record. */
export function installsFile(root: string, projectId: string, agentId: string): string {
  for (const [kind, id] of [
    ["project_id", projectId],
    ["agent_id", agentId],
  ] as const) {
    if (!ID_PATTERN.test(id)) {
      throw new Error(
        `Invalid ${kind} ${JSON.stringify(id)}: only letters, digits, "_" and "-" are allowed.`,
      );
    }
  }
  return path.join(agentStateDir(root, projectId, agentId), INSTALLS_FILENAME);
}

/**
 * Reads one Agent's install record, or an empty one.
 *
 * Every failure path yields `EMPTY` rather than throwing: a missing file is the normal state for
 * an Agent installed before this existed, and a corrupt one must not make the Skills page fail —
 * the skills themselves are read from disk and are unaffected by this file. Returning empty means
 * "nothing is known", which the UI shows as an unknown origin.
 */
export async function readInstalls(
  root: string,
  projectId: string,
  agentId: string,
): Promise<InstallsFile> {
  let raw: string;
  try {
    raw = await fs.readFile(installsFile(root, projectId, agentId), "utf8");
  } catch {
    return { ...EMPTY, plugins: {}, skills: {} };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<InstallsFile>;
    // A shape this build does not recognise is not guessed at. See INSTALLS_SCHEMA_VERSION.
    if (parsed.version !== INSTALLS_SCHEMA_VERSION) return { ...EMPTY, plugins: {}, skills: {} };
    return {
      version: INSTALLS_SCHEMA_VERSION,
      plugins:
        parsed.plugins !== undefined && typeof parsed.plugins === "object" ? parsed.plugins : {},
      skills: parsed.skills !== undefined && typeof parsed.skills === "object" ? parsed.skills : {},
    };
  } catch {
    return { ...EMPTY, plugins: {}, skills: {} };
  }
}

/**
 * Writes the record back, creating `agent_state/` if needed.
 *
 * Atomic via a staged rename, so an interrupted write cannot leave a truncated file that would
 * read as "nothing is known" on the next page load.
 */
export async function writeInstalls(
  root: string,
  projectId: string,
  agentId: string,
  file: InstallsFile,
): Promise<void> {
  const target = installsFile(root, projectId, agentId);
  const staging = `${target}.incoming`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(staging, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  await fs.rename(staging, target);
}

/**
 * Applies one mutation to the record and writes it, reading first if no current value is supplied.
 *
 * `mutate` receives a copy, so a caller cannot accidentally write back the object it read while
 * another change landed in between — the read-modify-write is the whole operation and there is no
 * window for the caller to widen it.
 */
export async function updateInstalls(
  root: string,
  projectId: string,
  agentId: string,
  current: InstallsFile | undefined,
  mutate: (file: InstallsFile) => void,
): Promise<InstallsFile> {
  const file = current ?? (await readInstalls(root, projectId, agentId));
  const next: InstallsFile = {
    version: INSTALLS_SCHEMA_VERSION,
    plugins: { ...file.plugins },
    skills: { ...file.skills },
  };
  mutate(next);
  await writeInstalls(root, projectId, agentId, next);
  return next;
}
