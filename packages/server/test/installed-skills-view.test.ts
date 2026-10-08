/**
 * The installed-skills grouping is the thing that answers "which plugin is this Skill part of",
 * and its failure mode is a plausible-looking wrong layout rather than an error — so the rules are
 * pinned here rather than left to be re-derived.
 *
 * The cases that matter:
 *
 *   - a recorded install is authoritative, and an inferred one is marked as such;
 *   - inference only attributes a Skill when its plugin's Skills are **all** present, because
 *     attributing a partial install would claim ownership of Skills the user chose to install
 *     alone;
 *   - a Skill the library does not ship is the user's own, whatever a stale record claims;
 *   - a plugin missing a member is reported as incomplete rather than as whole.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { skillsDir, writeInstalls } from "@prismshadow/jiumate-core";
import { buildInstalledSkillsView } from "../src/services/installed-skills-view.js";

describe("buildInstalledSkillsView", () => {
  let root: string;
  const projectId = "p_view";
  const agentId = "a_view";

  /** Writes a skill directory, which is all the loader's output depends on. */
  async function writeSkill(agent: string, name: string): Promise<void> {
    const dir = path.join(skillsDir(root, projectId, agent), name);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${name} description\n---\n\nbody\n`,
      "utf8",
    );
  }

  /** What the loader would return for one Agent's directory. */
  async function listed(
    agent: string,
  ): Promise<{ name: string; description: string; version: string }[]> {
    const dir = skillsDir(root, projectId, agent);
    let entries: string[];
    try {
      entries = (await fs.readdir(dir, { withFileTypes: true }))
        .filter((e) => e.isDirectory() && !e.name.startsWith("."))
        .map((e) => e.name);
    } catch {
      return [];
    }
    return entries
      .sort()
      .map((name) => ({ name, description: `${name} description`, version: "" }));
  }

  /** Builds the view from the current on-disk skills, as the route does. */
  async function view(agents: string[] = [agentId]) {
    const skillsByAgent = new Map<
      string,
      { name: string; description: string; version: string }[]
    >();
    for (const agent of agents) skillsByAgent.set(agent, await listed(agent));
    return buildInstalledSkillsView(root, projectId, agents, skillsByAgent);
  }

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "jiumate-view-"));
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("attributes a plugin's skills to it, and marks the attribution as inferred", async () => {
    // agent-tuning ships four; all four present.
    for (const name of [
      "agent-evaluation",
      "agent-initialization",
      "agent-optimization",
      "benchmark-design",
    ]) {
      await writeSkill(agentId, name);
    }
    const result = await view();
    const plugin = result.plugins.find((p) => p.name === "agent-tuning")!;
    expect(plugin).toBeDefined();
    expect(plugin.skills.map((s) => s.name)).toEqual([
      "agent-evaluation",
      "agent-initialization",
      "agent-optimization",
      "benchmark-design",
    ]);
    // No record file exists, so this is a deduction — and says so.
    expect(plugin.inferred).toBe(true);
    expect(plugin.skills.every((s) => s.inferred)).toBe(true);
    // Inferred members must not also appear as standalone: one skill, one card.
    expect(result.skills.map((s) => s.name)).toEqual([]);
  });

  it("does not attribute a partially-present plugin, and reports it as standalone instead", async () => {
    // Three of agent-tuning's four. Attributing these would claim the user installed them as a
    // plugin when they may well have picked them individually.
    for (const name of ["agent-evaluation", "agent-initialization", "agent-optimization"]) {
      await writeSkill(agentId, name);
    }
    const result = await view();
    expect(result.plugins.map((p) => p.name)).not.toContain("agent-tuning");
    expect(result.skills.map((s) => s.name)).toEqual([
      "agent-evaluation",
      "agent-initialization",
      "agent-optimization",
    ]);
    expect(result.skills.every((s) => s.pluginName === null)).toBe(true);
  });

  it("a recorded install is authoritative and not marked inferred", async () => {
    // Only one of the plugin's skills on disk, but the record says the plugin brought it.
    await writeSkill(agentId, "agent-evaluation");
    await writeSkill(agentId, "firecrawl");
    await writeSkill(agentId, "lieflat-less-ai-tone");
    await writeInstalls(root, projectId, agentId, {
      version: 1,
      plugins: {
        "agent-tuning": {
          version: "2026-09-02.1",
          skills: ["agent-evaluation"],
          hooks: [],
        },
      },
      skills: {},
    });
    const result = await view();
    const plugin = result.plugins.find((p) => p.name === "agent-tuning")!;
    expect(plugin.inferred).toBe(false);
    expect(plugin.version).toBe("2026-09-02.1");
    expect(plugin.skills[0]!.inferred).toBe(false);
    // The record names one member; the library says there are four, so it is visibly incomplete.
    expect(plugin.skillCount).toBe(4);
    expect(plugin.missingSkills).toEqual([
      "agent-initialization",
      "agent-optimization",
      "benchmark-design",
    ]);
  });

  it("classifies origin by the library's contents, not by the record", async () => {
    await writeSkill(agentId, "firecrawl"); // library ships it
    await writeSkill(agentId, "lieflat-less-ai-tone"); // it does not
    // A stale record claiming the user's own skill is built-in must not win.
    await writeInstalls(root, projectId, agentId, {
      version: 1,
      plugins: {},
      skills: { "lieflat-less-ai-tone": { version: "2026-01-01.1", source: "library" } },
    });
    const result = await view();
    const byName = new Map(
      [...result.plugins.flatMap((p) => p.skills), ...result.skills].map((s) => [s.name, s]),
    );
    expect(byName.get("firecrawl")!.origin).toBe("library");
    expect(byName.get("lieflat-less-ai-tone")!.origin).toBe("import");
  });

  it("reports a skill as one entry across every Agent holding it", async () => {
    const other = "a_other";
    await writeSkill(agentId, "firecrawl");
    await writeSkill(other, "firecrawl");
    await writeSkill(agentId, "humanizer");
    const result = await view([agentId, other].sort());
    const all = [...result.plugins.flatMap((p) => p.skills), ...result.skills];
    expect(all.map((s) => s.name).sort()).toEqual(["firecrawl", "humanizer"]);
    expect(all.find((s) => s.name === "firecrawl")!.agents).toEqual([agentId, other].sort());
    expect(all.find((s) => s.name === "humanizer")!.agents).toEqual([agentId]);
    expect(result.agentCount).toBe(2);
  });

  it("shows a hook-only plugin rather than dropping it", async () => {
    // `goal` ships no Skills, only a hook package — there is no directory to scan, so an
    // install-unaware view would simply omit it and the user could not tell it was installed.
    await writeInstalls(root, projectId, agentId, {
      version: 1,
      plugins: { goal: { version: "2026-09-01.1", skills: [], hooks: ["goal"] } },
      skills: {},
    });
    const result = await view();
    const goal = result.plugins.find((p) => p.name === "goal")!;
    expect(goal).toBeDefined();
    expect(goal.hooks).toEqual(["goal"]);
    expect(goal.skills).toEqual([]);
    expect(goal.inferred).toBe(false);
  });
});
