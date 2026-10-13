/**
 * 「添加技能」在页面上只应出现一次。
 *
 * **这是一个真实犯过的错。** 添加按钮本来就存在于页面头部，注释里写明「添加是页面唯一的动作，
 * 所以每个页签都占同一个位置」；我在技能页签内部又加了一个，于是同一屏上出现两个同名按钮，
 * 而它们打开的是**不同的**对话框——用户无法分辨哪个是真的，两个都可能试错。
 *
 * 所以这不是一条风格规则，而是一个具体的失败模式。测试读源码文本：渲染逻辑无法在 node 里跑，
 * 而这里要抓的恰恰是「同一个文案在两个组件里都被渲染成按钮」这种结构问题，文本断言对它是对的工具。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string =>
  fs.readFileSync(path.join(__dirname, "..", "src", ...rel.split("/")), "utf8");

describe("add-skill button placement", () => {
  it("renders the add-skill button only in the page, never inside the tab", () => {
    const page = read("features/plugins/plugins-page.tsx");
    const tab = read("features/plugins/skills-tab.tsx");

    // The page owns it, in the header slot every tab shares.
    expect(page).toContain("S.plugins.addSkill}");
    // The tab must not render one: two identically labelled buttons on one screen, opening
    // different dialogs, is worse than either placement on its own.
    expect(tab).not.toContain("S.plugins.addSkill}");
  });

  it("gives the tab no dialog of its own to open", () => {
    const tab = read("features/plugins/skills-tab.tsx");
    // If the tab had its own dialog, adding a button there would be one keystroke away.
    expect(tab).not.toContain("AddSkillDialog");
  });

  it("re-renders the machine store when the page reports an add", () => {
    const tab = read("features/plugins/skills-tab.tsx");
    // Otherwise a skill added from the header does not get its machine switch and upgrade button
    // until the tab happens to remount.
    expect(tab).toContain("machineStoreRevision");
  });
});
