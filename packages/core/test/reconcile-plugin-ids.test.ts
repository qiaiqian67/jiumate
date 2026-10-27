/**
 * Repairing install directories left behind by the pre-`resolvePluginId` bug
 * (core/state/plugin-store.ts).
 *
 * **The state under test is one this repository actually produced.** An install wrote a plugin the
 * user had added under `<name>@jiumate-builtin`; after the fix the same plugin is written under
 * `<name>@local`. A machine that installed one before the fix has both directories, and the Agent
 * reads Skills from both — so 禁用 turns off one and the other keeps serving. These tests build
 * that exact tree on disk, because the bug is invisible to any test that only adds a plugin through
 * the current code path.
 *
 * Nothing here reaches for a private helper: every case goes through `reconcilePluginIds` and then
 * reads the tree back the way the real readers do.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  builtinPluginId,
  listInstalledPlugins,
  listInstalledSkills,
  localPluginId,
  reconcilePluginIds,
} from "../src/state/index.js";

describe("reconcilePluginIds", () => {
  let root: string;
  const projectId = "p1";
  const agentId = "a1";

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "jiumate-reconcile-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  /** One install directory with a Skill in it. */
  async function writeInstall(rootDir: string, id: string, skills: string[], enabled?: boolean) {
    // `<root>/<project>/agents/<agent>/agent_state/plugins/<id>` — the layout `pluginsDir` builds.
    const dir = path.join(rootDir, "p1", "agents", agentId, "agent_state", "plugins", id);
    for (const skill of skills) {
      await fs.mkdir(path.join(dir, "skills", skill), { recursive: true });
      await fs.writeFile(
        path.join(dir, "skills", skill, "SKILL.md"),
        `---\nname: ${skill}\ndescription: does ${skill}\n---\nbody\n`,
        "utf8",
      );
    }
    const manifest: Record<string, unknown> = {
      id,
      version: "2026-01-01.1",
      installedAt: 1,
    };
    // Omitted when not given, which means enabled by the rule every reader uses.
    if (enabled !== undefined) manifest.enabled = enabled;
    await fs.writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
    return dir;
  }

  /** Whether the plugin directory exists. */
  async function exists(id: string): Promise<boolean> {
    try {
      await fs.stat(path.join(root, "p1", "agents", agentId, "agent_state", "plugins", id));
      return true;
    } catch {
      return false;
    }
  }

  /** Puts an added copy of the plugin in the store, which is what says it was user-added. */
  async function writeStoreCopy(name: string) {
    const dir = path.join(root, "plugins", localPluginId(name));
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "plugin.json"),
      JSON.stringify({ name, version: "2026-01-01.1" }),
      "utf8",
    );
  }

  it("renames the stale id when only the built-in-id copy exists", async () => {
    // What a machine that installed once before the fix looks like: the plugin was added, so the
    // store holds it, but the install directory was written under the built-in id.
    await writeStoreCopy("thing");
    await writeInstall(root, builtinPluginId("thing"), ["alpha"]);

    const report = await reconcilePluginIds(root, projectId, agentId);

    expect(report.renamed).toEqual([builtinPluginId("thing")]);
    expect(await exists(builtinPluginId("thing"))).toBe(false);
    expect(await exists(localPluginId("thing"))).toBe(true);

    // The Skills survived the rename — a rename that lost them would be worse than the duplicate.
    const names = (await listInstalledSkills(root, projectId, agentId)).map((s) => s.name);
    expect(names).toEqual(["alpha"]);
  });

  it("merges and drops the stale copy when both exist", async () => {
    // The worse case: two directories, so the Agent serves the plugin twice and 禁用 only turns
    // off one of them.
    await writeStoreCopy("thing");
    await writeInstall(root, builtinPluginId("thing"), ["alpha"]);
    await writeInstall(root, localPluginId("thing"), ["beta"]);

    const report = await reconcilePluginIds(root, projectId, agentId);

    expect(report.removed).toEqual([builtinPluginId("thing")]);
    expect(await exists(builtinPluginId("thing"))).toBe(false);

    // **Both** Skills are still reachable — the merge adds what was missing and the stale copy goes.
    const names = (await listInstalledSkills(root, projectId, agentId)).map((s) => s.name);
    expect(names.sort()).toEqual(["alpha", "beta"]);

    // And the plugin is now listed exactly once, which is what the duplicate card came from.
    const listed = await listInstalledPlugins(root, projectId, agentId);
    expect(listed.filter((p) => p.name === "thing")).toHaveLength(1);
    expect(listed[0]!.id).toBe(localPluginId("thing"));
  });

  it("keeps a Skill the current copy already has, rather than overwriting it", async () => {
    // The current directory is the one every route addresses, so a local edit made there is the
    // live one; the stale copy must not clobber it.
    await writeStoreCopy("thing");
    await writeInstall(root, builtinPluginId("thing"), ["alpha"]);
    const currentDir = await writeInstall(root, localPluginId("thing"), ["alpha"]);
    await fs.writeFile(
      path.join(currentDir, "skills", "alpha", "SKILL.md"),
      "---\nname: alpha\ndescription: edited here\n---\nEDITED\n",
      "utf8",
    );

    await reconcilePluginIds(root, projectId, agentId);

    const body = await fs.readFile(
      path.join(
        root,
        "p1",
        "agents",
        agentId,
        "agent_state",
        "plugins",
        localPluginId("thing"),
        "skills",
        "alpha",
        "SKILL.md",
      ),
      "utf8",
    );
    expect(body).toContain("EDITED");
  });

  it("carries a disabled switch across, so migrating does not switch the plugin back on", async () => {
    // The user disabled it before the fix; repairing the directory must not undo that decision.
    await writeStoreCopy("thing");
    await writeInstall(root, builtinPluginId("thing"), ["alpha"], false);
    await writeInstall(root, localPluginId("thing"), ["beta"]);

    await reconcilePluginIds(root, projectId, agentId);

    const listed = await listInstalledPlugins(root, projectId, agentId);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.enabled).toBe(false);

    // And the consequence of that switch: the Agent does not serve the Skills.
    const names = (await listInstalledSkills(root, projectId, agentId)).map((s) => s.name);
    expect(names).toEqual([]);
  });

  it("leaves a plugin whose id already matches alone", async () => {
    await writeStoreCopy("thing");
    await writeInstall(root, localPluginId("thing"), ["alpha"]);

    const report = await reconcilePluginIds(root, projectId, agentId);

    expect(report).toEqual({ renamed: [], removed: [] });
    expect(await exists(localPluginId("thing"))).toBe(true);
    const names = (await listInstalledSkills(root, projectId, agentId)).map((s) => s.name);
    expect(names).toEqual(["alpha"]);
  });

  it("never relabels an added plugin as a built-in one", async () => {
    // The store entry is gone (deleted, or lost) but the install is not. `resolvePluginId` answers
    // the built-in id here, and moving towards it would turn a correctly-installed added plugin
    // into one the UI says it cannot uninstall — a *new* broken state, introduced by the repair.
    await writeInstall(root, localPluginId("thing"), ["alpha"]);

    const report = await reconcilePluginIds(root, projectId, agentId);

    expect(report).toEqual({ renamed: [], removed: [] });
    expect(await exists(localPluginId("thing"))).toBe(true);
    const names = (await listInstalledSkills(root, projectId, agentId)).map((s) => s.name);
    expect(names).toEqual(["alpha"]);
  });

  it("leaves an installed built-in alone when there is no added copy to prefer", async () => {
    // A shipped plugin has no `@local` directory, so `resolvePluginId` answers the built-in id and
    // there is nothing to move. This is the case where a naive "prefer @local" would relocate every
    // built-in install in the product.
    await writeInstall(root, builtinPluginId("thing"), ["alpha"]);

    // No store copy exists, so the id resolves to built-in and stays put.
    const report = await reconcilePluginIds(root, projectId, agentId);

    expect(report).toEqual({ renamed: [], removed: [] });
    expect(await exists(builtinPluginId("thing"))).toBe(true);
  });

  it("prefers the added copy once it exists in the store", async () => {
    // The store is what says a plugin was added; without it the directory name is the only clue and
    // it is the wrong one.
    await writeStoreCopy("thing");
    await writeInstall(root, builtinPluginId("thing"), ["alpha"]);

    await reconcilePluginIds(root, projectId, agentId);

    expect(await exists(localPluginId("thing"))).toBe(true);
    expect(await exists(builtinPluginId("thing"))).toBe(false);
  });

  it("does nothing, and does not throw, when there is no plugin tree at all", async () => {
    const report = await reconcilePluginIds(root, projectId, agentId);
    expect(report).toEqual({ renamed: [], removed: [] });
  });
});
