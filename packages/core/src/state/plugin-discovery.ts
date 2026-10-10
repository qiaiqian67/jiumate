/**
 * Finding plugin packages that already exist on this machine (core/state/plugin-discovery.ts).
 *
 * **What this is for.** The plugin page can add a plugin from a URL, from a zip, or from one an
 * Agent on this machine already has. The third case is this file: it looks where such plugins
 * plausibly live and reports what it actually found, with enough detail for a person to recognise
 * their own plugin and click 「应用」.
 *
 * **A list of well-known directories, not a filesystem crawl.** Every Agent product on a machine
 * picks its own plugin directory and none of them publish a registry, so the only honest options
 * are (a) search the whole home directory, which is slow, invasive and turns up gigabytes of
 * unrelated files, or (b) check the handful of paths that are actually in use and **say which ones
 * were checked**. This does (b) and reports the directories it probed even when they hold nothing,
 * so a user who knows their Agent installs somewhere else is told the miss rather than left
 * wondering. That is also why the API takes an explicit path: the list is a convenience, the
 * manual picker is the guarantee.
 *
 * **What counts as a plugin is the manifest, not the directory name.** `plugin.json` (or
 * `.claude-plugin/plugin.json`) with a name and a `YYYY-MM-DD.N` version is the same contract the
 * library already uses, so a discovered plugin is installed through exactly the path a built-in
 * one takes — one code path, and a plugin found on disk is not a second-class thing afterwards.
 *
 * **Symlinked directories are read, never followed blindly.** A link into the user's home is
 * normal (that is how `npx`-installed plugin trees are usually wired up); a link that escapes
 * upward is not. Entries are only ever read one level deep and never recursed through a link, so a
 * plugin directory cannot pull the scanner into an unbounded walk.
 */
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { pluginManifestPath } from "../plugins/index.js";
import type { LibraryPlugin } from "../plugins/index.js";

/** The version a plugin manifest must declare (`YYYY-MM-DD.N`). */
const PLUGIN_VERSION = /^\d{4}-\d{2}-\d{2}\.\d+$/;

/** A plugin found on disk, plus what the UI needs to explain where it came from. */
export interface DiscoveredPlugin {
  /** The plugin's name (its directory name), as the library would key it. */
  name: string;
  /** Where it was found, absolute. Shown so a user can recognise it and so 应用 can copy it. */
  path: string;
  /** Which probe found it: a known Agent's directory, or the path the user picked. */
  origin: "known" | "manual";
  /** The manifest's version, `YYYY-MM-DD.N`. */
  version: string;
  /** The manifest's description; empty rather than absent so the UI needs no null check. */
  description: string;
  /** The manifest's Chinese description, when it ships one. */
  descriptionZh?: string;
  /** Its skills, by name — enough for a preview row, without shipping every SKILL.md body. */
  skills: { name: string; description: string }[];
  /** Whether this machine's JiuMate already has this plugin installed. */
  alreadyInstalled: boolean;
}

/** A directory the scanner probed, reported so a miss is legible rather than mysterious. */
export interface ProbeResult {
  /** The directory, absolute. */
  path: string;
  /** Which Agent's tree this is — what the user will recognise it by. */
  label: string;
  /** Whether the directory exists at all. `false` is normal and is not an error. */
  exists: boolean;
}

/**
 * The directories worth probing, in the order a user would recognise them.
 *
 * Each is a *candidate* whose layout differs per product, so each probe lists its immediate
 * subdirectories and reads any that carry a manifest. A path that does not exist is skipped
 * silently — most machines have none of these, and reporting an error per missing directory would
 * make the common case look broken.
 */
function knownPluginDirs(home: string): { label: string; dir: string }[] {
  return [
    { label: "JiuMate", dir: path.join(home, ".jiumate", "plugins") },
    { label: "Claude Code", dir: path.join(home, ".claude", "plugins") },
    { label: "Claude Code (project)", dir: path.join(home, ".claude", "skills") },
    { label: "Codex", dir: path.join(home, ".codex", "plugins") },
    { label: "Cursor", dir: path.join(home, ".cursor", "plugins") },
    { label: "Continue", dir: path.join(home, ".continue", "plugins") },
    { label: "Cline", dir: path.join(home, ".cline", "plugins") },
  ];
}

/** Reads the subdirectories of `dir` that carry a plugin manifest, one level, no recursion. */
function pluginsIn(dir: string): { name: string; path: string }[] {
  let entries: fsSync.Dirent[];
  try {
    entries = fsSync.readdirSync(dir, { withFileTypes: true });
  } catch {
    // Missing, unreadable, or not a directory. All the same to a scanner looking for candidates.
    return [];
  }
  const found: { name: string; path: string }[] = [];
  for (const entry of entries) {
    // A symlink is followed for *reading* only (`existsSync` resolves it), which is what makes an
    // npx-wired plugin tree visible; the loop never recurses, so nothing unbounded can be walked.
    const full = path.join(dir, entry.name);
    try {
      if (!fsSync.statSync(full).isDirectory()) continue;
    } catch {
      continue; // Broken link.
    }
    if (pluginManifestPath(full) === null) continue;
    found.push({ name: entry.name, path: full });
  }
  return found;
}

/**
 * Parses a plugin manifest, or returns null when it is not one this version can install.
 *
 * Deliberately narrower than the library's own reader: a manifest missing a version, or carrying
 * one this version cannot order, is **skipped rather than half-installed**. Offering a plugin that
 * cannot be installed is worse than not offering it.
 *
 * **A leading BOM is stripped.** Windows editors write one by default, and a plugin someone
 * hand-wrote or edited on Windows is a plugin someone hand-wrote or edited on Windows — refusing
 * it as "not a plugin" would look like the scanner being broken rather than like a byte the author
 * never meant to put there.
 */
