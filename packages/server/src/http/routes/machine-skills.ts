/**
 * 机器级技能：`/api/machine-skills`。
 *
 *   GET    /api/machine-skills                 # 本机技能库
 *   POST   /api/machine-skills/url             # 从仓库 URL 添加（任何 URL 形状）
 *   POST   /api/machine-skills/archive         # 从上传的 zip 添加
 *   POST   /api/machine-skills/directory       # 从本机一个目录添加
 *   GET    /api/machine-skills/scan            # 扫本机各个 Agent 装了什么（按目录分组）
 *   POST   /api/machine-skills/:name/upgrade   # 按记录的来源检查并升级
 *   POST   /api/machine-skills/enabled         # 本机启用/关闭一个技能
 *   DELETE /api/machine-skills/:name           # 从本机删除（Agent 里的副本不受影响）
 *
 * **添加 ≠ 安装。** 这里每一条「添加」都只把技能放到 `<root>/skills/<name>/`，也就是「这台电脑上
 * 有了」；挂载到某个 Agent、启用，是另外两个动作。压缩包和目录这两种来源尤其需要说清——它们各自
 * 都可能一次带来十几个技能，如果「添加」同时意味着「所有 Agent 立刻开始调用」，那是一次点击产生
 * 十几处运行时变更的事故。
 *
 * **不带 `:projectId`。** 这是本机的技能库，不是某个 Project 的：同一个 URL 在每个 Project 上产生
 * 同一个技能，放在 Project 下会让库的内容取决于这个页面是从哪个 Project 打开的。
 *
 * **删除只动本机库，Agent 里的副本留着。** 两个作用域两件事：把技能从这台机器上拿走，与让某个
 * Agent 不用它，是两个动作。混起来的结果是用户以为「我只是关掉它」，结果文件没了。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";
import { zipSync } from "fflate";
import {
  comparePluginVersions,
  isMachineSkillEnabled,
  listMachineSkills,
  readMachineSkillSource,
  removeMachineSkill,
  resolveRepoUrl,
  RepoUrlError,
  setMachineSkillEnabled,
  writeMachineSkill,
} from "@jadelau/core";
import type {
  MachineSkillAddResult,
  MachineSkillFromUrlResponse,
  MachineSkillItem,
  MachineSkillScanResponse,
  MachineSkillsResponse,
  MachineSkillUpgradeResponse,
} from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import type { AppDeps } from "../../app.js";
import { HttpError } from "../errors.js";
import { badRequest, readJson, requireString, requireValidId } from "../validate.js";
import {
  addMachineSkill,
  findSkillsInTree,
  parseSkillArchiveSkills,
  skillsInAgentDir,
  type SkillEntry,
} from "../../services/machine-skills.js";
import { MAX_TOTAL_BYTES, archiveTooLarge } from "../../services/skill-import-limits.js";

/**
 * 上传 zip 的大小上限。
 *
 * 用 `MAX_TOTAL_BYTES`（技能导入的总载荷上限）而不是另定一个数字：这两个限制说的是同一件事——一个
 * 技能包能有多大——而两个不同的常数意味着总有一个会先被用户撞到，届时被拒的那个原因会与「这个包
 * 太大了」对不上。
 */
const MAX_ARCHIVE_BYTES = MAX_TOTAL_BYTES;

/**
 * 取一个 URL 的字节，手动跟随重定向而不是交给 `fetch`。
 *
 * 手动跟是为了让协议检查在整个链上都成立：`fetch` 会自动跳到别处（包括跳到 `file:`），而这里每跳
 * 一次都重新检查一次。
 */
