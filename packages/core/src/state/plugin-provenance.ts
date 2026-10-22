/**
 * Where an added plugin came from, kept beside it so it can be updated later.
 *
 * **Why this exists.** `升级` is defined as "go back to wherever this was installed from, ask
 * whether it is newer, and if so fetch it again". Two thirds of that need the address, and an
 * archive does not carry it: a zip of a repository is byte-identical whichever URL produced it, so
 * once the download is unpacked the source is simply gone. A plugin added from a folder cannot be
 * updated at all, which is a fact worth recording too rather than discovering at upgrade time.
 *
 * **Written once, read by upgrades, and never trusted by anything else.** It is metadata about a
 * fetch, not configuration: it says where bytes came from, never what to execute. Nothing in the
 * runtime reads it, so a stale or wrong entry costs a failed upgrade check and nothing more.
 *
 * **A plugin with no record is not an error.** Every plugin predating this file, and every built-in
 * one, has none. `readProvenance` returns null for those, and the caller says "no update source"
 * rather than refusing to act.
 */
import fs from "node:fs/promises";
import path from "node:path";

/** How a plugin reached this machine. */
export interface PluginProvenance {
  /**
   * The archive URL to re-fetch on an upgrade. Absent for a plugin added from a folder: there is
   * no remote to ask, so there is nothing an upgrade could check.
   */
  sourceUrl?: string;
  /** `owner/repo`, for naming the source in the UI and in an error message. */
  sourceRepo?: string;
  /** The branch the archive was taken from, so an upgrade checks the same one that was installed. */
  sourceBranch?: string;
  /** The absolute directory a plugin was copied from, when it was added from one. */
  sourcePath?: string;
  /** When it was added (ms since epoch) — the fallback comparison for a source with no version to ask. */
  addedAt: number;
}

const PROVENANCE_FILE = ".provenance.json";

function provenanceFile(pluginDir: string): string {
  return path.join(pluginDir, PROVENANCE_FILE);
}

/** Records where a plugin came from. Overwrites an earlier record: a re-import replaces the source. */
export async function writeProvenance(pluginDir: string, info: PluginProvenance): Promise<void> {
  await fs.writeFile(provenanceFile(pluginDir), `${JSON.stringify(info, null, 2)}\n`, "utf8");
}

/** Where a plugin came from, or null when nothing recorded one. */
export async function readProvenance(pluginDir: string): Promise<PluginProvenance | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(provenanceFile(pluginDir), "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    const p = parsed as PluginProvenance;
    return typeof p.addedAt === "number" ? p : null;
  } catch {
    // No file, or unreadable. Both mean the same thing to a caller: no recorded source.
    return null;
  }
}

/**
 * Whether a plugin can be checked for updates at all.
 *
 * A folder source is deliberately excluded: the copy is ours, it may have been edited by hand, and
 * "upgrading" it would mean overwriting local edits with whatever is on disk now. A user who wants
 * that can re-add it, which is an explicit act.
 */
export function canUpgrade(provenance: PluginProvenance | null): boolean {
  return (
    provenance !== null && typeof provenance.sourceUrl === "string" && provenance.sourceUrl !== ""
  );
}

/**
 * Whether a fetched version is newer than the installed one.
 *
 * **Compared as versions, not as dates, and not as strings.** The format is `YYYY-MM-DD.N`, so a
 * string compare gets the two fields backwards — `2026-09-02.1` sorts *below* `2026-08-04.1` as text
 * because "0" < "1" at the tenth character, which would offer a downgrade as an upgrade. The date
 * part is compared numerically, then the revision, so only a genuinely newer version counts.
 *
 * An unparseable version compares as "not newer" rather than as newer: an upgrade that overwrites a
 * working plugin on the strength of a version string nobody can read is the wrong trade.
 */
export function isNewerVersion(candidate: string, installed: string): boolean {
  const parse = (v: string): { date: number; rev: number } | null => {
    const m = /^(\d{4})-(\d{2})-(\d{2})\.(\d+)$/.exec(v.trim());
    if (m === null) return null;
    return {
      // As one number: a lexicographic compare of the date part is equivalent for zero-padded
      // yyyy-mm-dd, and this avoids any question about locale-aware comparison.
      date: Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]),
      rev: Number(m[4]),
    };
  };
  const a = parse(candidate);
  const b = parse(installed);
  if (a === null || b === null) return false;
  if (a.date !== b.date) return a.date > b.date;
  return a.rev > b.rev;
}
