# Docs:能力盘点拆分为 11 个文档

- **Date:** 2026-09-08
- **Type:** docs
- **Scope:** `docs`

[English](2026-09-08-docs-capability-matrix-split.md)

原本单一的 `capability-matrix` 页面拆分为 11 个独立文档,每段可单独维护与开发。原始 `capability-matrix` 页面保留为小型**索引页**,链接到其余文档;能力盘点、空白分析、决策表、各 DRAFT 段(G–M)各自成为 docs 站 `design` 段下的独立页。

## 变更内容

原本单文件的 `packages/docs/content/capability-matrix.{en,zh}.md`(每语言约 370 行)现在拆为:

| Slug | 路径 | 原内容 |
|---|---|---|
| `capability-matrix` | `packages/docs/content/capability-matrix.{en,zh}.md` | 索引 + 方法 + 更新日志(本页保留导航表) |
| `capability-inventory` | `packages/docs/content/capability-inventory.{en,zh}.md` | 按 package 的能力盘点(Core / Server / Web / CLI / Plugins / Desktop / 公开站点 + 工程化) |
| `capability-gaps` | `packages/docs/content/capability-gaps.{en,zh}.md` | 空白分析(A–F)+ 优先级建议 |
| `capability-decisions` | `packages/docs/content/capability-decisions.{en,zh}.md` | 决策表(10 行 pending) |
| `draft-g-collaboration` | `packages/docs/content/draft-g-collaboration.{en,zh}.md` | DRAFT G — 协作能力(社交层) |
| `draft-h-editable-docs` | `packages/docs/content/draft-h-editable-docs.{en,zh}.md` | DRAFT H — 文档可编辑 + H.1 AGIAgent 评估 |
| `draft-i-app-center` | `packages/docs/content/draft-i-app-center.{en,zh}.md` | DRAFT I — 应用中心 + 快捷指令 UI |
| `draft-j-knowledge-base` | `packages/docs/content/draft-j-knowledge-base.{en,zh}.md` | DRAFT J — 知识库 + 文档归一化 |
| `draft-k-companion` | `packages/docs/content/draft-k-companion.{en,zh}.md` | DRAFT K — 情绪价值 + 数字桌宠 |
| `draft-l-project-bridge` | `packages/docs/content/draft-l-project-bridge.{en,zh}.md` | DRAFT L — 按项目维度:消息桥接 + 模型作用域 |
| `draft-m-reminders` | `packages/docs/content/draft-m-reminders.{en,zh}.md` | DRAFT M — 会话确认的实时提醒 |

## Sidebar

`packages/docs/src/lib/nav.ts` 把 `capability-matrix` 注册为父 slug,10 个新 slug 作为其 `children`,在 `design` 段下缩进显示。结构对齐 `quickstart` 已有的 parent + `children` 模式。

## 拆分理由

原页面把四种生命周期混在一个文件里:

1. **能力盘点** —— "今天已交付",按 package 分。不同审阅者看不同 package;一个 Core 改动会触发全页 diff。
2. **空白分析 + 优先级** —— "已知缺失"。由团队维护,与盘点 churn 节奏不同。
3. **决策表** —— "已认定要做"。权威行动登记,单独存在以便指向发布分支。
4. **DRAFT G–M** —— "用户口述"。逐项独立开发;一个文件意味着每改一次都要重读不相关的段。

拆分后每段都有独立 frontmatter 和标题。能力盘点可按 package 单独 review;决策表独立成档;每条 DRAFT 可直接用其 slug(`/draft-h-editable-docs`)在 changelog、PR、issue 里引用。

## 验证

`pnpm --filter @prismshadow/linsight-docs test` —— `content.test.ts` 通过:

- `DOCS_NAV` 中每个 slug 都有 `.zh.md` 和 `.en.md` 且带 frontmatter title
- `content/` 中每个文件都对应 `DOCS_NAV` 中的某个 slug(无孤儿)
- 文档内部链接指向的 slug 都在导航里
- 侧边栏 `prev` / `next` 按声明顺序串过 `capability-matrix` 下的 11 个新页面

`pnpm --filter @prismshadow/linsight-docs typecheck` —— 未引入新错误。