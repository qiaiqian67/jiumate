# Docs: capability matrix and roadmap page

- **Date:** 2026-09-07
- **Type:** docs
- **Scope:** `docs`

[中文版](2026-09-07-docs-capability-matrix.zh.md)

A new page is added to the public docs site under the **design** sidebar section: `packages/docs/content/capability-matrix.{en,zh}.md`. It is the canonical record of what the platform ships today and the gaps we have identified against the workloads a local-first multi-agent platform is expected to serve.

The page is a living document. The **Decision log** table at the bottom is the canonical record of which gaps we have agreed to take on; rows move `pending → accepted → in-progress → shipped` (or `deferred` / `rejected` with a one-line reason). The **Capability inventory** and **Gap analysis** sections above are updated whenever the decision log changes. Future changelog entries that implement a feature in the table refer back to it by row.

## Page contents

1. **Methodology** — how the inventory was compiled (read every layer's source directly, path-annotated).
2. **Capability inventory** — Core / Server / Web / CLI / Plugins / Desktop / Public sites / Repo engineering. Every item cites the file path that backs it.
3. **Gap analysis** — categorized by UX, security · multi-user · compliance, SDK / engine, CLI, data · deploy · docs, engineering. Each gap has an impact and a suggested fix.
4. **Priority recommendations** — P0/P1/P2/P3 with T-shirt sizing.
5. **Decision log** — the table the team fills in.
6. **Update log** — appended on every change to the page.

## Sidebar

`packages/docs/src/lib/nav.ts` registers the slug under the `design` section, after `sessions-and-traces`. Content integrity test (`packages/docs/test/content.test.ts`) verified — both language files have titles, no orphan files.

## Next step

The team reviews the page and fills the Decision log. Once rows flip from `pending` to `accepted`, each row expands into a per-version execution plan (worktree branch, PR chain, changelog entry, quality gates) per `.agents/skills/linsight-dev/SKILL.md`.