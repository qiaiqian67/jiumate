---
title: DRAFT H — Editable generated documents
description: A draft of product requirements captured from the user, not yet promoted to the gap analysis or decision table. Includes the H.1 candidate base evaluation (AGIAgent).
---

> **DRAFT — User-input requirement (in progress).** This block is **outside the page's authoritative inventory**: a draft of product requirements captured from the user, not yet promoted to the gap analysis or decision table. When the requirement is officially picked up, it is split out into the appropriate sections and decision table, and this draft is deleted. State is user-driven; the items may be mutually exclusive, duplicated, or incomplete — the user has flagged "more to come".

## H. Editable generated documents

| Requirement | Status | Notes |
|---|---|---|
| Generated documents continue to be editable | missing | bento slides, reports, eval output etc. should be editable after landing, not read-only artifacts |

### H.1 Candidate base evaluation — AGIAgent

Candidate: [agi-hub/AGIAgent](https://github.com/agi-hub/AGIAgent) — Python multi-agent framework + ColorDoc rich-document generator. 266 stars / 27 forks / 301 commits. The agent side ships its own ReAct, 40+ built-in tools, MCP, shell, multi-agent orchestration; the **ColorDoc** side produces MD / Word / PDF / LaTeX exports and ships in-GUI visual editors for SVG, Mermaid, and Markdown.

Conclusion: **do not adopt AGIAgent as a base**; treat it only as reference. Reasoning:

| Dimension | Assessment |
|---|---|
| Architectural overlap | AGIAgent is another agent platform (ReAct / MCP / tool registry / memory), sitting at the same layer as Linsight's `engine/context-engine.ts` / `environment/mcp/` / `state/`. Integration means two runtimes side by side — events, registries, and subagent nesting semantics all collide |
| Stack mismatch | AGIAgent is Python 3.8+; Linsight is TypeScript / Node 24 end-to-end. Bridging requires a Python sidecar and adds operational weight |
| Community size | 266 stars — small; long-term dependency risk is elevated |
| "Editable" coverage | The core ask of H is "post-generation editing" — that is a UX + persistence problem, not an agent runtime problem. AGIAgent solves "how to generate", not "how to keep the artifact editable" |

UX points worth borrowing (no code reuse, just interactions):

- **Markdown visual editor**: add an "Edit" button to the web file viewer; mount a Markdown editor (react-md-editor / TipTap)
- **Mermaid / SVG inline editor**: an `InlineDiagramEditor` component to drag-edit SVG diagrams
- **Multi-format export pipeline**: reuse Linsight's existing `remark-parse` / `unified`; add a pandoc bridge for Word / PDF export

Linsight's own path (estimated: one `feat/` branch, 1–3 days):

1. Agent writes artifacts to `<workspace>/<name>.md` or `<name>.bento.html` (already in place)
2. Web file viewer adds an "Edit" button → swaps to a Markdown editor (react-md-editor / Monaco / TipTap — pick one)
3. Save writes directly back to the workspace file; trace records the edit event through a `stop` hook
4. Add an `editable-doc` skill that constrains the generation format so the LLM produces artifacts that remain editable
5. Build in-place editors for Mermaid / SVG / bento.html separately (borrow AGIAgent's UX)