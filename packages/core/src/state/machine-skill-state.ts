/**
 * 技能的机器级开关，`<root>/skills-state.json`。
 *
 * **与插件那份（`plugin-machine-state.ts`）是同一件东西，只是各管各的。** 两份文件刻意不合并：
 * 插件和技能是两种安装单位，一个用户可能二十个插件全开、三个技能全关，把它们放进同一个文件只会
 * 让「关掉一个技能」去改写插件的那几行。代价是两份几乎一样的代码，收益是任何一次写只碰自己那
 * 一个文件——一个技能开关坏了不会连带让插件开关失灵。
 *
 * **按技能名作键**，与插件那份按插件名作键同理：技能名就是卡片上的名字，也是机器库里目录的名字，
 * 拿它当键不需要任何一层解析，因此不会因为解析方式变了而挪动。
 *
 * **不存在／读不出／损坏一律读作已启用。** 反过来默认的话，这个文件一出现就会把每台既有机器上
 * 的每个技能都关掉——没人决定过就自己消失的能力，正是开关唯一不能有的失败模式。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { atomicWriteFile } from "../internal/atomic-write.js";
import { assertValidId } from "../internal/valid-id.js";

interface MachineSkillState {
  /** 用户在本机关闭的技能名。 */
  disabled?: string[];
}

const STATE_FILE = "skills-state.json";

/** `<root>/skills-state.json`。 */
export function machineSkillStatePath(root: string): string {
  return path.join(root, STATE_FILE);
}

/**
 * 本机关闭的技能名。
 *
 * 每条路径都容错：文件不存在、解析不了、字段类型不对，都退化成「能捞回来的那一部分」而不是抛错
 * ——一个读者抛错会让整个列表因为一个可以安全默认的标志而挂掉。
 */
export async function readMachineDisabledSkills(root: string): Promise<Set<string>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(machineSkillStatePath(root), "utf8"));
  } catch {
    return new Set();
  }
  if (!parsed || typeof parsed !== "object") return new Set();
  const list = (parsed as MachineSkillState).disabled;
  if (!Array.isArray(list)) return new Set();
  return new Set(list.filter((n): n is string => typeof n === "string" && n !== ""));
}

/** 一个技能在本机是否已启用。不在列表里即为启用（见文件头）。 */
export async function isMachineSkillEnabled(root: string, name: string): Promise<boolean> {
  return !(await readMachineDisabledSkills(root)).has(name);
}

/**
 * 本机启用/关闭一个技能。
 *
 * 启用时是**删除**条目而不是写 `true`：这样这个文件永远只承载例外，而「不在」也就持续意味着「开
 * 启」，无论这份格式以后怎么变。
 *
 * 返回写入后的状态，让调用方报告实际发生了什么，而不是它本来打算做什么。
 */
export async function setMachineSkillEnabled(
  root: string,
  name: string,
  enabled: boolean,
): Promise<boolean> {
  assertValidId("skill_name", name);
  const disabled = await readMachineDisabledSkills(root);
  if (enabled) disabled.delete(name);
  else disabled.add(name);
  const next: MachineSkillState = disabled.size > 0 ? { disabled: [...disabled].sort() } : {};
  await atomicWriteFile(machineSkillStatePath(root), `${JSON.stringify(next, null, 2)}\n`);
  return enabled;
}
