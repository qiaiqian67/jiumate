# Docs:新增能力盘点与路线图页

- **Date:** 2026-09-07
- **Type:** docs
- **Scope:** `docs`

[English](2026-09-07-docs-capability-matrix.md)

公开 docs 站点的 **design** 段新增一页:`packages/docs/content/capability-matrix.{en,zh}.md`。它是平台当前能力的权威盘点,以及相对于"本地优先的多代理平台"应承担的工作负载,我们识别出的能力空白。

这是一份活的文档。页面末尾的**决策表**是我们已经认定要做的空白清单的唯一权威记录,行的 `Status` 走 `pending → accepted → in-progress → shipped`(或 `deferred` / `rejected` 附一行原因)。上面的**能力盘点**与**空白分析**会随决策表变更而更新。以后每条实现表格里某一行的 changelog 条目都按行号反向引用此表。

## 页面内容

1. **方法** —— 盘点是怎么做的(直接逐层读源码,标注路径)。
2. **能力盘点** —— Core / Server / Web / CLI / 插件 / Desktop / 公开站点 / 工程化。每条引用支撑它的文件路径。
3. **空白分析** —— 按 UX、安全 · 多用户 · 合规、SDK / 引擎、CLI、数据 · 部署 · 文档、工程化分类。每条给影响和建议。
4. **优先级建议** —— P0/P1/P2/P3 + T-shirt 规模。
5. **决策表** —— 团队勾选用。
6. **更新日志** —— 每次页面变更追加。

## Sidebar

`packages/docs/src/lib/nav.ts` 在 `design` 段、`sessions-and-traces` 之后注册该 slug。Content integrity 测试(`packages/docs/test/content.test.ts`)通过 —— 两种语言文件都有 title,无孤儿文件。

## 下一步

团队 review 页面并填写决策表。当行从 `pending` 翻到 `accepted`,每行展开为对应版本的执行计划(worktree 分支、PR 链、changelog 条目、quality gates),遵循 `.agents/skills/linsight-dev/SKILL.md`。