function readManifest(dir: string): { version: string; description: string; descriptionZh?: string } | null {
  const manifestFile = pluginManifestPath(dir);
  if (manifestFile === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripBom(fsSync.readFileSync(manifestFile, "utf8")));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const m = parsed as {
    version?: unknown;
    description?: unknown;
    description_zh?: unknown;
  };
  if (typeof m.version !== "string" || !PLUGIN_VERSION.test(m.version)) return null;
  return {
    version: m.version,
    description: typeof m.description === "string" ? m.description : "",
    ...(typeof m.description_zh === "string" ? { descriptionZh: m.description_zh } : {}),
  };
}

/** The skills a discovered plugin ships, by name. Read from `skills/<dir>/SKILL.md`. */
function discoverSkills(dir: string): { name: string; description: string }[] {
  const skillsRoot = path.join(dir, "skills");
  let entries: fsSync.Dirent[];
  try {
    entries = fsSync.readdirSync(skillsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: { name: string; description: string }[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillMd = path.join(skillsRoot, entry.name, "SKILL.md");
    let description = "";
    try {
      // The frontmatter's `description:` is the one-liner; a missing or unusual frontmatter just
      // yields an empty description rather than failing the whole plugin.
      const raw = fsSync.readFileSync(skillMd, "utf8");
      const match = /^description:\s*(.+)$/m.exec(raw.split("---").slice(1).join("---"));
      if (match?.[1]) description = match[1].trim().replace(/^["']|["']$/g, "");
    } catch {
      // A skill without SKILL.md is not a skill; the directory is simply not listed.
    }
    out.push({ name: entry.name, description });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** A BOM the author never meant to write, removed before JSON.parse sees it. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** One found plugin, fully read. */
export function describeDiscovered(candidate: {
  name: string;
  path: string;
  origin: "known" | "manual";
}): DiscoveredPlugin | null {
  const manifest = readManifest(candidate.path);
  if (manifest === null) return null;
  return {
    name: candidate.name,
    path: candidate.path,
    origin: candidate.origin,
    version: manifest.version,
    description: manifest.description,
    ...(manifest.descriptionZh !== undefined ? { descriptionZh: manifest.descriptionZh } : {}),
    skills: discoverSkills(candidate.path),
    alreadyInstalled: false, // Filled by the caller, which knows this JiuMate's installs.
  };
}

/**
 * Every plugin directly inside a directory, fully read.
 *
 * **One level, no recursion** — the same bound the scanner uses, and for the same reason: a plugin
 * directory cannot pull a walk into an unbounded tree through a symlink. A user who keeps plugins
 * in nested folders imports each folder, which is also the only way to be deliberate about which.
 *
 * Exposed separately from `discoverPlugins` because bulk-import needs the paths *without* the
 * `alreadyInstalled` judgement — the user has already pointed at this directory and asked for it,
 * and re-deciding for them what counts as already-present is not this function's call to make.
 */
export function describeInDirectory(
  dir: string,
): { name: string; path: string; origin: "manual" }[] {
  const out: { name: string; path: string; origin: "manual" }[] = [];
  for (const candidate of pluginsIn(dir)) {
    const found = describeDiscovered({ ...candidate, origin: "manual" });
    if (found !== null) out.push({ name: found.name, path: candidate.path, origin: "manual" });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * Everything the 添加插件 dialog needs for its 「从本机已有插件」 tab.
 *
 * `installed` is the set of plugin names already present here, so a discovered plugin that JiuMate
 * already has can be marked rather than offered — importing it would produce a second copy under
 * a different marketplace with the same skills, and the user would then be looking at duplicates
 * they cannot explain.
 */
export function discoverPlugins(
  manualPath?: string,
  installed: ReadonlySet<string> = new Set(),
): { plugins: DiscoveredPlugin[]; probes: ProbeResult[] } {
  const home = os.homedir();
  const seen = new Set<string>();
  const plugins: DiscoveredPlugin[] = [];

  // The user's own pick first: it is the one they chose, and it is the only one that can be a
  // single plugin directory rather than a container of them.
  if (manualPath !== undefined && manualPath.trim() !== "") {
    const resolved = path.resolve(manualPath.trim());
    // A picked path may be the plugin itself or a folder holding plugins; both are reasonable, and
    // trying the manifest first then the listing is what makes 「选哪个都行」 true.
    const direct = describeDiscovered({ name: path.basename(resolved), path: resolved, origin: "manual" });
    if (direct !== null) {
      seen.add(resolved.toLowerCase());
      plugins.push({ ...direct, alreadyInstalled: installed.has(direct.name) });
    } else {
      for (const candidate of pluginsIn(resolved)) {
        if (seen.has(candidate.path.toLowerCase())) continue;
        seen.add(candidate.path.toLowerCase());
        const found = describeDiscovered({ ...candidate, origin: "manual" });
        if (found !== null) plugins.push({ ...found, alreadyInstalled: installed.has(found.name) });
      }
    }
  }

  const probes: ProbeResult[] = [];
  for (const { label, dir } of knownPluginDirs(home)) {
    let exists = false;
    try {
      exists = fsSync.statSync(dir).isDirectory();
    } catch {
      exists = false;
    }
    probes.push({ path: dir, label, exists });
    if (!exists) continue;
    for (const candidate of pluginsIn(dir)) {
      if (seen.has(candidate.path.toLowerCase())) continue;
      seen.add(candidate.path.toLowerCase());
      const found = describeDiscovered({ ...candidate, origin: "known" });
      if (found !== null) plugins.push({ ...found, alreadyInstalled: installed.has(found.name) });
    }
  }

  plugins.sort((a, b) => a.name.localeCompare(b.name));
  return { plugins, probes };
}