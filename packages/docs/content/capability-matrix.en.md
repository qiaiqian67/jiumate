---
title: Capability inventory and roadmap
description: What the platform does today, what it does not yet do, and which gaps we plan to close. This page is the index; the inventory lives at capability-inventory, gaps and priorities at capability-gaps, decision log at capability-decisions.
---

This page is the **index** of Linsight's current capability. The original content has been split by lifecycle into standalone documents so each one can be maintained and developed independently:

| Document | Contents |
|---|---|
| [Capability inventory](/capability-inventory) | What each package ships today + key paths (Core / Server / Web / CLI / Plugins / Desktop / public sites + repo engineering) |
| [Gap analysis and priority recommendations](/capability-gaps) | Six blocks A–F of gaps + T-shirt-sized priority recommendations |
| [Decision log](/capability-decisions) | Canonical record of the gaps we have committed to take on |
| [DRAFT G — Collaboration](/draft-g-collaboration) | Multi-user / shared session / comments / @mention / favorites & tags / inbox |
| [DRAFT H — Editable generated documents](/draft-h-editable-docs) | Generated artifacts remain editable (with H.1 AGIAgent evaluation) |
| [DRAFT I — App Center + shortcut UI](/draft-i-app-center) | Built-in + custom examples in TAB form |
| [DRAFT J — Knowledge base + document normalization](/draft-j-knowledge-base) | Reference: anydoc |
| [DRAFT L — Project-level: messaging bridge + model scope](/draft-l-project-bridge) | Enterprise vs project model scope |
| [DRAFT M — Real-time reminders for session confirmations](/draft-m-reminders) | Push, not poll |

---

## Methodology

The inventory and gap analysis were produced by a layer-by-layer source read (snapshots live in the per-page documents above):

- `packages/core` — SDK and execution engine
- `packages/server` — HTTP API, SSE routing, scheduler, persistence
- `packages/web` — React 19 SPA
- `packages/cli` — the `linsight` command and its subcommands
- `plugins/*` — the 12 shipped plugin packages
- `packages/desktop` — Electron shell
- `packages/landing`, `packages/docs` — public sites
- `.github/` — CI, release, security policy

Every entry cites the file path it leans on; if the path is wrong or has moved, treat the row as wrong. The page's credibility rests entirely on the paths it references.

---

## Update log

- 2026-09-07 — initial inventory and gap analysis compiled from a fresh source read across all packages.
- 2026-09-08 — added six user-input DRAFT sections: G (collaboration) / H (editable documents) / I (app center + shortcut UI) / J (knowledge base + doc normalization) / L (project-level bridge + model scope) / M (real-time reminders for confirmations). Marked DRAFT — to be graduated into the published inventory and decision table after the user finishes collecting requirements.
- 2026-09-08 — **H.1 candidate base evaluation**: evaluated [agi-hub/AGIAgent](https://github.com/agi-hub/AGIAgent); conclusion: **do not adopt as a base** (architectural overlap + stack mismatch + small community); borrow only its in-GUI Markdown / Mermaid / SVG editor UX. Linsight will go its own route: Web editors + format-constraining skill + trace hook.
- 2026-09-08 — **split into 11 documents**: the capability-matrix index page is preserved (this page); the original "capability inventory / gap analysis + priorities / decision log / DRAFT G–M" each become 10 standalone documents under the docs site's design section. Maintenance now tracks per package, per gap, and per draft item, which keeps the development loop tighter.