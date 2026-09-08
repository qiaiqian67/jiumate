# In-place Markdown editor in the Files panel + the `editable-doc` plugin

- **Date:** 2026-09-08
- **Type:** feature
- **Scope:** `web`, `plugins`, `core`, `cli`, `desktop`

[中文版](2026-09-08-editable-docs.zh.md)

The Files panel's `.md` preview gained an **Edit** toggle alongside Rendered and Source. Clicking it swaps the pane for a CodeMirror 6 markdown editor (lazy-loaded into its own chunk), with **Cmd/Ctrl-S → Save** and **Esc → Cancel** keybindings. Save routes through the existing `PUT /api/sessions/:sessionId/files/content` endpoint — no new server route, no new permission: the same member-or-owner gate that protects the file preview covers the write. The whole edit loop (open, edit, save, re-read the rendered view) stays inside one component; the draft survives nothing between sessions, so navigating to another file drops the unsaved bytes the same way clicking Back or Cancel does.

## The `editable-doc` plugin

- New preinstalled plugin `plugins/editable-doc/` — `@linsight/editable-doc`, declared as a workspace dependency from `core`, `cli` and `desktop` so the loader picks it up everywhere an Agent runs.
- One skill, **`format`**, teaching the agent the format rules that keep what it writes editable afterwards: atomic H2 sections, fenced blocks with their opening language (` ```mermaid `, ` ```ts `, …), real Markdown lists and GFM tables (not preformatted-space walls), no HTML for layout, no code block nested inside a list item, and a section past ~80 lines is split at an H3.

## Conflict banner

- If the Agent rewrites the same `.md` file while the user has a dirty draft, a yellow banner appears with **Reload** (replaces the editor draft with the latest server bytes) and **Save anyway** (drops the banner; the actual save still goes through the Save button). The server is last-write-wins; the banner is the warning, not a lock.

## Discard-confirm on Cancel / back-to-list

- Cancel and back-to-list both check `editorDirty`; if a draft is in flight they open the existing `ConfirmModal` with the copy "Discard unsaved changes?". A pristine edit closes straight to the read view.

## i18n

- Four new `S.files.*` keys (`edit`, `editSave`, `editCancel`, `editConflictBanner`, `editDiscardConfirm`) in both `strings.ts` (zh) and `strings-en.ts` (en). The new keys are exercised by an i18n-parity unit test in `packages/web/test/workspace-browser-edit.test.ts`.

## README tables

- `plugins/README.md`, `README.md` and `README.zh.md` each gained an `editable-doc` row in the Office Productivity / 办公效率 column. The README table guard test in `packages/core/test/plugins.test.ts` keeps the three in lockstep.

## Tests

- `packages/core/test/plugins.test.ts`: loader picks up `editable-doc`; the count assertion (12 → 13), the `office-productivity` membership list, and the new per-plugin assertions on the `format` skill's body all run as part of the standard `pnpm --filter @prismshadow/linsight-core test`.
- `packages/web/test/workspace-browser-edit.test.ts`: state-machine coverage — UTF-8 → base64 round-trip (ASCII / CJK / emoji), the i18n parity guard, the `MarkdownEditor` module surface and the plugin manifest.
- `packages/web/e2e/workspace-edit.spec.mjs`: end-to-end round-trip via Playwright + the mock LLM — seeds a `.md` file through the existing `PUT /files/content` API, opens it in the Files panel, edits it through both the Save button and `Mod-S`, asserts the toast and the bytes the server returns on re-fetch.