/**
 * 技能的机器级开关与 Agent 级开关如何共同决定一个技能能否被调用。
 *
 * **两个开关都必须为开**，与插件那套两层开关同一形状：机器级（本机是否启用）与 Agent 级（这个
 * Agent 是否调用它）是两件事、两个作用域。
 *
 * 这里测的是**读取路径**（`listInstalledSkills`），因为「关掉了但仍然被注入提示词」是这个功能
 * 存在的全部理由——直接检查状态文件的测试即使读取器完全无视这个标志也会通过。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  isMachineSkillEnabled,
  listInstalledSkills,
  readMachineDisabledSkills,
  setMachineSkillEnabled,
  updateInstalls,
  readInstalls,
} from "../src/state/index.js";

describe("skill enable switch", () => {
  let root: string;
  const projectId = "p1";
  const agentId = "a1";

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "jiumate-skill-switch-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  /** 一个装好的独立技能，外加它在 `.installs.json` 里的安装记录。 */
  async function installSkillDir(name: string, agentEnabled?: boolean) {
    const dir = path.join(root, projectId, "agents", agentId, "agent_state", "skills", name);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "SKILL.md"),
      `---\nname: ${name}\ndescription: does ${name}\n---\nbody\n`,
      "utf8",
    );
    const file = await readInstalls(root, projectId, agentId);
    await updateInstalls(root, projectId, agentId, file, (next) => {
      next.skills[name] = {
        version: null,
        source: "import",
        ...(agentEnabled !== undefined ? { enabled: agentEnabled } : {}),
      };
    });
  }

  /** 本 Agent 装着的技能名。 */
  const names = async () =>
    (await listInstalledSkills(root, projectId, agentId)).map((s) => s.name);

  /** 只改一个技能的 Agent 级开关，不重装它。 */
  async function setAgentEnabled(name: string, agentEnabled: boolean) {
    const file = await readInstalls(root, projectId, agentId);
    await updateInstalls(root, projectId, agentId, file, (next) => {
      const record = next.skills[name];
      if (record !== undefined) record.enabled = agentEnabled;
    });
  }

  it("reads as enabled when the file has never been written", async () => {
    expect(await isMachineSkillEnabled(root, "firecrawl")).toBe(true);
    expect(await readMachineDisabledSkills(root)).toEqual(new Set());
  });

  it("stops a Skill loading when the machine switch is off, and restores it", async () => {
    await installSkillDir("firecrawl");
    expect(await names()).toEqual(["firecrawl"]);

    await setMachineSkillEnabled(root, "firecrawl", false);
    expect(await names()).toEqual([]);

    await setMachineSkillEnabled(root, "firecrawl", true);
    expect(await names()).toEqual(["firecrawl"]);
  });

  it("stops a Skill loading when only this Agent's switch is off", async () => {
    // 机器级仍开着，这个 Agent 单独关闭：另一个作用域的问题，不该被机器级开关管。
    await installSkillDir("firecrawl", false);
    expect(await isMachineSkillEnabled(root, "firecrawl")).toBe(true);
    expect(await names()).toEqual([]);
  });

  it("requires both: neither one alone lets a Skill through", async () => {
    // 机器级关 + Agent 级开：不加载——更宽的那个说了算。
    await installSkillDir("firecrawl", true);
    await setMachineSkillEnabled(root, "firecrawl", false);
    expect(await names()).toEqual([]);

    // 机器级回来，Agent 级仍开：这时才加载。
    await setMachineSkillEnabled(root, "firecrawl", true);
    expect(await names()).toEqual(["firecrawl"]);

    // 机器级仍开、Agent 级关：仍然不加载——更窄的那个照样独立起作用。
    await setAgentEnabled("firecrawl", false);
    expect(await names()).toEqual([]);
    expect(await isMachineSkillEnabled(root, "firecrawl")).toBe(true);

    // 两个都开，才重新可用。
    await setAgentEnabled("firecrawl", true);
    expect(await names()).toEqual(["firecrawl"]);
  });

  it("treats a Skill with no install record as enabled", async () => {
    // 手工复制进来的目录、或者本功能之前装的：都没有记录，而没有记录必须读作「开」，
    // 否则一个用户什么都没做就会发现自己的技能全都不见了。
    const dir = path.join(root, projectId, "agents", agentId, "agent_state", "skills", "handmade");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "SKILL.md"),
      "---\nname: handmade\ndescription: by hand\n---\n",
      "utf8",
    );
    expect(await names()).toEqual(["handmade"]);
  });

  it("reads as enabled when the file is corrupt, rather than disabling everything", async () => {
    await installSkillDir("firecrawl");
    await fs.writeFile(path.join(root, "skills-state.json"), "{ not json", "utf8");
    // 危险的是反过来：解析失败若读作「全关」，就会静默关掉这台机器上的每个技能。
    expect(await isMachineSkillEnabled(root, "firecrawl")).toBe(true);
    expect(await names()).toEqual(["firecrawl"]);
  });

  it("records only the exceptional case", async () => {
    await setMachineSkillEnabled(root, "firecrawl", true);
    const raw = JSON.parse(await fs.readFile(path.join(root, "skills-state.json"), "utf8"));
    // 没有关闭的技能就没有任何记录：文件不该堆积 `true` 条目。
    expect(raw).toEqual({});
  });

  it("keeps the plugin's machine state in its own file", async () => {
    // 两个开关各管各的文件：关掉一个技能不该去改写插件的那一行。
    await setMachineSkillEnabled(root, "firecrawl", false);
    await fs.writeFile(
      path.join(root, "plugin-state.json"),
      JSON.stringify({ disabled: ["humanizer"] }),
      "utf8",
    );
    await setMachineSkillEnabled(root, "humanizer", true);
    const skills = JSON.parse(await fs.readFile(path.join(root, "skills-state.json"), "utf8"));
    const plugins = JSON.parse(await fs.readFile(path.join(root, "plugin-state.json"), "utf8"));
    expect(skills).toEqual({ disabled: ["firecrawl"] });
    expect(plugins).toEqual({ disabled: ["humanizer"] });
  });
});
