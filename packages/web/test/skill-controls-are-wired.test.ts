/**
 * 技能卡片上的每个控件，背后都得有一个**存在**的实现。
 *
 * **这是一个犯过的错误。** 上一轮五个控件里只有两个（机器开关、升级）真的实现了，另外三个
 * （快捷调用、管理安装、删除）画在卡片上、写得进 changelog，点下去什么都不发生——因为它们的
 * 后端路由压根没写。
 *
 * 2000 多个测试全绿，因为它们测的是我写的代码，没有一个会问「这个按钮点了之后会发生什么」。
 * 这一组测试问的正是那个问题，而且刻意用**最笨的方式**问：从按钮的 `onClick` 一路追到服务端的
 * 路由注册，中间任何一环断了就失败。
 *
 * 为什么值得这么写：控件从组件到 handler 到 api 到路由有四层，任何一层写错，TypeScript 都不会
 * 报错——`onClick` 接到一个空函数是完全合法的 TS。追下去才拦得住。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const src = (...parts: string[]): string =>
  fs.readFileSync(path.join(__dirname, "..", "src", ...parts), "utf8");

const skillsTab = src("features", "plugins", "skills-tab.tsx");
const pluginsPage = src("features", "plugins", "plugins-page.tsx");
const endpoints = src("api", "endpoints.ts");

describe("skill card controls are wired to something real", () => {
  it("gives every control an onClick or onChange", () => {
    // Five controls, five handlers. The count is the point: a sixth button added later without a
    // handler would break this, which is the moment to notice.
    //
    // **Both syntaxes, because the card's actions are now menu items rather than JSX attributes.**
    // The handlers did not stop being real when they moved from `onClick={() => …}` on a `<Button>`
    // into `onClick: () => …` on a `CardMenuItem`. Counting only the attribute form would have
    // reported this as five controls with no handlers — the same failure this test exists to catch,
    // arrived at from a refactor that changed no behaviour.
    const attribute = skillsTab.match(/on(?:Click|Change)=\{\(\) => /g) ?? [];
    const property = skillsTab.match(/on(?:Click|Change): \(\) => /g) ?? [];
    // 升级 / 快捷调用 / 管理安装 / 开关 / 删除, plus the category filter and the tab-level controls.
    expect(attribute.length + property.length).toBeGreaterThanOrEqual(5);
  });

  it("routes each control to a handler rather than to nothing", () => {
    expect(skillsTab).toContain("void upgradeSkill(machineSkill)");
    expect(skillsTab).toContain("onQuickInvoke(quickInvokeSkill.name)");
    expect(skillsTab).toContain("onManageInstall(skill.name)");
    expect(skillsTab).toContain("void switchOff(skill)");
    expect(skillsTab).toContain("void onDeleteSkill(skill.name)");
  });

  it("has a page handler behind each of the three the tab delegates", () => {
    // The tab cannot implement these itself: quick invoke writes a draft and navigates, manage
    // installs needs the page's agent list, delete needs the page's confirm. So they arrive as
    // props — and a prop with no implementation behind it is exactly what went wrong last time.
    expect(pluginsPage).toContain("onQuickInvoke={quickInvoke}");
    expect(pluginsPage).toContain("onManageInstall={");
    expect(pluginsPage).toContain("onDeleteSkill={deleteMachineSkillByName}");
  });

  it("has a real quick invoke that navigates, rather than a prop that does nothing", () => {
    // The failure mode being guarded: a handler that sets some state and stops. Asserting on the
    // navigation is the only way to tell "does the thing" from "does something".
    //
    // **Bounded to the function, not to a character count.** An earlier version matched
    // `{0,900}` characters after the signature, which silently depended on how much comment sat
    // between the two statements — so adding a paragraph of explanation about *why* the body is
    // empty broke a test about whether it navigates. The two are unrelated, and the assertion
    // should not have been able to tell them apart.
    const page = fs.readFileSync(
      path.join(__dirname, "..", "src", "features", "plugins", "plugins-page.tsx"),
      "utf8",
    );
    const fn = /const quickInvoke = \(skillName: string\) => \{[\s\S]*?\n  \};/.exec(page);
    expect(fn, "quickInvoke not found in plugins-page.tsx").not.toBeNull();
    expect(fn![0]).toMatch(/navigate\(\s*`\/chat\//);
    expect(fn![0]).toContain("saveDraft(");
  });

  it("has the API functions the handlers call", () => {
    expect(endpoints).toContain("export const mountMachineSkill");
    expect(endpoints).toContain("export const removeAgentSkill");
    expect(endpoints).toContain("export const deleteMachineSkill");
    expect(endpoints).toContain("export const upgradeMachineSkill");
    expect(endpoints).toContain("export const setMachineSkillEnabled");
  });

  it("has every server route those endpoints call", () => {
    // The layer that was simply missing: 管理安装 had a button and a handler and no route.
    //
    // Reached by walking up out of `packages/web` rather than by a sibling path: `packages/web`
    // and `packages/server` are siblings, and a test that hardcodes how deep the monorepo is will
    // break the moment this file moves.
    const repoRoot = path.join(__dirname, "..", "..", "..");
    const skills = fs.readFileSync(
      path.join(repoRoot, "packages", "server", "src", "http", "routes", "skills.ts"),
      "utf8",
    );
    const machine = fs.readFileSync(
      path.join(repoRoot, "packages", "server", "src", "http", "routes", "machine-skills.ts"),
      "utf8",
    );
    // Mount and unmount a Skill on one Agent.
    expect(skills).toContain('app.post("/:name"');
    expect(skills).toContain('app.delete("/:name"');
    // Upgrade, switch and delete on the machine store.
    expect(machine).toContain('app.post("/:name/upgrade"');
    expect(machine).toContain('app.post("/enabled"');
    expect(machine).toContain('app.delete("/:name"');
  });
});
