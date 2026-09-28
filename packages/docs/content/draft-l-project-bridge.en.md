---
title: DRAFT L — Project-level: messaging bridge + model scope
description: A draft of product requirements captured from the user, not yet promoted to the gap analysis or decision table.
---

> **DRAFT — User-input requirement (in progress).** This block is **outside the page's authoritative inventory**: a draft of product requirements captured from the user, not yet promoted to the gap analysis or decision table. When the requirement is officially picked up, it is split out into the appropriate sections and decision table, and this draft is deleted. State is user-driven; the items may be mutually exclusive, duplicated, or incomplete — the user has flagged "more to come".

## L. Project-level: messaging bridge + model scope

Observation: JiuMate is already a multi-project system, but the messaging bridge and model credentials are still at a mixed session / project granularity — "project as a first-class citizen" unified management is missing.

Two related-but-distinct requirements:

- **Project-level remote control**: messaging bridges (Feishu / QQ / WeChat / DingTalk etc.) are bound to the **project**, not the **dialog / session**; new dialogs in the project auto-inherit the bridge
- **Models distinguish enterprise-level vs project-level**:
  - **Enterprise**: org-wide / global model presets visible to all projects
  - **Project**: project-private model credentials
  - **New project does not reconfigure models**: when creating a new project, the user can pick from enterprise presets, reuse credentials from another project, or configure new ones — not be forced to re-enter API keys

| Requirement | Status | Notes |
|---|---|---|
| Project-level messaging bridge | missing (currently session-level, see `messaging_bindings` table) | promote binding to project granularity; session-level override still allowed |
| Bridge inheritance | missing | sessions in a project auto-inherit the project bridge; explicit override supported |
| Enterprise model presets | partial | current `PUT /models` is whole-table declarative; needs a new "enterprise" scope (visible to all projects in the org) |
| Project-level model credentials | partial (`.project_config.toml` 0600, owner-writable) | per-project credentials already exist; needs a "reuse" flow |
| New-project wizard: reuse model | missing | on project creation: ① pick from enterprise preset ② copy credentials from another project ③ configure fresh — default ① |
| Model scope UI | TBD | model management page groups by "enterprise / project"; credentials still masked |
| Multi-project bridge isolation | TBD | can a single Feishu bot bind multiple projects? need project routing rules? |