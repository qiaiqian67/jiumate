# Docs: split capability-matrix into 11 documents

- **Date:** 2026-09-08
- **Type:** docs
- **Scope:** `docs`

[中文版](2026-09-08-docs-capability-matrix-split.zh.md)

The single `capability-matrix` page is split into 11 standalone documents so each segment can be maintained and developed independently. The original `capability-matrix` page is preserved as a small **index** that links to the rest; the inventory, gap analysis, decision log, and each DRAFT section (G–M) become their own page under the docs site's `design` sidebar section.

## What changed

The previous monolithic `packages/docs/content/capability-matrix.{en,zh}.md` (~370 lines per language) is now:

| Slug | Path | Source content |
|---|---|---|
| `capability-matrix` | `packages/docs/content/capability-matrix.{en,zh}.md` | Index + methodology + update log (this page keeps the navigation table) |
| `capability-inventory` | `packages/docs/content/capability-inventory.{en,zh}.md` | Capability inventory per package (Core / Server / Web / CLI / Plugins / Desktop / Public sites + repo engineering) |
| `capability-gaps` | `packages/docs/content/capability-gaps.{en,zh}.md` | Gap analysis (A–F) + priority recommendations |
| `capability-decisions` | `packages/docs/content/capability-decisions.{en,zh}.md` | Decision log table (10 pending rows) |
| `draft-g-collaboration` | `packages/docs/content/draft-g-collaboration.{en,zh}.md` | DRAFT G — collaboration (social layer) |
| `draft-h-editable-docs` | `packages/docs/content/draft-h-editable-docs.{en,zh}.md` | DRAFT H — editable generated documents + H.1 AGIAgent evaluation |
| `draft-i-app-center` | `packages/docs/content/draft-i-app-center.{en,zh}.md` | DRAFT I — App Center + shortcut UI |
| `draft-j-knowledge-base` | `packages/docs/content/draft-j-knowledge-base.{en,zh}.md` | DRAFT J — knowledge base + doc normalization |
| `draft-k-companion` | `packages/docs/content/draft-k-companion.{en,zh}.md` | DRAFT K — emotional value + digital desktop pet |
| `draft-l-project-bridge` | `packages/docs/content/draft-l-project-bridge.{en,zh}.md` | DRAFT L — project-level messaging bridge + model scope |
| `draft-m-reminders` | `packages/docs/content/draft-m-reminders.{en,zh}.md` | DRAFT M — real-time reminders for session confirmations |

## Sidebar

`packages/docs/src/lib/nav.ts` registers `capability-matrix` with the 10 new slugs as its `children`, indented under it in the `design` section. The structure mirrors `quickstart`, which already uses a parent + `children` layout.

## Rationale

The original page mixed four lifecycles in one file:

1. **Capability inventory** — "what we have today", per-package. Different reviewers per package; one big file meant a Core change forced a full-page diff.
2. **Gap analysis + priorities** — "what we know we're missing". Owned by the team; churns differently from the inventory.
3. **Decision log** — "what we've committed to". The canonical action register; lives separately because it points at release branches.
4. **DRAFT G–M** — "what the user said out loud". Each item will be developed independently; one file meant every edit forced a re-read of unrelated items.

After the split, each segment lives in its own file with its own frontmatter and title. The inventory can be reviewed per package; the decision log stands alone; each DRAFT item can be referenced directly by its slug (`/draft-h-editable-docs`) in changelogs, PRs, and issue bodies.

## Verification

`pnpm --filter @prismshadow/linsight-docs test` — `content.test.ts` passes:

- Every slug in `DOCS_NAV` has both `.zh.md` and `.en.md` with a frontmatter title.
- Every file in `content/` corresponds to a slug in `DOCS_NAV` (no orphans).
- Internal doc links resolve to a navigated slug.
- Sidebar pager (`prev` / `next`) routes through all 11 new pages under `capability-matrix` in declaration order.

`pnpm --filter @prismshadow/linsight-docs typecheck` — no new errors introduced.