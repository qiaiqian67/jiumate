/**
 * Path guards shared by every writer that puts files under a Skill or plugin directory.
 *
 * Lives in `internal/` rather than in `agent-state.ts` because both that module and `plugin-store.ts`
 * need it, and `agent-state` already imports the store — a second copy of a traversal check is how
 * the two layouts drift, and the drift would be a path escape in exactly one of them.
 */
import path from "node:path";

/**
 * Guards a Skill auxiliary-file path (relative to the skill directory) before it's written:
 * rejects empty, absolute, backslash-bearing, and any `..`-segment path so a file entry can never
 * escape the directory it is meant to land in (`skills/<name>/` or `plugins/<id>/skills/<name>/`).
 * Mirrors the archive route's zip-slip check for the library-install path.
 *
 * Backslashes are refused on every platform, not just Windows: a backslash is a path separator to
 * the Node APIs on all of them, so accepting it here would leave a file writable outside the
 * directory by a path this check appears to have validated.
 */
export function assertSafeSkillFile(rel: string): void {
  if (
    rel.length === 0 ||
    path.isAbsolute(rel) ||
    rel.includes("\\") ||
    rel.split("/").some((segment) => segment === "..")
  ) {
    throw new Error(
      `Invalid skill file path ${JSON.stringify(rel)}: it must stay within the skill directory.`,
    );
  }
}
