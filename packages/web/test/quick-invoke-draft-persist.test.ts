/**
 * 快捷调用写进草稿的预选，不会被 `persistNow` 抹掉。
 *
 * **这是真凶，前四轮都在修别的地方。** 用真实浏览器抓到的写入序列：
 *
 *   [0] {"agentId":"default_agent","text":"","skills":["data-analysis"]}   ← 快捷调用写对了
 *   [1] {"text":"","workspace":"","approvalMode":"allow-all"}               ← 300ms 后 skills 没了
 *
 * `persistNow` 用组件 state **重建整个** DraftCache。它只建模了一部分字段（text /
 * workspace / approvalMode / agentId / modelRef / skills），而这个草稿里的 `skills` 是**插件页
 * 在本页面挂载之前**写进去的。挂载时的第一次 `persistNow()` 把 `skillsRef.current`（当时还是空的）
 * 写回去，于是预选被抹掉——**比 composer 读到它更早**。
 *
 * 前四轮分别修了：`p.agents` 字段不存在（真的）、缓存读取太早（真的）、`initialSkills` 只在
 * 挂载读（真的）、剪枝时机（真的）。四个都是真 bug，四个都不是这个。共同点是**没有一个去看
 * 运行时写进去了什么**——它们都是读代码推断出来的。
 *
 * 修复：`persistNow` 现在先展开已存的草稿再覆盖自己管的字段。没建模的字段因此能活下来，而它
 * 管的字段仍然优先，不会变旧。
 *
 * 测试断言这一条，因为它是这个 bug 的全部：**不再从一个空白对象开始重建。**
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const src = (...parts: string[]): string =>
  fs.readFileSync(path.join(__dirname, "..", "src", ...parts), "utf8");

const draftView = src("features", "chat", "draft-view.tsx");

describe("persistNow does not erase fields it does not model", () => {
  it("spreads the stored draft before assigning its own fields", () => {
    // The whole fix. Rebuilding from state alone is what dropped the pre-selection. Matched across
    // newlines rather than in one shape, because the formatter reflows it and a test that pins the
    // layout fails on every reformat for no reason.
    expect(draftView).toMatch(
      /const data: DraftCache = \{[\s\S]{0,200}?\.\.\.loadDraft\(draftKey\(userId, projectId\)\)/,
    );
    expect(draftView).not.toMatch(/const data: DraftCache = \{[\s\n]*text: textRef\.current/);
  });

  it("never builds a draft from a bare object literal", () => {
    // The negative of the assertion above, kept separate so a failure says which half broke.
    expect(draftView).not.toMatch(/const data: DraftCache = \{ text: textRef\.current/);
  });

  it("still lets the fields it does own win", () => {
    // Spreading must not make the stored value authoritative for what this component manages —
    // that would let a stale cache entry override live state.
    expect(draftView).toContain("if (agentId) data.agentId = agentId;");
    expect(draftView).toContain("if (modelRef) data.modelRef = modelRef;");
    expect(draftView).toContain(
      "if (skillsRef.current.length > 0) data.skills = skillsRef.current;",
    );
  });
});
