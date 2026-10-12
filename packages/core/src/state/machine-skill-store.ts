/**
 * Skills added to this machine: `<root>/skills/<name>/`, each with a `.source.json` recording
 * where it came from.
 *
 * **Why a machine-level store exists.** 三种添加方式（URL / 压缩包 / 其他智能体的目录）都在回答
 * 「把这个技能放到我的电脑上」，而不是「让这个 Agent 用它」——而一次安装只能写进某一个 Agent。
 * 没有这一层，「添加」就只能是「直接装进某个 Agent」，于是「先添加、再决定装给谁」这件事做不
 * 出来；要退而求其次把来源 URL 存下来、每次启用都重新下载，又会把一次下载变成十次。
 *
 * **内容布局与 Agent 的 `skills/<name>/` 完全一致**，所以挂载到某个 Agent 是两个相同形状之间
 * 的复制，而不是一次格式转换。这不是为了少写代码——它意味着「机器上的技能」和「Agent 里的技
 * 能」读起来是同一个东西，将来任何一处改布局，两处一起坏，而不是一处坏在无人察觉的地方。
 *
 * **来源只被升级读，不被其它任何代码信任。** `.source.json` 和插件那边的 `.provenance.json` 是
 * 同一个理由：它记的是字节从哪来，不是「该执行什么」。写坏了最多是升级失败，不会变成任意代码
 * 执行。
 *
 * **没有来源记录的技能是可以存在的**——直接从别处复制进来的目录、很早以前装的。升级会明确说
 * 「无从检查」，而不是假装没有新版本。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { atomicWriteFile } from "../internal/atomic-write.js";
import { assertSafeSkillFile } from "../internal/skill-file-path.js";
import { assertValidId } from "../internal/valid-id.js";
import { parseSkillFrontmatter } from "../plugins/index.js";
import { machineSkillDir, machineSkillsDir } from "./paths.js";
import { replaceSkillDirectory } from "./agent-state.js";

/** 技能文件相对路径 → 内容。与 Agent 侧安装写的是同一份。 */
export type SkillFiles = Record<string, string>;

/**
 * 一个技能的来源，`.source.json` 的内容。
 *
 * `kind` 决定升级能做什么，所以它是必填的而不是推断出来的：三种来源的「再取一次」方式没有共同
 * 之处，凭文件形状去猜会在某一个来源上猜错，而猜错的表现是下载了一个不该装的东西。
 */
export type MachineSkillSource =
  /** 从仓库 URL 拉的。升级就是重新解析 URL 再取一次归档。 */
  | { kind: "url"; url: string; /** 当时解析出的分支，升级时优先用它。 */ branch?: string }
  /** 从用户上传的压缩包解出来的。压缩包不在手上，所以**无从升级**。 */
  | { kind: "archive" }
  /** 从本机另一个目录复制来的。升级就是重新读那个目录。 */
  | { kind: "directory"; path: string };

/** `.source.json` 里记录的来源。没有它的技能是可以存在的，只是无从升级。 */
export interface MachineSkillRecord {
  name: string;
  /** 记录时的版本（SKILL.md frontmatter 里的 `version`，没有则 null）。 */
  version: string | null;
  source: MachineSkillSource;
  addedAt: number;
}

const SOURCE_FILE = ".source.json";

/** 读一个机器级技能的来源记录；没有记录或读不出来都返回 null（升级会据此说「无从检查」）。 */
export async function readMachineSkillSource(
  root: string,
  name: string,
): Promise<MachineSkillRecord | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      await fs.readFile(path.join(machineSkillDir(root, name), SOURCE_FILE), "utf8"),
    );
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const rec = parsed as Partial<MachineSkillRecord>;
  // Only a record this version can act on. A hand-edited or half-written file is treated as no
  // record at all: that makes 升级 say "nowhere to check", which is true, rather than guessing a
  // source and downloading something the user never asked for.
  if (typeof rec.name !== "string" || rec.name !== name || !isSource(rec.source)) return null;
  return {
    name: rec.name,
    version: typeof rec.version === "string" ? rec.version : null,
    source: rec.source,
    addedAt: typeof rec.addedAt === "number" ? rec.addedAt : 0,
  };
}

function isSource(source: unknown): source is MachineSkillSource {
  if (!source || typeof source !== "object") return false;
  const kind = (source as { kind?: unknown }).kind;
  if (kind === "archive") return true;
  if (kind === "url") return typeof (source as { url?: unknown }).url === "string";
  if (kind === "directory") return typeof (source as { path?: unknown }).path === "string";
  return false;
}

/**
 * 把一个技能写进机器级库：`<root>/skills/<name>/`，来源记录写在旁边。
 *
 * 替换语义与 Agent 侧安装一致——整个目录换掉，所以一次重新导入会带走旧版多出来的文件，而不会
 * 留下一个混合了两版的目录。中间态用的是点开头的暂存名（永远不是合法技能名，所以任何列举都
 * 看不见它）。
 */
