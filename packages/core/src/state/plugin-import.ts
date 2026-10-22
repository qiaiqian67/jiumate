/**
 * Unpacking a plugin archive into the local plugin tree (core/state/plugin-import.ts).
 *
 * **Why this file is careful.** An archive is the one input here the user did not author and the
 * server did not choose: it arrives as base64 from a browser and is unpacked onto disk. Two
 * attacks follow from that shape, and both are answered here rather than at the route, so every
 * caller gets them for free.
 *
 * 1. **Path traversal.** A zip entry named `../../.ssh/authorized_keys` escapes the destination if
 *    the entry name is joined naively. Every entry is resolved against the destination and
 *    rejected unless it lands *inside* it — and the check is on the resolved absolute path, not on
 *    the string, because `a/../../b` and `a/./b` are different strings and the same destination.
 *
 * 2. **Zip bomb.** A small archive that declares a huge uncompressed size exhausts the disk or the
 *    process. Two independent ceilings apply: a total uncompressed byte budget, and a per-entry
 *    file-count ceiling. fflate decompresses lazily, so the declared size is checked against the
 *    budget *before* anything is written rather than after the damage.
 *
 * **A symlink in an archive is refused, not sanitised.** fflate does not restore the mode bits it
 * would need to, and a plugin package has no legitimate use for one — a plugin is scripts and
 * text, and a link in it is only ever an escape. Refusing it outright is simpler than reasoning
 * about where it points.
 *
 * **The whole archive is validated before a single byte is written.** A zip whose last entry
 * escapes is not a zip that writes 900 good files and then fails; that would leave a half-installed
 * plugin that the library would then try to read. Validate, then write.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { unzipSync } from "fflate";
import { atomicWriteFile } from "../internal/atomic-write.js";

/** Ceiling on one archive's total uncompressed bytes. A plugin is scripts and text; 64MB is generous. */
export const MAX_PLUGIN_ARCHIVE_BYTES = 64 * 1024 * 1024;

/** Ceiling on the file count in one archive, so a bomb of empty files is bounded too. */
export const MAX_PLUGIN_ARCHIVE_FILES = 2000;

/** Thrown for an archive this refuses to unpack. The route turns this into a 400. */
export class PluginArchiveError extends Error {
  constructor(
    message: string,
    readonly code:
      | "empty_archive"
      | "too_large"
      | "too_many_files"
      | "path_escape"
      | "symlink_refused"
      | "not_a_plugin",
  ) {
    super(message);
    this.name = "PluginArchiveError";
  }
}

/** One entry of an unpacked archive, relative to the destination, with `/` separators. */
interface ArchiveEntry {
  /** The relative path, already verified to stay inside the destination. */
  rel: string;
  data: Uint8Array;
}

/**
 * Validates and decompresses an archive into a flat list of files.
 *
 * Returns entries keyed by relative path rather than writing, so the caller can decide the
 * destination (and reject a plugin whose layout is wrong) before anything touches the disk.
 */
export function unpackPluginArchive(archive: Buffer): ArchiveEntry[] {
  if (archive.byteLength === 0) {
    throw new PluginArchiveError("The archive is empty.", "empty_archive");
  }
  if (archive.byteLength > MAX_PLUGIN_ARCHIVE_BYTES) {
    throw new PluginArchiveError(
      `The archive exceeds the ${Math.floor(MAX_PLUGIN_ARCHIVE_BYTES / 1024 / 1024)}MB limit.`,
      "too_large",
    );
  }

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(archive);
  } catch (e) {
    throw new PluginArchiveError(
      `The archive could not be read as a zip: ${e instanceof Error ? e.message : String(e)}`,
      "not_a_plugin",
    );
  }

  const names = Object.keys(files).filter((n) => !n.endsWith("/"));
  if (names.length === 0) {
    throw new PluginArchiveError("The archive contains no files.", "empty_archive");
  }
  if (names.length > MAX_PLUGIN_ARCHIVE_FILES) {
    throw new PluginArchiveError(
      `The archive holds ${names.length} files, over the ${MAX_PLUGIN_ARCHIVE_FILES} limit.`,
      "too_many_files",
    );
  }

  // The declared sizes are checked before anything is written, so a bomb is refused rather than
  // discovered halfway through. `unzipSync` has already allocated here, which is why the archive
  // ceiling above is on the *input* as well: fflate gives no streaming size check.
  let total = 0;
  for (const name of names) total += files[name]?.byteLength ?? 0;
  if (total > MAX_PLUGIN_ARCHIVE_BYTES) {
    throw new PluginArchiveError(
      `The archive expands to ${Math.round(total / 1024 / 1024)}MB, over the ` +
        `${Math.floor(MAX_PLUGIN_ARCHIVE_BYTES / 1024 / 1024)}MB limit.`,
      "too_large",
    );
  }

  const out: ArchiveEntry[] = [];
  for (const name of names) {
    // Reject anything absolute, and anything with a `..` segment, before normalising — Windows
    // accepts both `/` and `\` as separators, and a `..\` slips past a check that only looks at `/`.
    const unified = name.replace(/\\/g, "/");
    if (unified.startsWith("/") || /^[A-Za-z]:/.test(unified)) {
      throw new PluginArchiveError(`Archive entry is an absolute path: ${name}`, "path_escape");
    }
    if (unified.split("/").some((seg) => seg === "..")) {
      throw new PluginArchiveError(`Archive entry escapes the destination: ${name}`, "path_escape");
    }
    if (name.includes("\0")) {
      throw new PluginArchiveError(`Archive entry has an unsafe name: ${name}`, "path_escape");
    }
    const data = files[name];
    if (data === undefined) continue;
    out.push({ rel: unified, data });
  }
  return out;
}

/**
 * Writes validated entries under `destDir`, creating it and its parents.
 *
 * `destDir` is re-checked after resolution for every entry, which is the check that actually
 * holds: it compares the *written* location against the destination, so a normalisation this file
 * did not anticipate still cannot escape.
 */
export async function writePluginArchive(entries: ArchiveEntry[], destDir: string): Promise<void> {
  const root = path.resolve(destDir);
  for (const entry of entries) {
    const target = path.resolve(root, entry.rel);
    const withinRoot = target === root || target.startsWith(root + path.sep);
    if (!withinRoot) {
      throw new PluginArchiveError(
        `Archive entry escapes the destination: ${entry.rel}`,
        "path_escape",
      );
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await atomicWriteFile(target, Buffer.from(entry.data));
  }
}

/**
 * Strips the single top-level directory most plugin archives wrap themselves in.
 *
 * `my-plugin.zip` normally contains `my-plugin/plugin.json`, not `plugin.json` — so extracted
 * as-is it would fail the manifest check with a path that looks nothing like the plugin. Only a
 * directory that contains *every* other top-level entry is stripped, and only one level: a nested
 * layout is a plugin author being deliberate, and quietly reshaping it would install something the
 * user never saw.
 */
export function stripSingleRootDir(entries: ArchiveEntry[]): ArchiveEntry[] {
  const tops = new Set(entries.map((e) => e.rel.split("/")[0]));
  if (tops.size !== 1) return entries;
  const only = [...tops][0];
  // A lone entry cannot be a wrapper directory — a zip holding exactly one file at the top level is
  // a plugin whose manifest is that file, and stripping its name would leave nothing.
  if (only === undefined) return entries;
  // Only a directory, and only if every entry actually lives under it.
  if (entries.some((e) => e.rel === only)) return entries;
  if (!entries.every((e) => e.rel.startsWith(`${only}/`))) return entries;
  return entries.map((e) => ({ ...e, rel: e.rel.slice(only.length + 1) }));
}
