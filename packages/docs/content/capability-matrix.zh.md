---
title: 能力盘点与路线图
description: 平台当前能做什么、还不能做什么、以及我们打算补齐哪些空白。本页是索引;能力盘点见 capability-inventory,空白分析与优先级见 capability-gaps,决策表见 capability-decisions。
---

本页是 Linsight 当前能力的**索引**。原内容按生命周期拆分为独立文档,便于逐项维护与开发:

| 文档 | 内容 |
|---|---|
| [能力盘点](/capability-inventory) | 每个 package 今天交付的能力 + 关键路径(Core / Server / Web / CLI / Plugins / Desktop / 公开站点 + 工程化) |
| [空白分析与优先级建议](/capability-gaps) | A–F 六块空白 + T-shirt 规模分级的优先级建议 |
| [决策表](/capability-decisions) | 已经认定要做的空白清单,唯一权威记录 |
| [DRAFT G — 协作能力](/draft-g-collaboration) | 多用户协作 / 共享 session / 评论 / @mention / 收藏标签 / inbox |
| [DRAFT H — 文档可编辑](/draft-h-editable-docs) | 生成物继续可编辑(已附 H.1 AGIAgent 评估) |
| [DRAFT I — 应用中心 + 快捷指令 UI](/draft-i-app-center) | 内置 / 自定义例子 + TAB 形态 |
| [DRAFT J — 知识库 + 文档归一化](/draft-j-knowledge-base) | 参考 anydoc |
| [DRAFT L — 按项目维度：消息桥接 + 模型作用域](/draft-l-project-bridge) | 企业级 vs 项目级模型 |
| [DRAFT M — 会话确认的实时提醒](/draft-m-reminders) | 主动推送,不再依赖盯着 UI |

---

## 方法

拆分前的盘点和空白分析是逐层直接阅读实现源码后整理的(快照见各子页):

- `packages/core` — SDK 与执行引擎
- `packages/server` — HTTP API、SSE 流转、调度器、持久化
- `packages/web` — React 19 SPA
- `packages/cli` — `linsight` 命令及其子命令
- `plugins/*` — 已交付的 12 个插件包
- `packages/desktop` — Electron 外壳
- `packages/landing`、`packages/docs` — 公开站点
- `.github/` — CI、发布、安全策略

每一条都标注了对应的文件路径。如果路径错了或者文件已经变了,把对应声明视为错误 —— 盘点的可信度只取决于它引用的路径。

---

## 更新日志

- 2026-09-07 —— 首次盘点,基于对所有 package 的源码通读;首版空白分析整理完成。
- 2026-09-08 —— 新增"协作(G) / 文档编辑(H) / 应用中心(I) / 知识库(J) / 项目级桥接与模型作用域(L) / 实时提醒(M)"六块用户输入草稿,标记为 DRAFT,待用户继续补充后统一立项。
- 2026-09-08 —— **H.1 候选底座评估**:对 [agi-hub/AGIAgent](https://github.com/agi-hub/AGIAgent) 做尽调,结论是**不引入作底座**(架构重叠 + 栈错位 + 社区体量小),只参考其 GUI 内 Markdown / Mermaid / SVG 编辑器的 UX;Linsight 自走 Web 编辑器 + skill 约束格式 + trace hook 路径。
- 2026-09-08 —— **拆分为 11 文档**:原 capability-matrix 索引页保留(本页),原"能力盘点 / 空白分析+优先级 / 决策表 / DRAFT G–M"各自独立成 10 个新文档,挂在 docs 站 design 段。维护粒度按 package / gap / draft 单项走,方便逐项开发与回归。