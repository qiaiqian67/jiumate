/**
 * 快捷调用在插件自带的技能上必须是可用的。
 *
 * **这是修了两轮都没修对的那个 bug。** 前两轮都在修 `draft-view` 的时序——那些问题是真的、也修了
 * ——但都不是用户看到的那一个：按钮**一直是禁用的**，因为它判断的那个字段根本不存在。
 *
 * 两个来源回答两个不同的问题，只有其中一个知道 Agent 在哪：
 *
 *   - `catalog.skills`   —— 所有 Agent 已装技能的并集，**带 `agents`**
 *   - `catalog.plugins`  —— 插件库，即"这个插件**带**什么技能"，`PluginItem` 上**根本没有
 *                           `agents` 字段**
 *
 * 技能 TAB 把前者里的技能和后者里的技能混在一起显示，却从后者读 `agents`——于是 `p.agents` 是
 * `undefined`，`skill.agents.includes(currentAgent)` 对**每一个**插件自带技能都是 false，按钮永久
 * 禁用。而这正是快捷调用唯一该工作的那批技能：独立技能（`catalog.skills`）那条路是对的，所以按钮
 * 在它们身上能点——这让 bug 看起来像"有的技能能点、有的不能"。
 *
 * TypeScript 没拦住，因为对象字面量被 spread 合并进了一个更宽的类型。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** Reads under `packages/web/src` … */
const src = (...parts: string[]): string =>
  fs.readFileSync(path.join(__dirname, "..", "src", ...parts), "utf8");

/**
 * Reads a sibling package. Reached by walking out of `packages/web` rather than by a `../..` path:
 * the two are siblings, and a test that hardcodes how deep the monorepo sits breaks when it moves.
 */
const sibling = (pkg: string, ...parts: string[]): string =>
  fs.readFileSync(path.join(__dirname, "..", "..", pkg, "src", ...parts), "utf8");

const page = src("features", "plugins", "plugins-page.tsx");
const skillServer = sibling("server", "services", "plugin-library.ts");

describe("quick invoke is offered on plugin-bundled skills", () => {
  it("takes the Agent list from the skill catalog, which is the only source that has one", () => {
    expect(page).toContain("catalogByName");
    expect(page).toContain("agents: installed?.agents ?? []");
  });

  it("does not read a field that does not exist", () => {
    // The one line that caused it. `p.agents` is not optional-but-absent — the object has no such
    // property, so this is not a strictness question, it is reading the wrong document.
    expect(page).not.toContain("agents: p.agents");
  });

  it("confirms a PluginItem really has no agents field", () => {
    // Pinned so the join above cannot be "simplified" back into the plugin list. If a future change
    // does give PluginItem an `agents`, the index becomes redundant — and this test is what makes
    // that visible instead of leaving two sources of the same truth to disagree.
    const toPluginItem = /export function toPluginItem[\s\S]*?\n\}/.exec(skillServer);
    expect(toPluginItem, "toPluginItem not found").not.toBeNull();
    expect(toPluginItem![0]).not.toContain("agents");
  });

  it("gates on an empty list rather than crashing when the catalog lacks the skill", () => {
    // A plugin in the library but installed nowhere has no catalog record. `?? []` keeps the gate
    // answerable: no Agents have it, so the button is disabled — which is correct, and is not the
    // same as crashing on `undefined.includes`.
    expect(page).toContain("?? []");
  });
});

describe("the skill catalog does carry agents", () => {
  it("fills agents per skill from the Agents that have it installed", () => {
    // The other half of the join: it is only a valid source because this is true.
    const routes = sibling("server", "http", "routes", "skills.ts");
    expect(routes).toMatch(/async function projectSkillCatalog[\s\S]{0,900}agents: \[agentId\]/);
  });
});