export async function writeMachineSkill(
  root: string,
  name: string,
  files: SkillFiles,
  source: MachineSkillSource,
): Promise<void> {
  assertValidId("skill_name", name);
  for (const [rel] of Object.entries(files)) assertSafeSkillFile(rel);
  const dir = machineSkillDir(root, name);
  const record: MachineSkillRecord = {
    name,
    version: versionOf(files["SKILL.md"]),
    source,
    addedAt: Date.now(),
  };
  // The Skill's files first, the record last: a record beside complete content is the consistent
  // state, whereas a record written first would claim a Skill whose SKILL.md is not there yet.
  await replaceSkillDirectory(dir, Object.entries(files));
  await atomicWriteFile(path.join(dir, SOURCE_FILE), `${JSON.stringify(record, null, 2)}\n`);
}

/** frontmatter 里的 `version`；解析不出就是 null，而不是猜一个。 */
function versionOf(content: string | undefined): string | null {
  if (content === undefined) return null;
  const meta = parseSkillFrontmatter(content);
  return meta && typeof meta.version === "string" && meta.version !== "" ? meta.version : null;
}

/** 一个机器级技能的目录名与版本，用于列表。 */
export interface MachineSkillInfo {
  name: string;
  /** SKILL.md frontmatter 的 `version`，没有则 null。 */
  version: string | null;
  /** 记录的来源；没有记录则 undefined（无从升级）。 */
  source?: MachineSkillRecord["source"];
  addedAt?: number;
}

/**
 * 机器级库里的每个技能，名字排序。
 *
 * **一个读不出 SKILL.md 的目录不算技能**，与所有其它列举一致——只有 `<name>/SKILL.md` 的存在才
 * 是「装好了」的判据（见 `listInstalledSkills`），一个没有它的目录是一个残留的暂存目录或半途中
 * 断的导入，而不是一个可以启用的技能。列举是元数据：辅助文件永远不在这里读，它们是安装的载荷，
 * 而为了一个列表把每个技能的每个文件都读进内存，正是这类列表不该做的事。
 */
export async function listMachineSkills(root: string): Promise<MachineSkillInfo[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(machineSkillsDir(root), { withFileTypes: true });
  } catch {
    return []; // 从没添加过，不是错误。
  }
  const out: MachineSkillInfo[] = [];
  for (const entry of entries) {
    // 点开头的是暂存目录，mid-install 留下的，不算技能。
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const dir = path.join(machineSkillsDir(root), entry.name);
    let content: string;
    try {
      content = await fs.readFile(path.join(dir, "SKILL.md"), "utf8");
    } catch {
      continue;
    }
    const meta = parseSkillFrontmatter(content);
    const record = await readMachineSkillSource(root, entry.name);
    out.push({
      name: entry.name,
      version:
        meta && typeof meta.version === "string" && meta.version !== "" ? meta.version : null,
      ...(record !== null ? { source: record.source, addedAt: record.addedAt } : {}),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * 读一个机器级技能的全部文件，供挂载到某个 Agent。
 *
 * 整体读进内存后交给写入端做路径检查，而不是边读边写：这里读的是一个我们自己写的目录（不是用户
 * 挑的任意目录），但载荷仍然要过 `assertSafeSkillFile`，因为「这个目录是我们写的」是关于**来源**
 * 的事实，而一个符号链接或 `..` 是关于**内容**的事实——两者无关。
 */
export async function readMachineSkillFiles(
  root: string,
  name: string,
): Promise<SkillFiles | null> {
  assertValidId("skill_name", name);
  const dir = machineSkillDir(root, name);
  const files: SkillFiles = {};
  const walk = async (abs: string, rel: string): Promise<void> => {
    for (const entry of await fs.readdir(abs, { withFileTypes: true })) {
      if (entry.name === SOURCE_FILE) continue; // 我们的记录，不是技能的一部分
      const relChild = rel === "" ? entry.name : `${rel}/${entry.name}`;
      // 非普通条目一律跳过，符号链接在内：链接是把目录外的文件读进来的方式。
      if (!entry.isFile()) continue;
      assertSafeSkillFile(relChild);
      files[relChild] = await fs.readFile(path.join(abs, entry.name), "utf8");
    }
  };
  try {
    await walk(dir, "");
  } catch {
    return null;
  }
  return Object.keys(files).length > 0 ? files : null;
}

/** 从本机库移除一个技能（= 从这台机器上删除它，Agent 里的副本不受影响）。 */
export async function removeMachineSkill(root: string, name: string): Promise<void> {
  assertValidId("skill_name", name);
  await fs.rm(machineSkillDir(root, name), { recursive: true, force: true });
}
