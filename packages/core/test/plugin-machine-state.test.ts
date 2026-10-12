/**
 * The machine-level plugin switch (`<root>/plugin-state.json`) and how it combines with the
 * per-Agent one (`manifest.json`'s `enabled`).
 *
 * **Two flags, and both must be on.** The machine-level one says whether a plugin may be installed
 * and used on this computer at all; the per-Agent one says whether one Agent calls it. This file
 * pins the combination rules, because every one of them is a way a plugin can end up *running* when
 * the user believes it is off — which is the failure the whole feature exists to prevent.
 *
 * The tree is built on disk and read back through `listInstalledSkills`, the same function the
 * runtime uses to decide what enters a prompt. A test that inspected the state file directly would
 * pass even if the reader ignored the flag entirely.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  isMachinePluginEnabled,
  listInstalledSkills,
  readMachineDisabled,
  setMachinePluginEnabled,
} from "../src/state/index.js";

describe("machine-level plugin switch", () => {
  let root: string;
  const projectId = "p1";
  const agentId = "a1";

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "jiumate-machine-plugin-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  /**
   * One installed plugin directory with a Skill in it, and `enabled` in its manifest — the
   * per-Agent flag. Omitting it means "on", which is the rule every reader uses.
   */
  async function install(id: string, skill: string, agentEnabled?: boolean) {
    const dir = path.join(root, projectId, "agents", agentId, "agent_state", "plugins", id);
    await fs.mkdir(path.join(dir, "skills", skill), { recursive: true });
    await fs.writeFile(
      path.join(dir, "skills", skill, "SKILL.md"),
      `---\nname: ${skill}\ndescription: does ${skill}\n---\nbody\n`,
      "utf8",
    );
    const manifest: Record<string, unknown> = { id, version: "2026-01-01.1", installedAt: 1 };
    if (agentEnabled !== undefined) manifest.enabled = agentEnabled;
    await fs.writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  }

  const names = async () =>
    (await listInstalledSkills(root, projectId, agentId)).map((s) => s.name);

  it("reads as enabled when the file has never been written", async () => {
    expect(await isMachinePluginEnabled(root, "firecrawl")).toBe(true);
    expect(await readMachineDisabled(root)).toEqual(new Set());
  });

  it("stops a plugin's Skills loading, and restores them when switched back on", async () => {
    await install("firecrawl@jiumate-builtin", "firecrawl");
    expect(await names()).toEqual(["firecrawl"]);

    await setMachinePluginEnabled(root, "firecrawl", false);
    expect(await names()).toEqual([]);

    await setMachinePluginEnabled(root, "firecrawl", true);
    expect(await names()).toEqual(["firecrawl"]);
  });

  it("keys on the library name, so a full plugin id resolves to the same entry", async () => {
    // The card holds an id and the listing holds a name; a switch that only understood one of them
    // would let the two disagree about whether the plugin is on.
    await install("humanizer@jiumate-builtin", "humanizer");
    await setMachinePluginEnabled(root, "humanizer@jiumate-builtin", false);
    expect(await isMachinePluginEnabled(root, "humanizer")).toBe(false);
    expect(await names()).toEqual([]);
  });

  it("requires both flags: neither one alone lets a plugin run", async () => {
    // Machine off, Agent on — the wider switch wins, because a plugin switched off for this
    // machine must not be serving any Agent, including one that has it installed and enabled.
    await install("firecrawl@jiumate-builtin", "firecrawl", true);
    await setMachinePluginEnabled(root, "firecrawl", false);
    expect(await names()).toEqual([]);
    // Switching the machine back on is not enough on its own — but here the Agent is on too, so
    // this is the case where the plugin becomes available again, with the per-Agent state intact
    // throughout (the machine-level write never touched the manifest).
    await setMachinePluginEnabled(root, "firecrawl", true);
    expect(await isMachinePluginEnabled(root, "firecrawl")).toBe(true);
    expect(await names()).toEqual(["firecrawl"]);

    // The other direction: machine on, Agent off. The narrower switch still holds, so the plugin
    // stays out of this Agent while remaining installable elsewhere.
    await fs.writeFile(
      path.join(
        root,
        projectId,
        "agents",
        agentId,
        "agent_state",
        "plugins",
        "firecrawl@jiumate-builtin",
        "manifest.json",
      ),
      JSON.stringify({
        id: "firecrawl@jiumate-builtin",
        enabled: false,
        version: "x",
        installedAt: 1,
      }),
      "utf8",
    );
    expect(await names()).toEqual([]);
    expect(await isMachinePluginEnabled(root, "firecrawl")).toBe(true);
  });

  it("leaves every other plugin's state alone", async () => {
    await install("firecrawl@jiumate-builtin", "firecrawl");
    await install("humanizer@jiumate-builtin", "humanizer");
    await setMachinePluginEnabled(root, "firecrawl", false);
    expect(await names()).toEqual(["humanizer"]);
    expect(await isMachinePluginEnabled(root, "humanizer")).toBe(true);
  });

  it("records only the exceptional case, so an all-on machine writes an empty file", async () => {
    await setMachinePluginEnabled(root, "firecrawl", true);
    const raw = JSON.parse(await fs.readFile(path.join(root, "plugin-state.json"), "utf8"));
    // Nothing disabled means nothing recorded: the file should not accumulate `true` entries that
    // would then have to be interpreted the same way the absent case is.
    expect(raw).toEqual({});
  });

  it("reads as enabled when the file is corrupt, rather than disabling everything", async () => {
    await install("firecrawl@jiumate-builtin", "firecrawl");
    await fs.writeFile(path.join(root, "plugin-state.json"), "{ not json", "utf8");
    // The dangerous direction is the other one: a file that fails to parse must not read as
    // "everything is off", which would silently disable every plugin on the machine.
    expect(await isMachinePluginEnabled(root, "firecrawl")).toBe(true);
    expect(await names()).toEqual(["firecrawl"]);
  });

  it("ignores non-string entries rather than disabling a name it cannot spell", async () => {
    await fs.writeFile(
      path.join(root, "plugin-state.json"),
      JSON.stringify({ disabled: ["firecrawl", 42, null] }),
      "utf8",
    );
    expect(await readMachineDisabled(root)).toEqual(new Set(["firecrawl"]));
  });
});
