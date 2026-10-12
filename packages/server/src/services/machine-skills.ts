/**
 * 添加技能的三条路径：从仓库 URL、从上传的压缩包、从本机另一个 Agent 的技能目录。
 *
 * **三条路径的终点是同一个东西**：`<root>/skills/<name>/`（机器级技能库，见 core 的
 * `machine-skill-store.ts`）。这一点是刻意的——三种来源的获取方式毫无共同之处，但装完之后它们对
 * 下游（挂载到 Agent、启用、分类、删除）是**完全相同**的技能，所以让它们汇到一处，比让下游分辨
 * 「这个技能是从哪来的」便宜得多，也更不容易漏掉某一种来源的某个分支。
 *
 * **添加不等于安装。** 加完只是「这台电脑上有了」，处于待启用；挂载到某个 Agent、启用，是另外一
 * 个动作。压缩包与目录这两种来源尤其需要说清：它们各自都可能被加进来十几次，如果「添加」同时意味
 * 着「十个 Agent 立刻开始调用」，那是一次点击产生十次运行时变更的事故。
 *
 * **来源被记下来，因为升级只能靠它。** 压缩包解开之后原始文件并不在机器上，所以从压缩包来的技能
 * **无从升级**——这不是失败，是一个必须如实说出来的事实，而不是假装「已是最新」。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { unzipSync } from "fflate";
import {
  PLUGIN_NAME_PATTERN,
  parseSkillFrontmatter,
  writeMachineSkill,
  type SkillFiles,
} from "@prismshadow/jiumate-core";
import { HttpError } from "../http/errors.js";
import { skillTooLarge, MAX_FILE_BYTES } from "./skill-import-limits.js";

/** 一条来源写进机器库的结果。 */
export interface MachineSkillAdded {
  name: string;
  /** 该技能自己声明的版本（SKILL.md 的 `version`），没有则 null。 */
  version: string | null;
  /** 从哪些相对路径读到的，一个技能可能有 SKILL.md 加若干参考文件。 */
  fileCount: number;
}

/** 压缩包里一个技能的目录名 + 其内容。 */
export interface SkillEntry {
  name: string;
  files: SkillFiles;
  version: string | null;
}

/**
 * 从一个解压后的目录树里找出所有技能。
 *
 * **两种布局都认**：仓库根下直接是 `<name>/SKILL.md`（一个技能一个目录），以及
 * `.agents/skills/<name>/SKILL.md`、`.claude/skills/<name>/SKILL.md`（编码智能体的习惯位置，
 * 与 `discoverDirectorySkills` 读的是同两个）。只认后者会漏掉最直白的那种仓库——用户给一个 URL
 * 的时候，心里想的通常就是「这仓库里有几个技能」。
 *
 * **名字永远取目录名**，与其它所有列举一致：frontmatter 里的 `name` 可以和目录名不符（手写的、网络
 * 来的），而运行时处处按目录名寻址，让 frontmatter 说了算只会得到一个指向不存在路径的名字。
 */
export async function findSkillsInTree(root: string): Promise<SkillEntry[]> {
  const byName = new Map<string, SkillEntry>();

  // `root` may be the skill itself rather than a folder holding skills. Pointing a picker at
  // `.../my-skill` is the most natural thing a person does, and a reader that only understands
  // "a container of skills" answers 「这里没有技能」 about the very directory they picked — which
  // reads as a broken scan rather than as the wrong interpretation.
  const asOne = await readSkillTree(root);
  if (asOne !== null) {
    const meta = parseSkillFrontmatter(asOne["SKILL.md"]!);
    return [
      {
        name: path.basename(root),
        files: asOne,
        // A hand-picked directory is not necessarily named after the skill inside it, and the
        // frontmatter is the skill's own name — which is what it will be called everywhere else.
        version: versionOf(asOne["SKILL.md"]!),
        ...(meta && typeof meta.name === "string" && meta.name !== "" ? { name: meta.name } : {}),
      },
    ];
  }

  const tryRoot = async (dir: string): Promise<void> => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      if (!PLUGIN_NAME_PATTERN.test(entry.name)) continue;
      // 先到先得：根目录优先于 `.agents`/`.claude`，`.agents` 优先于 `.claude`。
      if (byName.has(entry.name)) continue;
      const files = await readSkillTree(path.join(dir, entry.name));
      if (files === null) continue;
      byName.set(entry.name, {
        name: entry.name,
        files,
        // `readSkillTree` returning non-null is exactly "a SKILL.md was read", so this key is
        // present — but the index type cannot see that, and the version is read from the same
        // bytes rather than re-read, so there is nothing to check at runtime.
        version: versionOf(files["SKILL.md"]!),
      });
    }
  };

  await tryRoot(root);
  for (const nested of [".agents/skills", ".claude/skills", "skills"]) {
    await tryRoot(path.join(root, nested));
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** 一个技能目录的全部文件；没有 SKILL.md 就算不是技能（返回 null）。 */
async function readSkillTree(dir: string): Promise<SkillFiles | null> {
  let content: string;
  try {
    content = await fs.readFile(path.join(dir, "SKILL.md"), "utf8");
  } catch {
    return null;
  }
  const files: SkillFiles = { "SKILL.md": content };
  const walk = async (abs: string, rel: string): Promise<void> => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = rel === "" ? entry.name : `${rel}/${entry.name}`;
      // `isFile()` 对符号链接为 false：链接是把目录外的东西读进来的方式，一律跳过。
      if (entry.isDirectory()) {
        await walk(path.join(abs, entry.name), child);
      } else if (entry.isFile() && entry.name !== "SKILL.md") {
        const data = await fs.readFile(path.join(abs, entry.name));
        if (data.byteLength > MAX_FILE_BYTES) throw skillTooLarge();
        files[child] = Buffer.from(data).toString("utf8");
      }
    }
  };
  await walk(dir, "");
  return files;
}

