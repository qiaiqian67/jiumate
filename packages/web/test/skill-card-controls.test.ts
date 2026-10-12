/**
 * 技能 TAB 的机器级开关与升级入口：哪些卡片上出现哪些控件。
 *
 * 测的是组件里那三个判定函数本身，而不是它们的复刻——这一层唯一会悄悄错的地方，就是「一个技能
 * 有没有本机库条目」，因为那正是两个控件该不该出现的依据：给内置技能画上机器开关，写下去的值
 * 没有任何技能读；给没有来源记录的技能画上升级按钮，用户按下它只会得到一句道歉。
 */
import { describe, expect, it } from "vitest";
import type { MachineSkill } from "../src/api/endpoints";
import {
  hasMachineSwitch,
  hasUpgrade,
  isMachineSkillOn,
} from "../src/features/plugins/skills-tab";

const skill = (source?: MachineSkill["source"]): MachineSkill => ({
  name: "x",
  version: null,
  addedAt: 0,
  ...(source !== undefined ? { source } : {}),
});

describe("skill card machine controls", () => {
  const store = new Map<string, MachineSkill>([
    ["from-url", skill({ kind: "url", url: "https://example/repo" })],
    ["from-dir", skill({ kind: "directory", path: "/somewhere" })],
    ["from-zip", skill({ kind: "archive" })],
    ["by-hand", skill()],
  ]);

  it("shows the machine switch only for a skill that was added to this machine", () => {
    expect(hasMachineSwitch(store, "from-url")).toBe(true);
    expect(hasMachineSwitch(store, "by-hand")).toBe(true);
    // A built-in or plugin-bundled skill has no machine-store entry, and giving it a machine
    // switch would be a control that writes nothing.
    expect(hasMachineSwitch(store, "builtin-skill")).toBe(false);
  });

  it("shows upgrade for every source that has somewhere to look", () => {
    expect(hasUpgrade(store, "from-url")).toBe(true);
    expect(hasUpgrade(store, "from-dir")).toBe(true);
  });

  it("shows upgrade for an archive source, whose answer will be 「无从检查」", () => {
    // The button is present because the route *can* answer, and its answer is 「nowhere to check」
    // rather than 「already up to date」 — which is the honest one.
    expect(hasUpgrade(store, "from-zip")).toBe(true);
  });

  it("hides upgrade for a skill with no recorded source", () => {
    // Absent rather than present-and-apologetic: a permanently-disabled button's tooltip is a
    // thing nobody reads twice, and the absence is itself the explanation.
    expect(hasUpgrade(store, "by-hand")).toBe(false);
  });

  it("hides both controls for a skill that is not in the machine store", () => {
    expect(hasMachineSwitch(store, "never-added")).toBe(false);
    expect(hasUpgrade(store, "never-added")).toBe(false);
  });

  it("reads as on for a skill it knows nothing about", () => {
    // 必须与服务器同一条规则（不在关闭名单里即为开启），否则卡片会和运行时说的相反。
    expect(isMachineSkillOn(store, "from-url")).toBe(true);
    expect(isMachineSkillOn(new Map(), "anything")).toBe(true);
    expect(isMachineSkillOn(new Map([["x", { ...skill(), enabled: false } as MachineSkill]]), "x")).toBe(
      false,
    );
  });
});