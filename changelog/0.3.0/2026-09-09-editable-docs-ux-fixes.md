# In-place Markdown editor: save-in-place, draft-preserving toggle, Mermaid render

- **Date:** 2026-09-09
- **Type:** feature
- **Scope:** `web`

[中文版](2026-09-09-editable-docs-ux-fixes.zh.md)

The Files-panel editor from [2026-09-08-editable-docs](./2026-09-08-editable-docs.md) shipped with four UX rough edges reported the same day. This entry closes them all on the `feat/editable-docs` branch, in lockstep with the server-side conflict check from [2026-09-09-editable-docs-server-conflict](./2026-09-09-editable-docs-server-conflict.md).

## Save stays in edit mode (#40)

- Clicking **Save** no longer auto-flips the view back to the rendered preview. The user remains in the editor, the toolbar's **Save** / **Cancel** buttons stay visible, and the latest ETag from the response is patched into the preview state so the next save's `If-Match` round-trip stays valid.
- The re-fetch of the on-disk file happens in the background, and the freshly saved bytes flow into `preview.content` once it lands — so a manual switch to **Rendered** (or **Source**) shows the just-saved content in real time, exactly as #40 asked for.
- The same shape applies to `Cmd/Ctrl-S` from inside the editor: the keymap still fires `saveMdEdit`, which now keeps the editor mounted.

## View toggle preserves the draft (#41.1)

- The view-mode pills in the preview toolbar are now always visible for `.md` files: **Rendered** / **Source** / **Edit**. Switching between them no longer drops unsaved bytes.
- When the user is mid-edit and toggles to **Rendered**, the body renders the in-flight draft (`draftMd`) — not the on-disk `preview.content` — so they see exactly what they've typed. Same for **Source**: it shows the raw draft, not the bytes that were on disk when they opened the file.
- Entering **Edit** from a non-editing view calls `enterMdEdit` (which snapshots `preview.content` into `draftMd` and mounts the editor). Entering **Edit** while already editing is a no-op beyond focusing the editor.

## Layout: no nested scrollbar, no blank space (#41.2)

- The MarkdownEditor's outer wrapper used to force `h-full` and `overflow-auto`, which produced two visible scrollbars (the panel's `overflow-auto` and the editor's own) and a tall blank area for short documents. The wrapper now self-sizes: CodeMirror's own `.cm-scroller` carries `max-height: 60vh` for long documents and the outer panel scrolls only when the editor genuinely exceeds the pane — no nested scrollbar, no blank space below a one-line file.

## Mermaid renders in chat and the Files preview (#41.3)

- `MermaidBlock` was previously only wired into the export pipeline. Both the chat renderer (`features/chat/md.tsx`) and the workspace browser's markdown preview now route ``` `mermaid` fences through `MermaidBlock` instead of through the Shiki-powered `CodeBlock` (whose chrome is meaningless for an SVG). Mermaid itself stays lazy-imported and the diagram only renders once the message settles (streaming replies show the raw fenced source so a per-delta re-render doesn't freeze the chat).
- The nonce that becomes Mermaid's required-unique DOM id is `callerId-hash32(code)`. The caller id is the message id (chat) or the file's `preview.nonce` (Files preview); `hash32` is a deterministic FNV-1a hash of the source body, so identical diagrams on the same page get distinct nonces and a code edit reliably flips the nonce (Mermaid re-renders).
- New test `packages/web/test/md-mermaid.test.ts` pins the four routing decisions: settled mermaid → MermaidBlock; streaming mermaid → plain `<pre>`; other languages → CodeBlock; math fence → KaTeX.

## GFM coverage confirmed (#41.4)

- The existing `packages/web/test/markdown-gfm.test.ts` (tables, task lists, strikethrough, autolinks, footnotes) covers GFM through the shared `lib/markdown-plugins.ts` pipeline. All five pass — no plugin change was needed; the test was the missing evidence that the feature shipped.

## Tests

- `pnpm --filter @prismshadow/linsight-web test` — 1685 tests pass (including the new `md-mermaid.test.ts`, the existing `markdown-gfm.test.ts`, and the round-trip tests for `apiFetchWithMeta` / `uploadWorkspaceFile` that the editor relies on).
- `packages/web/test/workspace-browser-edit.test.ts` and `workspace-browser-mermaid.test.ts` exercise the toolbar and adapter in isolation.
- The end-to-end run in `packages/web/e2e/workspace-edit.spec.mjs` was updated to toggle **Rendered** after each save so the assertions still pin the saved bytes on disk (a `pnpm test:e2e` pass needs `npx playwright install chromium`; the headless shell wasn't available in this dev container, so the e2e gate is the green build + the unit suite).