function versionOf(content: string): string | null {
  const meta = parseSkillFrontmatter(content);
  return meta && typeof meta.version === "string" && meta.version !== "" ? meta.version : null;
}

/**
 * 从一个 zip 里取出技能。
 *
 * **只认「解压后能直接读出技能」的那些布局**，而不是猜：顶层一个目录里有 `SKILL.md`，或顶层就是
 * `.agents/skills`、`skills`。猜的代价是解压出一个用户没预期的目录树，然后报告成功——这里宁可
 * 明确说「这个压缩包里没找到技能」。
 *
 * 条目名一律取目录名，并且 `isFile()` 过滤掉符号链接：解出来的内容与用户挑的目录是同等的不信任
 * 输入，只是入口不同。
 */
export function parseSkillArchiveSkills(bytes: Buffer): SkillEntry[] {
  let raw: Record<string, Uint8Array>;
  try {
    raw = unzipSync(bytes);
  } catch {
    throw new HttpError(400, "bad_skill_archive", "这个压缩包无法解压。");
  }

  /** 顶层目录名 → 该目录下的全部内容。 */
  const tops = new Map<string, Record<string, Uint8Array>>();
  const topIsSkill = new Set<string>();
  for (const [rel, data] of Object.entries(raw)) {
    const slash = rel.indexOf("/");
    if (slash <= 0) continue;
    const top = rel.slice(0, slash);
    if (rel.includes("..")) continue;
    const rest = rel.slice(slash + 1);
    let bucket = tops.get(top);
    if (bucket === undefined) {
      bucket = {};
      tops.set(top, bucket);
    }
    bucket[rest] = data;
    if (rest === "SKILL.md") topIsSkill.add(top);
  }

  const entries: SkillEntry[] = [];
  const add = (name: string, files: SkillFiles) => {
    if (!PLUGIN_NAME_PATTERN.test(name) || files["SKILL.md"] === undefined) return;
    entries.push({ name, files, version: versionOf(files["SKILL.md"]!) });
  };

  for (const top of [...tops.keys()].sort()) {
    const bucket = tops.get(top)!;
    // 形态一：顶层一个目录就是技能（一个压缩包一个技能）。
    if (topIsSkill.has(top)) {
      add(top, toFiles(bucket));
    }
  }
  // 形态二：`.agents/skills/<name>/SKILL.md` 这样的嵌套习惯位置。
  for (const top of [...tops.keys()].sort()) {
    const bucket = tops.get(top)!;
    for (const marker of [".agents/skills/", ".claude/skills/", "skills/"]) {
      const grouped = new Map<string, SkillFiles>();
      for (const [rel, data] of Object.entries(bucket)) {
        if (!rel.startsWith(marker)) continue;
        const rest = rel.slice(marker.length);
        const slash = rest.indexOf("/");
        if (slash <= 0) continue;
        const name = rest.slice(0, slash);
        let files = grouped.get(name);
        if (files === undefined) {
          files = {};
          grouped.set(name, files);
        }
        files[rest.slice(slash + 1)] = Buffer.from(data).toString("utf8");
      }
      for (const [name, files] of [...grouped].sort()) add(name, files);
    }
  }

  // 同一技能在两种布局里都出现时，先到先得——顶层形态优先，因为它更可能是用户的本意。
  const seen = new Set<string>();
  return entries.filter((e) => (seen.has(e.name) ? false : (seen.add(e.name), true)));
}

function toFiles(bucket: Record<string, Uint8Array>): SkillFiles {
  const files: SkillFiles = {};
  for (const [rel, data] of Object.entries(bucket)) {
    if (data.byteLength > MAX_FILE_BYTES) continue;
    files[rel] = Buffer.from(data).toString("utf8");
  }
  return files;
}

/** 某个 Agent 的技能目录里有哪些技能（第三条路径：识别别的智能体装了什么）。 */
export async function skillsInAgentDir(agentDirAbs: string): Promise<SkillEntry[]> {
  return findSkillsInTree(path.join(agentDirAbs, "skills"));
}

/** 把一个技能写进机器库，并回读确认它真的能被列举出来。 */
export async function addMachineSkill(
  root: string,
  entry: SkillEntry,
  source: Parameters<typeof writeMachineSkill>[3],
): Promise<MachineSkillAdded> {
  await writeMachineSkill(root, entry.name, entry.files, source);
  return { name: entry.name, version: entry.version, fileCount: Object.keys(entry.files).length };
}
