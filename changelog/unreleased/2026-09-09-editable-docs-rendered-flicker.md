# Mermaid / Markdown rendered view flickers in the Files panel

- **Date:** 2026-09-09
- **Type:** fix
- **Scope:** `web`

[中文版](2026-09-09-editable-docs-rendered-flicker.zh.md)

Follow-up to the Mermaid wiring from [2026-09-09-editable-docs-ux-fixes](./2026-09-09-editable-docs-ux-fixes.md): the flowchart rendered, but the surrounding Markdown pane pulsed with no error in the console. Root cause: the `components` map passed to `<ReactMarkdown>` was built as an inline object literal inside `WorkspaceBrowser`'s JSX, so every parent commit produced a fresh `pre` / `img` / `a` function reference — react-markdown treats those as new component types, React unmounts and remounts every fenced block on every commit, and `MermaidBlock`'s `useEffect` clears the innerHTML, async-imports mermaid, and re-renders. The cycle repeats until something in the parent settles, which never does during reading.

## What changed

- The Markdown rendered view is now a separate `React.memo`-wrapped `RenderedMd` component. Its `components` map is a `useMemo` keyed on the captured inputs (file path, file read nonce, session id, source-highlight cap, and the relative-link click handler). Parent commits that don't change any of those re-use the same component types; React does not remount fenced blocks.
- The relative-link click handler (`onLinkClick`) takes a plain callback reference. `WorkspaceBrowser`'s `previewPath` callback has long been stable (the open request-locate effect pins it through a ref), so it isn't a re-render trigger either.

## Why this also matters for non-mermaid files

- The same inline `components` map served the `img` cache-buster (`v=<nonce>`) and the relative-link resolver. The memoization preserves both behaviors; it just stops them from re-running on every parent commit.

## Tests

- `pnpm --filter @prismshadow/linsight-web test` — 1685 tests pass. The existing `workspace-browser-edit.test.ts`, `workspace-browser-mermaid.test.ts`, `markdown-gfm.test.ts`, and `md-mermaid.test.ts` all stay green.