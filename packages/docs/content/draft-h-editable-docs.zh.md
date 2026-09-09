---
title: DRAFT H — 文档可编辑
description: 用户当面提出的、还没进入空白分析或决策表的产品需求草稿。含 H.1 候选底座评估(AGIAgent)。
---

> **DRAFT — 用户输入需求(进行中)**。这块**不在页面权威盘点之内**:用户当面提出的、还没进入空白分析或决策表的产品需求草稿。等正式立项时按工程拆分进对应子节、决策表、路线图,然后本节删除。状态由用户口述驱动,可能互斥、可能重复、可能不完整 —— 用户已声明"后面还有"。

## H. 文档可编辑

| 需求 | 现状 | 备注 |
|---|---|---|
| 生成文档继续可编辑 | 缺失 | bento 幻灯片 / 报告 / 评估产出等落下来后可继续编辑,不是只读产物 |

### H.1 候选底座评估 —— AGIAgent

候选:[agi-hub/AGIAgent](https://github.com/agi-hub/AGIAgent) —— Python 多 agent 框架 + ColorDoc 富文本文档生成器。266 stars / 27 forks / 301 commits。Agent 部分自带 ReAct、40+ 内置工具、MCP、shell、多 agent 编排;**ColorDoc** 部分提供 MD / Word / PDF / LaTeX 导出,GUI 内置 SVG / Mermaid / Markdown 可视化编辑器。

结论:**不引入 AGIAgent 作底座**,只把它当 reference。原因:

| 维度 | 评估 |
|---|---|
| 架构重叠 | AGIAgent 是另一套 agent 平台(ReAct / MCP / tool registry / memory),跟 Linsight 的 `engine/context-engine.ts` / `environment/mcp/` / `state/` 同层。集成 = 两套 runtime 并存,事件、注册表、subagent 嵌套语义都会冲突 |
| 栈错位 | AGIAgent 是 Python 3.8+,Linsight 全栈 TypeScript / Node 24;要走 IPC 桥(sidecar),运维负担大 |
| 社区体量 | 266 stars,体量小,作为长期依赖风险偏高 |
| "可编辑"的解法 | H 的核心诉求是"生成后能继续编辑"—— 这是 UX + 持久化问题,不是 agent runtime 问题。AGIAgent 解的是"如何生成",不是"如何让生成物可编辑" |

值得借鉴的 UX 点(不引入代码,只学交互):

- **Markdown 可视化编辑器**:Web 端在文件 viewer 上加"编辑"按钮,挂一个 MD 编辑器(react-md-editor / TipTap)
- **Mermaid / SVG 内嵌编辑器**:`InlineDiagramEditor` 组件,让 SVG 图表可拖拽
- **多格式导出管线**:复用 Linsight 现有 `remark-parse` / `unified`,加 pandoc 桥接 Word / PDF 导出

Linsight 自走路径(预估 1 个 `feat/` 分支,1–3 天):

1. Agent 写生成物到 `<workspace>/<name>.md` 或 `<name>.bento.html`(已有)
2. Web 文件 viewer 加"编辑"按钮 → 切到 MD 编辑器(react-md-editor / Monaco / TipTap 三选一)
3. 保存直接回写 workspace 文件,trace 通过 `stop` hook 记 edit 事件
4. 新加 `editable-doc` skill,约束生成格式让 LLM 写出可被继续编辑的产物
5. Mermaid / SVG / bento.html 单独做 in-place editor(参考 AGIAgent 的 UX)