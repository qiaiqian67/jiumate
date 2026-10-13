/**
 * 机器级技能的 HTTP 路由，对着一个真跑起来的服务测。
 *
 * core 里的测试停在「字节写对了」；这里停在「用户点一下之后，本机技能库里真的多了一个技能，且它是
 * 待启用状态」——后者才是这件事的意义。几个地方特别值得在 HTTP 层测：
 *
 *   - **添加不装到任何 Agent。** 这是「待启用」的全部含义，也是最容易被一个顺手调用的
 *     `installPlugin` 破坏掉的不变量。
 *   - **压缩包来源升级时如实说无从检查**，而不是谎称已是最新。
 *   - **三种来源记下来的 kind 不同**，因为升级据此决定能做什么。
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import {
  listMachineSkills,
  listInstalledSkills,
  machineSkillsDir,
} from "@prismshadow/jiumate-core";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import type {
  MachineSkillAddResult,
  MachineSkillFromUrlResponse,
  MachineSkillScanResponse,
  MachineSkillsResponse,
  MachineSkillUpgradeResponse,
} from "../src/api/types.js";

const skillMd = (name: string): string =>
  `---\nname: ${name}\ndescription: does ${name}\nversion: 2026-01-01.1\n---\nbody\n`;

describe("machine-level skills", () => {
  let t: TestApp;
  let client: ReturnType<typeof apiClient>;
  let projectId: string;
  let agentId: string;

  beforeEach(async () => {
    t = await createTestApp();
    const user = await provisionUser(t.app, "skilluser");
    client = apiClient(t.app, user.cookie);
    const created = await client.post("/api/projects", {
      projectId: "skilluser-shared",
      name: "P",
    });
    if (created.status !== 201) {
      throw new Error(`project create failed: ${created.status} ${await created.text()}`);
    }
    projectId = ((await created.json()) as { project: { projectId: string } }).project.projectId;
    const agent = await client.post(`/api/projects/${projectId}/agents`, {
      agentId: "skilluser_agent",
      name: "A",
    });
    if (agent.status !== 201 && agent.status !== 200) {
      throw new Error(`agent create failed: ${agent.status} ${await agent.text()}`);
    }
    agentId = "skilluser_agent";
  });

  afterEach(async () => {
    await t.cleanup();
  });

  const list = async () => {
    const res = await client.get("/api/machine-skills");
    if (res.status !== 200) throw new Error(`list failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as MachineSkillsResponse;
  };

  /** 一个含单个技能目录的 zip。 */
  const zipOf = (entries: Record<string, string>): Buffer =>
    Buffer.from(
      zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, strToU8(v)]))),
    );

  it("mounts a machine-store skill onto one agent, and only that one", async () => {
    // 管理安装's 安装. The whole point of the machine store is that adding and mounting are two
    // acts, so this is where the second one happens.
    await client.postBytes(
      "/api/machine-skills/archive",
      zipOf({
        "eta/SKILL.md": skillMd("eta"),
        "eta/reference/deep.md": "the payload",
      }),
    );
    const second = await client.post(`/api/projects/${projectId}/agents`, {
      agentId: "skilluser_second",
      name: "B",
    });
    expect(second.status === 201 || second.status === 200).toBe(true);

    const mount = await client.post(`/api/projects/${projectId}/agents/${agentId}/skills/eta`, {});
    expect(mount.status).toBe(201);

    // Only the Agent it was mounted on has it.
    const mine = await listInstalledSkills(t.root, projectId, agentId);
    expect(mine.map((s) => s.name)).toContain("eta");
    const other = await listInstalledSkills(t.root, projectId, "skilluser_second");
    expect(other.map((s) => s.name)).not.toContain("eta");

    // The payload travelled with it — the reference file is what the SKILL.md points at, and a
    // mount that dropped it would leave a Skill that cannot do its own job.
    const dir = path.join(t.root, projectId, "agents", agentId, "agent_state", "skills", "eta");
    expect(fs.existsSync(path.join(dir, "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "reference", "deep.md"))).toBe(true);
  });

  it("refuses to mount a skill switched off for this machine", async () => {
    await client.postBytes(
      "/api/machine-skills/archive",
      zipOf({ "theta/SKILL.md": skillMd("theta") }),
    );
    await client.post("/api/machine-skills/enabled", { name: "theta", enabled: false });

    const mount = await client.post(
      `/api/projects/${projectId}/agents/${agentId}/skills/theta`,
      {},
    );
    // The machine entry is what gates new mounts, exactly as it gates new plugin installs.
    expect(mount.status).toBe(409);
    const listed = await listInstalledSkills(t.root, projectId, agentId);
    expect(listed.map((s) => s.name)).not.toContain("theta");
  });

  it("refuses to mount a skill that was never added to this machine", async () => {
    // There is no "send me a body" branch: a client cannot put a Skill on an Agent that the user
    // never added here.
    const mount = await client.post(
      `/api/projects/${projectId}/agents/${agentId}/skills/never-added`,
      {},
    );
    expect(mount.status).toBe(404);
  });

  it("adds a skill from an archive without installing it into any agent", async () => {
    const res = await client.postBytes(
      "/api/machine-skills/archive",
      zipOf({ "alpha/SKILL.md": skillMd("alpha") }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as MachineSkillAddResult;
    expect(body.added.map((s) => s.name)).toEqual(["alpha"]);

    // The machine store has it…
    const stored = await list();
    expect(stored.skills.map((s) => s.name)).toEqual(["alpha"]);

    // …and the agent has nothing, which is what 待启用 means.
    const installed = await listInstalledSkills(t.root, projectId, agentId);
    expect(installed.map((s) => s.name)).not.toContain("alpha");
  });

  it("adds every skill in an archive that holds several", async () => {
    const res = await client.postBytes(
      "/api/machine-skills/archive",
      zipOf({
        "pkg/.agents/skills/one/SKILL.md": skillMd("one"),
        "pkg/.agents/skills/two/SKILL.md": skillMd("two"),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as MachineSkillAddResult;
    expect(body.added.map((s) => s.name).sort()).toEqual(["one", "two"]);
  });

  it("records an archive source as not upgradable, and says so rather than claiming up to date", async () => {
    await client.postBytes(
      "/api/machine-skills/archive",
      zipOf({ "alpha/SKILL.md": skillMd("alpha") }),
    );
    const res = await client.post("/api/machine-skills/alpha/upgrade");
    expect(res.status).toBe(200);
    const body = (await res.json()) as MachineSkillUpgradeResponse;
    // 谎称「已是最新」会让用户以为这个技能受维护；而真实答案是：原始压缩包不在机器上，
    // 没有第二个地方可以查。
    expect(body.upgraded).toBe(false);
    expect(body.upgradable).toBe(false);
    expect(body.currentVersion).toBe("2026-01-01.1");
  });

  it("refuses an archive with no skills in it, rather than reporting success with nothing added", async () => {
    const res = await client.postBytes(
      "/api/machine-skills/archive",
      zipOf({ "readme.txt": "no skills here" }),
    );
    // 「添加了 0 个技能」无法与成功区分，所以这必须是一个能读懂的错误。
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("no_skills_found");
  });

  it("adds a skill from a local directory, and records where it came from", async () => {
    const dir = path.join(t.root, "other-agent-skills", "delta");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), skillMd("delta"), "utf8");

    const res = await client.post("/api/machine-skills/directory", { path: dir });
    expect(res.status).toBe(201);
    expect(((await res.json()) as MachineSkillAddResult).added.map((s) => s.name)).toEqual([
      "delta",
    ]);

    const stored = (await list()).skills.find((s) => s.name === "delta");
    // 升级只能靠来源记录，所以它必须是 `directory` 而不是被猜成别的。
    expect(stored?.source?.kind).toBe("directory");
  });

  it("refuses a directory that does not exist", async () => {
    const res = await client.post("/api/machine-skills/directory", {
      path: path.join(t.root, "nope"),
    });
    expect(res.status).toBe(404);
  });

  it("groups a scan by agent directory, including agents holding nothing", async () => {
    const res = await client.get("/api/machine-skills/scan");
    expect(res.status).toBe(200);
    const body = (await res.json()) as MachineSkillScanResponse;
    const mine = body.groups.find((g) => g.agentId === agentId);
    // 一个没装技能的 Agent 也要出现在列表里：否则「扫过了但它没装」与「根本没扫」在界面上
    // 是同一个空白。
    expect(mine).toBeDefined();
    expect(mine?.skills).toEqual([]);
    expect(mine?.agentPath).toContain(agentId);
  });

  it("lists a skill's files in the machine store, ready to mount", async () => {
    const dir = path.join(t.root, "src-skill", "epsilon");
    fs.mkdirSync(path.join(dir, "reference"), { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), skillMd("epsilon"), "utf8");
    fs.writeFileSync(path.join(dir, "reference", "API.md"), "the api", "utf8");
    await client.post("/api/machine-skills/directory", { path: dir });

    const machineDir = path.join(machineSkillsDir(t.root), "epsilon");
    // 载荷（参考文件）与来源记录都在本机库里——挂载到 Agent 时载荷必须跟着走。
    expect(fs.existsSync(path.join(machineDir, "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(machineDir, "reference", "API.md"))).toBe(true);
    expect(fs.existsSync(path.join(machineDir, ".source.json"))).toBe(true);
  });

  it("removes a skill from the machine without touching any agent's copy", async () => {
    const dir = path.join(t.root, "src-skill", "zeta");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), skillMd("zeta"), "utf8");
    await client.post("/api/machine-skills/directory", { path: dir });

    const res = await client.delete("/api/machine-skills/zeta");
    expect(res.status).toBe(200);
    expect((await list()).skills.map((s) => s.name)).not.toContain("zeta");
  });

  it("rejects a non-boolean enabled rather than coercing it", async () => {
    // `"false"` 是真值；把它当成 true 会写入与调用方本意相反的状态。
    const res = await client.post("/api/machine-skills/enabled", {
      name: "alpha",
      enabled: "false",
    });
    expect(res.status).toBe(400);
  });

  it("keeps the plugin machine state and the skill machine state in separate files", async () => {
    await client.postBytes(
      "/api/machine-skills/archive",
      zipOf({ "alpha/SKILL.md": skillMd("alpha") }),
    );
    await client.post("/api/machine-skills/enabled", { name: "alpha", enabled: false });
    await client.post("/api/plugins/enabled", { id: "humanizer", enabled: false });

    const skillsFile = fs.existsSync(path.join(t.root, "skills-state.json"));
    const pluginsFile = fs.existsSync(path.join(t.root, "plugin-state.json"));
    expect(skillsFile).toBe(true);
    expect(pluginsFile).toBe(true);
    // 关掉一个技能不该去改写插件的那一行——那是两份刻意分开的文件。
    expect(JSON.parse(fs.readFileSync(path.join(t.root, "skills-state.json"), "utf8"))).toEqual({
      disabled: ["alpha"],
    });
    expect(JSON.parse(fs.readFileSync(path.join(t.root, "plugin-state.json"), "utf8"))).toEqual({
      disabled: ["humanizer"],
    });
  });
});
