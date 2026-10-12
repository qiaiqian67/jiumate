/**
 * 从三种来源认出技能：解压后的目录树、上传的 zip、以及本机另一个 Agent 的 `skills/` 目录。
 *
 * **为什么每个布局都要单测。** 用户贴 URL 时心里的「仓库里有几个技能」可以是好几种目录形状，而猜错
 * 的表现是「成功添加了 0 个技能」——不报错，所以用户以为自己添加成功了。认出哪一种形状，就是这里
 * 全部的难点。
 *
 * 目录树的两个来源（URL 解出来的、别的 Agent 装着的）走同一个 `findSkillsInTree`，所以这里的断言
 * 同时覆盖了两条路径。
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import {
  findSkillsInTree,
  parseSkillArchiveSkills,
  skillsInAgentDir,
} from "../src/services/machine-skills.js";

/** 一个最小技能的内容。 */
const skillMd = (name: string, extra = ""): string =>
  `---\nname: ${name}\ndescription: does ${name}\nversion: 2026-01-01.1\n---\n${extra}body\n`;

describe("machine skill sources", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "jiumate-skill-src-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  /** 在 `rel` 下写一个技能目录。 */
  async function putSkill(
    base: string,
    rel: string,
    name: string,
    extra: Record<string, string> = {},
  ) {
    const dir = path.join(base, rel);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "SKILL.md"), skillMd(name), "utf8");
    for (const [file, content] of Object.entries(extra)) {
      const target = path.join(dir, file);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content, "utf8");
    }
  }

  describe("findSkillsInTree", () => {
    it("finds skills one per directory at the root", async () => {
      await putSkill(root, "alpha", "alpha");
      await putSkill(root, "beta", "beta");
      const found = await findSkillsInTree(root);
      expect(found.map((s) => s.name)).toEqual(["alpha", "beta"]);
      expect(found[0]?.version).toBe("2026-01-01.1");
    });

    it("finds skills under .agents/skills, the layout a coding agent writes", async () => {
      // 仓库根下是别的东西，技能藏在习惯位置里——只认顶层会一个都找不到。
      await fs.mkdir(root, { recursive: true });
      await fs.writeFile(path.join(root, "README.md"), "# hi", "utf8");
      await putSkill(root, path.join(".agents", "skills", "gamma"), "gamma");
      const found = await findSkillsInTree(root);
      expect(found.map((s) => s.name)).toEqual(["gamma"]);
    });

    it("finds skills under .claude/skills too", async () => {
      await putSkill(root, path.join(".claude", "skills", "delta"), "delta");
      expect((await findSkillsInTree(root)).map((s) => s.name)).toEqual(["delta"]);
    });

    it("prefers the root layout when a skill appears twice", async () => {
      // 两种形状都出现时，根目录那份更可能是用户的本意，而同一技能只能有一个来源。
      await putSkill(root, "eps", "eps", { "note.md": "root" });
      await putSkill(root, path.join(".agents", "skills", "eps"), "eps", { "note.md": "nested" });
      const found = await findSkillsInTree(root);
      expect(found).toHaveLength(1);
      expect(found[0]?.files["note.md"]).toBe("root");
    });

    it("carries auxiliary files, nested paths included", async () => {
      // 技能的参考文件是载荷的一部分，丢了它技能就残缺。
      await putSkill(root, "zeta", "zeta", {
        "reference/API.md": "the api",
        "scripts/run.sh": "echo hi",
      });
      const found = await findSkillsInTree(root);
      expect(found[0]?.files["reference/API.md"]).toBe("the api");
      expect(found[0]?.files["scripts/run.sh"]).toBe("echo hi");
    });

    it("ignores a directory with no SKILL.md", async () => {
      await fs.mkdir(path.join(root, "not-a-skill"), { recursive: true });
      await fs.writeFile(path.join(root, "not-a-skill", "readme.md"), "x", "utf8");
      await putSkill(root, "eta", "eta");
      expect((await findSkillsInTree(root)).map((s) => s.name)).toEqual(["eta"]);
    });

    it("answers empty for a directory that does not exist", async () => {
      // 扫一个不存在的目录是正常操作（用户指的路径可能已被删），不是错误。
      expect(await findSkillsInTree(path.join(root, "nope"))).toEqual([]);
    });
  });

  describe("parseSkillArchiveSkills", () => {
    const zip = (entries: Record<string, string>): Buffer =>
      Buffer.from(
        zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, strToU8(v)]))),
      );

    it("reads an archive holding one skill at the top level", async () => {
      const buf = zip({ "alpha/SKILL.md": skillMd("alpha") });
      const found = parseSkillArchiveSkills(buf);
      expect(found.map((s) => s.name)).toEqual(["alpha"]);
    });

    it("reads an archive holding several skills under .agents/skills", () => {
      const buf = zip({
        "pkg/.agents/skills/one/SKILL.md": skillMd("one"),
        "pkg/.agents/skills/two/SKILL.md": skillMd("two"),
      });
      expect(parseSkillArchiveSkills(buf).map((s) => s.name)).toEqual(["one", "two"]);
    });

    it("carries auxiliary files out of the archive", () => {
      const buf = zip({
        "alpha/SKILL.md": skillMd("alpha"),
        "alpha/reference/deep.md": "deep",
      });
      const found = parseSkillArchiveSkills(buf);
      expect(found[0]?.files["reference/deep.md"]).toBe("deep");
    });

    it("refuses an archive it cannot unzip", () => {
      // 解不开必须是一个能读懂的错误，而不是空列表——「添加了 0 个技能」无法与成功区分。
      expect(() => parseSkillArchiveSkills(Buffer.from("not a zip"))).toThrow();
    });

    it("answers empty for a zip with no skills in it", () => {
      const buf = zip({ "readme.txt": "nothing here" });
      expect(parseSkillArchiveSkills(buf)).toEqual([]);
    });
  });

  describe("skillsInAgentDir", () => {
    it("reads the skills/ directory of an Agent's own directory", async () => {
      await putSkill(root, path.join("agentA", "skills", "theta"), "theta");
      const found = await skillsInAgentDir(path.join(root, "agentA"));
      expect(found.map((s) => s.name)).toEqual(["theta"]);
    });

    it("does not wander outside skills/", async () => {
      // `<root>/<project>/agents/<id>` 下还挂着 benchmark、snapshot、workspace；
      // 顺着上层去看「顺便有没有技能」是把无关目录树整个读一遍的理由。
      await putSkill(root, path.join("agentB", "skills", "iota"), "iota");
      await putSkill(root, path.join("agentB", "workspace", "junk"), "junk");
      const found = await skillsInAgentDir(path.join(root, "agentB"));
      expect(found.map((s) => s.name)).toEqual(["iota"]);
    });
  });
});