async function download(url: URL): Promise<Buffer> {
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    if (current.protocol !== "https:" && current.protocol !== "http:") {
      throw badRequest(`Only http and https URLs are supported (got ${current.protocol}).`);
    }
    const response = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(60_000),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw badRequest("The server sent a redirect with no target.");
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) {
      throw new HttpError(502, "fetch_failed", `Download failed: HTTP ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }
  throw badRequest("Too many redirects.");
}

/**
 * 逐个写入，一个失败不拖累其余——并如实报告哪个没成。
 *
 * 一批里有一个装不上时抛错，会让用户以为什么都没发生；只报成功，则会让用户以为整批都装上了。
 */
async function addAll(
  root: string,
  entries: readonly SkillEntry[],
  source: Parameters<typeof writeMachineSkill>[3],
): Promise<MachineSkillAddResult> {
  const added: MachineSkillAddResult["added"] = [];
  const failed: MachineSkillAddResult["failed"] = [];
  for (const entry of entries) {
    try {
      added.push(await addMachineSkill(root, entry, source));
    } catch (e) {
      failed.push({ name: entry.name, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  // `enabled: true` is not a claim that anything is running — 添加进来的技能处于待挂载状态，
  // 「本机启用」只是说它没有落在本机关闭名单里。
  return { added, failed, enabled: true };
}

/** /api/machine-skills：本机技能库的读写（登录即可，无 Project 检查——它是本机的）。 */
export function machineSkillRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const root = deps.config.root;

  /** 本机技能库列表。 */
  app.get("/", async (c) => {
    const skills = await listMachineSkills(root);
    const items: MachineSkillItem[] = skills.map((skill) => ({
      name: skill.name,
      version: skill.version,
      ...(skill.source !== undefined ? { source: skill.source } : {}),
      addedAt: skill.addedAt ?? 0,
    }));
    return c.json({ skills: items } satisfies MachineSkillsResponse);
  });

  /**
   * 从仓库 URL 添加技能。
   *
   * **任何形状的 URL 都行**——`https://github.com/o/r`、带 `.git` 的、`/tree/main` 的、深链到某个
   * 文件的——它们对人来说都指同一个仓库，所以都解析到同一个分支归档（`resolveRepoUrl`）。需要用户
   * 先手动改写成某一种形状的 URL，用户一定会改错，而 `/tree/main` 恰恰是他**最可能**贴出来的那个，
   * 因为从浏览器复制出来的就是它。
   *
   * **解压后落到临时目录再读**，所以识别技能的那段逻辑（`findSkillsInTree`）与「别的智能体的技能
   * 目录」那条路径完全一样——两条来源不同、之后的事却一字不差，正是把终点收敛到同一个库的理由。
   */
  app.post("/url", async (c) => {
    const raw = requireString(await readJson(c), "url", { minLen: 1, maxLen: 2048 });
    let resolved;
    try {
      resolved = resolveRepoUrl(raw);
    } catch (e) {
      // 用户笔误，不是服务端故障；消息里列出能用的形状——那正是他真正在问的东西。
      if (e instanceof RepoUrlError) throw new HttpError(400, "bad_repo_url", e.message);
      throw e;
    }
    const bytes = await download(new URL(resolved.archiveUrl));
    if (bytes.byteLength > MAX_ARCHIVE_BYTES) {
      // The number, not just "too large": the user cannot act on the second without knowing the
      // first. The upload path beside this one has always said it — this one did not, which is why
      // a 21MB archive reported the same opaque sentence on one route and a figure on the other.
      throw badRequest(archiveTooLarge(MAX_ARCHIVE_BYTES));
    }
    const entries = extractZipSkills(bytes);
    if (entries.length === 0) {
      throw new HttpError(
        404,
        "no_skills_found",
        "这个地址里没有找到技能。一个技能是一个含 SKILL.md 的目录，或位于 .agents/skills / .claude/skills 之下。",
      );
    }
    const result = await addAll(root, entries, {
      kind: "url",
      url: resolved.archiveUrl,
      branch: resolved.branch,
    });
    return c.json(
      { ...result, sourceUrl: resolved.archiveUrl } satisfies MachineSkillFromUrlResponse,
      201,
    );
  });

  /**
   * 从上传的压缩包添加。
   *
   * **它自己的路由，而不是给 `/url` 加一个 content-type 分支**：两者参数传递方式不同，而原始请求体
   * 没地方放 JSON。它也**无从升级**——压缩包解开之后原始文件不在机器上，所以来源记成 `archive`，
   * 升级会如实说「无从检查」而不是假装已是最新。
   */
  app.post("/archive", async (c) => {
    // A raw body, so there is nowhere to put JSON — which is exactly why this is its own route and
    // not a content-type branch on `/url`. The size is checked twice: once on the declared length
    // (a client can lie about it) and once on what actually arrived.
    const declared = Number(c.req.header("content-length") ?? "");
    if (Number.isFinite(declared) && declared > MAX_ARCHIVE_BYTES) {
      throw new HttpError(413, "skill_archive_too_large", archiveTooLarge(MAX_ARCHIVE_BYTES));
    }
    const raw = new Uint8Array(await c.req.arrayBuffer());
    if (raw.byteLength === 0) throw badRequest("压缩包是空的。");
    if (raw.byteLength > MAX_ARCHIVE_BYTES) {
      throw badRequest(archiveTooLarge(MAX_ARCHIVE_BYTES));
    }
    const entries = extractZipSkills(Buffer.from(raw));
    if (entries.length === 0) {
      throw new HttpError(
        404,
        "no_skills_found",
        "这个压缩包里没有找到技能。一个技能是一个含 SKILL.md 的目录，或位于 .agents/skills / .claude/skills 之下。",
      );
    }
    return c.json(await addAll(root, entries, { kind: "archive" }), 201);
  });

  /**
   * 从本机一个目录添加。
   *
   * 路径要过 `realpath` 再用：只有服务端能说一个路径是否存在，而浏览器不能；不解析真实路径就拼接
   * 的话，一个符号链接可以把读取引到它本该到不了的目录去。
   */
  app.post("/directory", async (c) => {
    const raw = requireString(await readJson(c), "path", { minLen: 1, maxLen: 4096 });
    let real: string;
    try {
      real = await fs.realpath(raw.trim());
    } catch {
      throw new HttpError(404, "not_found", `目录不存在：${raw.trim()}`);
    }
    const entries = await findSkillsInTree(real);
    if (entries.length === 0) {
      throw new HttpError(
        404,
        "no_skills_found",
        "这个目录里没有找到技能。一个技能是一个含 SKILL.md 的目录，或位于 .agents/skills / .claude/skills 之下。",
      );
    }
    return c.json(await addAll(root, entries, { kind: "directory", path: real }), 201);
  });

  /**
   * 扫本机各个 Agent 装着的技能，**按目录分组**。
   *
   * 按目录而不是拍平，是因为「添加的其实是目录」——同一个 Agent 的一组技能是一起被加进来的，一次
   * 点击对应的也是一组。拍平之后用户要么逐个勾选，要么被迫一次性导入整台机器上的所有技能。
   *
   * **没有 Agent 装技能的项目也要报出来**（groups 里为空数组），这样「扫过了但什么都没装」与「没
   * 有扫」在界面上是两件能分辨的事，而不是同一个空白。
   */
  app.get("/scan", async (c) => {
    const groups: MachineSkillScanResponse["groups"] = [];
    let projects: import("node:fs").Dirent[];
    try {
      projects = await fs.readdir(root, { withFileTypes: true });
    } catch {
      projects = [];
    }
    for (const project of projects) {
      if (!project.isDirectory() || project.name.startsWith(".")) continue;
      const agentsRoot = path.join(root, project.name, "agents");
      let agents: import("node:fs").Dirent[];
      try {
        agents = await fs.readdir(agentsRoot, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const agent of agents) {
        if (!agent.isDirectory() || agent.name.startsWith(".")) continue;
        const agentPath = path.join(agentsRoot, agent.name);
        const skills = await skillsInAgentDir(agentPath);
        groups.push({
          agentId: agent.name,
          agentPath,
          projectId: project.name,
          skills: skills.map((s) => ({ name: s.name, version: s.version })),
        });
      }
    }
    return c.json({ groups } satisfies MachineSkillScanResponse);
  });

  /**
   * 按记录的来源检查并升级。
   *
   * **回到当初的来源去查**，因为这就是「升级」被定义成的事。压缩包来源**如实报告无从检查**而不是
   * 假装已是最新——原始文件不在机器上，没有第二个地方可以查；而没有来源记录的技能（手工复制进来的
   * 目录）同理。
   *
   * 版本比较用 `comparePluginVersions` 而不是字符串比较：版本号是 `YYYY-MM-DD.N`，字符串比较会把两
   * 个字段判反（`2026-09-02.1` 在文本上低于 `2026-08-04.1`，因为第十个字符上 `0` < `1`），而把
   * 降级当成升级会把用户能用的版本覆盖掉。
   */
  app.post("/:name/upgrade", async (c) => {
    const name = requireValidId(c, "name");
    const current = (await listMachineSkills(root)).find((s) => s.name === name);
    if (current === undefined) {
      throw new HttpError(404, "not_found", `技能不在本机技能库里：${name}`);
    }
    const record = await readMachineSkillSource(root, name);

    if (record === null || record.source.kind === "archive") {
      // From an archive, or copied in by hand: there is nowhere to check, and saying
      // "up to date" would be a claim this route cannot support.
      return c.json({
        name,
        upgraded: false,
        upgradable: false,
        currentVersion: current.version,
      } satisfies MachineSkillUpgradeResponse);
    }

    const entries = await fetchCurrent(record.source);
    if (entries === null) {
      return c.json({
        name,
        upgraded: false,
        upgradable: false,
        currentVersion: current.version,
      } satisfies MachineSkillUpgradeResponse);
    }
    const fresh = entries.find((e) => e.name === name);
    if (
      fresh === undefined ||
      current.version === null ||
      fresh.version === null ||
      comparePluginVersions(fresh.version, current.version) <= 0
    ) {
      // Not newer, or nothing to compare: leave the installed copy exactly as it is. Replacing it
      // with identical content would only churn the files and the installed-at time.
      return c.json({
        name,
        upgraded: false,
        upgradable: true,
        currentVersion: current.version,
      } satisfies MachineSkillUpgradeResponse);
    }
    await writeMachineSkill(root, name, fresh.files, record.source);
    return c.json({
      name,
      upgraded: true,
      upgradable: true,
      version: fresh.version,
    } satisfies MachineSkillUpgradeResponse);
  });

  /**
   * 本机启用/关闭一个技能。
   *
   * **每台机器上的每个运行时都作废**，因为这个开关没有 Project 可以限定范围：技能是每次构建会话时
   * 从磁盘读的，而进行中的会话早已组装好了提示词，只作废某个 Project 的运行时会让同一个技能对
   * 一个 Agent 开启、对另一个关闭，直到各自恰好被逐出。
   */
  app.post("/enabled", async (c) => {
    const body = await readJson(c);
    const name = requireString(body, "name", { minLen: 1, maxLen: 200 });
    const enabled = body.enabled;
    // 不做真值转换：字符串 `"false"` 是真值，把它当成 `true` 会写入与调用方本意相反的状态。
    if (typeof enabled !== "boolean") throw badRequest("enabled must be a boolean.");
    const written = await setMachineSkillEnabled(root, name, enabled);
    deps.manager.invalidateAllRuntimes();
    return c.json({ name, enabled: written });
  });

  /**
   * 从本机删除一个技能。
   *
   * **只动本机库**：Agent 里的副本留着，所以这不是「让某个 Agent 不再用它」（那是关闭），而是把
   * 这台机器上的那份拿走。
   */
  app.delete("/:name", async (c) => {
    const name = requireValidId(c, "name");
    await removeMachineSkill(root, name);
    deps.manager.invalidateAllRuntimes();
    return c.json({ name, removed: true });
  });

  return app;
}

/** 一个 zip 里的技能；解不开就是一个能读懂的错误，而不是空列表。 */
function extractZipSkills(bytes: Buffer): SkillEntry[] {
  return parseSkillArchiveSkills(bytes);
}

/**
 * 按记录的来源再取一次技能，返回那个来源上现在有的技能。
 *
 * 返回 null 而不是抛错：来源可能已经没了（仓库删了、目录被移动），而「取不到了」对升级来说是一个
 * 要如实说出的**结果**，不是一次服务端故障。
 */
async function fetchCurrent(
  source: NonNullable<Awaited<ReturnType<typeof readMachineSkillSource>>>["source"],
): Promise<SkillEntry[] | null> {
  try {
    if (source.kind === "url") {
      const bytes = await download(new URL(source.url));
      return parseSkillArchiveSkills(bytes);
    }
    if (source.kind === "directory") {
      const real = await fs.realpath(source.path);
      return await findSkillsInTree(real);
    }
  } catch {
    return null;
  }
  return null;
}
