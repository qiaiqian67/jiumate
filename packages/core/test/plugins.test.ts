/**
 * The plugin library's file source of truth and core's loader: one npm package per plugin under the repo's `plugins/`
 * (manifest fields, the skills and hook packages they ship), the version scheme, the
 * category grouping, the preinstall filter, the name lookups, the doc conventions every
 * shipped skill follows, and the README tables that repeat the library for human readers.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PLUGIN_CATEGORIES,
  PLUGIN_VERSION_PATTERN,
  comparePluginVersions,
  groupPlugins,
  libraryPlugin,
  librarySkill,
  loadLibraryPlugins,
  loadPluginCategories,
  loadPluginGroups,
  loadPreinstalledPlugins,
  parseSkillFrontmatter,
  pluginManifestPath,
  type LibraryPlugin,
  type PluginCategory,
} from "../src/plugins/index.js";

const pluginsRoot = path.resolve(import.meta.dirname, "../../../plugins");

/** Minimal LibraryPlugin for groupPlugins unit tests. */
const fakePlugin = (name: string, category?: string): LibraryPlugin => ({
  name,
  description: `Do ${name}.`,
  version: "2026-08-29.1",
  preinstall: true,
  skills: [],
  ...(category !== undefined ? { category } : {}),
});

describe("pluginManifestPath", () => {
  it("prefers .claude-plugin/plugin.json and falls back to a root plugin.json", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jiumate-manifest-"));
    try {
      // Neither: nothing to read.
      expect(pluginManifestPath(dir)).toBeNull();

      // The legacy location keeps working.
      await fs.writeFile(path.join(dir, "plugin.json"), "{}", "utf8");
      expect(pluginManifestPath(dir)).toBe(path.join(dir, "plugin.json"));

      // The conventional location wins when both are present: it is the upstream statement of what
      // the plugin is, and writing both copies would let them drift.
      await fs.mkdir(path.join(dir, ".claude-plugin"), { recursive: true });
      await fs.writeFile(path.join(dir, ".claude-plugin", "plugin.json"), "{}", "utf8");
      expect(pluginManifestPath(dir)).toBe(path.join(dir, ".claude-plugin", "plugin.json"));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("loadPluginCategories", () => {
  it("falls back to the shipped list when no plugin root carries marketplace.json", () => {
    // The repo's plugins/ carry no marketplace file, so this is the fallback being exercised.
    expect(loadPluginCategories()).toEqual(PLUGIN_CATEGORIES);
  });
});

describe("loadLibraryPlugins", () => {
  it("loads every plugin directory sorted by name, each with a date-sequence version and a category", () => {
    const plugins = loadLibraryPlugins();
    expect(plugins.map((p) => p.name)).toEqual([...plugins.map((p) => p.name)].sort());
    // Not an exact count: every ported plugin added here would otherwise need this line edited,
    // and the assertion that would have caught the *first* mistake — a plugin whose files are
    // malformed and therefore skipped — is the per-plugin loop below, which runs over whatever
    // was loaded. A floor catches "the library came back empty", which is the failure that
    // matters; the loop catches a bad one.
    expect(plugins.length).toBeGreaterThan(0);
    for (const plugin of plugins) {
      expect(plugin.version, plugin.name).toMatch(PLUGIN_VERSION_PATTERN);
      expect(
        PLUGIN_CATEGORIES.map((c) => c.id),
        plugin.name,
      ).toContain(plugin.category);
      expect(plugin.description.length, plugin.name).toBeGreaterThan(0);
      expect(plugin.skills.length > 0 || plugin.hooks !== undefined, plugin.name).toBe(true);
    }
  });

  it("stamps the plugin's metadata into each skill: slim file frontmatter, full installable frontmatter", async () => {
    for (const plugin of loadLibraryPlugins()) {
      // Chinese in a manifest is written as real characters, not \uXXXX escapes.
      const rawManifest = await fs.readFile(
        path.join(pluginsRoot, plugin.name, "plugin.json"),
        "utf8",
      );
      expect(rawManifest, `${plugin.name} plugin.json escapes`).not.toMatch(/\\u[0-9a-fA-F]{4}/);
      // Every built-in plugin ships an icon.svg beside plugin.json.
      expect(plugin.icon, `${plugin.name} icon.svg`).toBeDefined();
      expect(plugin.icon).toMatch(/^<svg[\s\S]*<\/svg>\s*$/);
      expect(plugin.icon).not.toMatch(/<script/i);
      for (const skill of plugin.skills) {
        const dir = path.join(pluginsRoot, plugin.name, "skills", skill.name);
        const file = await fs.readFile(path.join(dir, "SKILL.md"), "utf8");
        // The library file carries only name + description; plugin.json is the metadata holder.
        // `required_env` is the exception: it has no home in plugin.json (a plugin's skills may
        // each need different credentials), so it is the one declaration a skill's own file has
        // to carry — and it has to survive the stamp, or an installed copy would arrive with no
        // record of what it needs.
        const fileFront = /^---\n([\s\S]*?)\n---/.exec(file)![1]!;
        expect(fileFront, `${plugin.name}/${skill.name} file frontmatter`).not.toMatch(
          /^(version|short_description|short_description_zh):/m,
        );
        // The installable content regenerates the frontmatter with the plugin's fields and
        // keeps the body verbatim.
        const meta = parseSkillFrontmatter(skill.content)!;
        expect(meta.version, `${plugin.name}/${skill.name} version`).toBe(plugin.version);
        expect(skill.version).toBe(plugin.version);
        expect(meta.shortDescriptionZh).toBe(plugin.shortDescriptionZh);
        // The credential declaration has to reach the installed copy. It is the only field a
        // skill's own frontmatter holds that the stamp has to carry over, so a skill needing a
        // key would otherwise install with nothing to tell the UI it is not ready to run.
        expect(meta.requiredEnv, `${plugin.name}/${skill.name} requiredEnv`).toEqual(
          parseSkillFrontmatter(file)?.requiredEnv,
        );
        expect(skill.content.endsWith(file.replace(/^---\n[\s\S]*?\n---/, ""))).toBe(true);
        // A skill's icon is its plugin's, stamped by the loader — no skill directory ships
        // an icon.svg of its own.
        expect(skill.icon, `${plugin.name}/${skill.name} icon`).toBe(plugin.icon);
        await expect(fs.access(path.join(dir, "icon.svg"))).rejects.toThrow();
        // Every shipped skill asks before starting when the message only names it.
        expect(skill.content, `${skill.name} lacks ## Before you start`).toMatch(
          /^## Before you start$/m,
        );
      }
    }
  });

  it("collects auxiliary files a SKILL.md references (reference/*), excluding SKILL.md and icon.svg", () => {
    const humanizer = librarySkill("humanizer");
    expect(humanizer).toBeDefined();
    const files = humanizer!.skill.files ?? {};
    expect(Object.keys(files).length).toBeGreaterThan(0);
    expect(Object.keys(files).every((rel) => rel !== "SKILL.md" && rel !== "icon.svg")).toBe(true);
    expect(Object.keys(files).some((rel) => rel.startsWith("reference/"))).toBe(true);
  });

  it("a hook plugin carries a manifest naming its stop scripts and the hooks/ files to install", () => {
    const goal = libraryPlugin("goal");
    expect(goal?.hooks?.manifest).toMatchObject({
      name: "goal",
      version: goal!.version,
      stop: [{ command: "stop.mjs", timeout: 60 }],
      pre_tool_use: [],
      user_prompt: [{ command: "start.mjs", timeout: 60 }],
    });
    expect(goal!.hooks!.manifest.description_zh).toBeDefined();
    expect(Object.keys(goal!.hooks!.files).sort()).toEqual(["lib.mjs", "start.mjs", "stop.mjs"]);
    expect(goal!.skills).toEqual([]);
    const learning = libraryPlugin("continual-learning");
    expect(learning?.hooks?.manifest.stop).toEqual([{ command: "stop.mjs", timeout: 60 }]);
    expect(Object.keys(learning!.hooks!.files)).toEqual(["stop.mjs"]);
  });

  it("a single-skill plugin reads as its own; a merged plugin's skills each resolve to it", () => {
    const plugin = libraryPlugin("data-analysis")!;
    expect(plugin.description.length).toBeGreaterThan(0);
    expect(plugin.skills).toHaveLength(1);
    // Merged plugins carry several skills, each still resolvable by its own name.
    expect(librarySkill("web-design")?.plugin.name).toBe("software-development");
    expect(librarySkill("unified-llm-api")?.plugin.name).toBe("agent-development");
    expect(librarySkill("jiumate-config")?.plugin.name).toBe("agent-development");
  });
});

describe("loadPreinstalledPlugins", () => {
  it("excludes plugins whose manifest sets preinstall: false and keeps everything else", () => {
    const all = loadLibraryPlugins().map((p) => p.name);
    const preinstalled = loadPreinstalledPlugins().map((p) => p.name);
    expect(preinstalled).toContain("goal");
    expect(preinstalled).toContain("software-development");
    for (const manual of ["continual-learning", "humanizer", "use-claude-code"]) {
      expect(all).toContain(manual);
      expect(preinstalled).not.toContain(manual);
    }
  });
});

describe("comparePluginVersions", () => {
  it("orders by date, then by sequence number numerically; non-versions sort before every version", () => {
    expect(comparePluginVersions("2026-08-29.1", "2026-08-29.1")).toBe(0);
    expect(comparePluginVersions("2026-08-29.2", "2026-08-29.10")).toBeLessThan(0);
    expect(comparePluginVersions("2026-09-01.1", "2026-08-29.9")).toBeGreaterThan(0);
    expect(comparePluginVersions("", "2026-08-29.1")).toBeLessThan(0);
    expect(comparePluginVersions("7", "2026-08-29.1")).toBeLessThan(0);
    expect(comparePluginVersions("", "")).toBe(0);
  });
});

describe("groupPlugins / loadPluginGroups", () => {
  it("groups by category in manifest order, members sorted, empty categories omitted, unknown ones in Other", () => {
    const groups = groupPlugins([
      fakePlugin("b", "ai-app-development"),
      fakePlugin("a", "ai-app-development"),
      fakePlugin("z"),
      fakePlugin("y", "made-up"),
      fakePlugin("h", "office-productivity"),
    ]);
    expect(groups.map((g) => [g.id, g.plugins.map((p) => p.name)])).toEqual([
      ["office-productivity", ["h"]],
      ["ai-app-development", ["a", "b"]],
      ["other", ["y", "z"]],
    ]);
    expect(groups[2]).toMatchObject({ title: "Other", titleZh: "其他" });
  });

  it("the library itself fills the three categories and leaves no Other group; hook packages sit with their audience", () => {
    const groups = loadPluginGroups();
    expect(groups.map((g) => g.id)).toEqual(PLUGIN_CATEGORIES.map((c) => c.id));
    const names = (id: string) => groups.find((g) => g.id === id)?.plugins.map((p) => p.name);
    expect(names("office-productivity")).toEqual([
      "a2ui",
      "browser-automation",
      "continual-learning",
      "data-analysis",
      "goal",
      "humanizer",
      "use-bento-slides",
      "use-firecrawl",
    ]);
    expect(names("ai-app-development")).toEqual([
      "ace-rsi-toolkit",
      "agent-development",
      "agent-tuning",
      "ape-rsi-toolkit",
      "awm-rsi-toolkit",
      "model-development",
      "opro-rsi-toolkit",
      "skill-porting",
    ]);
  });
});

describe("lookups", () => {
  it("libraryPlugin and librarySkill find by name; illegal names never touch the filesystem", () => {
    expect(libraryPlugin("goal")?.name).toBe("goal");
    expect(libraryPlugin("does-not-exist")).toBeUndefined();
    expect(libraryPlugin("../etc")).toBeUndefined();
    expect(librarySkill("goal")).toBeUndefined();
    expect(librarySkill("..")).toBeUndefined();
  });
});

describe("parseSkillFrontmatter", () => {
  it("parses name/description/version and the optional short descriptions; values may contain colons", () => {
    const meta = parseSkillFrontmatter(
      "---\nname: x\ndescription: a: b\nshort_description: s\nshort_description_zh: 中\nversion: 2026-08-29.3\n---\nbody",
    );
    expect(meta).toEqual({
      name: "x",
      description: "a: b",
      shortDescription: "s",
      shortDescriptionZh: "中",
      version: "2026-08-29.3",
    });
  });

  it("tolerates a BOM and CRLF, drops a malformed version to the empty string, and needs a name", () => {
    expect(parseSkillFrontmatter("﻿---\r\nname: x\r\nversion: 9\r\n---\r\nbody")).toEqual({
      name: "x",
      description: "",
      version: "",
    });
    expect(parseSkillFrontmatter("no frontmatter")).toBeNull();
    expect(parseSkillFrontmatter("---\ndescription: d\n---\n")).toBeNull();
  });

  it("reads required_env as a comma-separated list, and omits it when empty", () => {
    // The field is what lets the UI say "this skill needs a credential you have not set"
    // instead of leaving the user to find out from a failed call, so both halves matter: a
    // declared list, and no field at all when the skill declares nothing (an empty list would
    // render a permanently-unset key mark on skills that need no key).
    expect(
      parseSkillFrontmatter("---\nname: x\nrequired_env: EXA_API_KEY, FOO_TOKEN\n---\nbody")
        ?.requiredEnv,
    ).toEqual(["EXA_API_KEY", "FOO_TOKEN"]);
    expect(
      parseSkillFrontmatter("---\nname: x\nrequired_env:  A , , B  \n---\nbody")?.requiredEnv,
    ).toEqual(["A", "B"]);
    // Absent, blank, or only separators: the key is omitted rather than set to [].
    expect(parseSkillFrontmatter("---\nname: x\n---\nbody")).not.toHaveProperty("requiredEnv");
    expect(parseSkillFrontmatter("---\nname: x\nrequired_env:   \n---\nbody")).not.toHaveProperty(
      "requiredEnv",
    );
    expect(parseSkillFrontmatter("---\nname: x\nrequired_env: , ,\n---\nbody")).not.toHaveProperty(
      "requiredEnv",
    );
  });
});

/**
 * This package's README and the repository's two root READMEs each repeat the library as a
 * table for human readers, and nothing else reads those tables. Derived from the library
 * rather than pinned, so adding a plugin — or filing it under the wrong heading — fails here
 * instead of leaving a table quietly wrong; the docs pages get the same guard from docs'
 * skills-sync test.
 */
const README_TABLES = [
  {
    label: "plugins/README.md",
    file: "../../../plugins/README.md",
    heading: (c: PluginCategory) => c.title,
  },
  { label: "README.md", file: "../../../README.md", heading: (c: PluginCategory) => c.title },
  {
    label: "README.zh.md",
    file: "../../../README.zh.md",
    heading: (c: PluginCategory) => c.titleZh ?? c.title,
  },
];

/** Rows of a README's category table, located by its `Category` / `分类` header row. */
function readmeTableRows(markdown: string): Array<{ group: string; plugins: string[] }> {
  const lines = markdown.split("\n");
  const header = lines.findIndex((line) => /^\|\s*(?:Category|分类)\s*\|/.test(line));
  if (header === -1) return [];
  const rows: Array<{ group: string; plugins: string[] }> = [];
  for (const line of lines.slice(header + 1)) {
    if (!line.startsWith("|")) break;
    const cells = line.split("|").slice(1, -1);
    if (cells.length < 2) continue;
    const group = cells[0]!.trim();
    if (/^:?-{3,}:?$/.test(group)) continue;
    rows.push({ group, plugins: [...cells[1]!.matchAll(/`([^`]+)`/g)].map((m) => m[1]!) });
  }
  return rows;
}

describe("README category tables", () => {
  for (const { label, file, heading } of README_TABLES) {
    it(`${label} names exactly the library's plugins, each under its own category`, async () => {
      const markdown = await fs.readFile(path.resolve(import.meta.dirname, file), "utf8");
      const rows = readmeTableRows(markdown);
      expect(rows.length, `no Category/分类 table found in ${label}`).toBeGreaterThan(0);
      const groups = loadPluginGroups();
      expect(rows.map((row) => row.group).sort()).toEqual(groups.map(heading).sort());
      for (const group of groups) {
        const row = rows.find((entry) => entry.group === heading(group));
        expect(
          [...(row?.plugins ?? [])].sort(),
          `plugins under "${heading(group)}" in ${label}`,
        ).toEqual(group.plugins.map((p) => p.name).sort());
      }
    });
  }
});
