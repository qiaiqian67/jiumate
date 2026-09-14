# App Center cards adopt the model-library card-detail pattern

- **Date:** 2026-09-10
- **Type:** feature
- **Scope:** `web`

[中文版](2026-09-10-app-center-card-detail.zh.md)

App Center cards now follow the two-part shape the plugins library uses (`features/plugins/plugins-page.tsx`): the card's main body opens a read-only detail Modal, a paper-plane icon button on the right edge is the quick-start that triggers the same `fillExample`/`fillShortcut` handoff the Modal's footer uses. The previous tile was a single button whose whole surface navigated to `/chat/new`, which felt like the catalog was ejecting the user into a chat instead of letting them read the example. The new shape keeps both affordances on one card without leaving the page.

## Card layout

Each card is a horizontal flex with two children: a primary button (cover glyph + label + description + the meta line `分类：X · 预选 N 项技能`) that opens the detail Modal, and a fixed-square secondary button on the right carrying the paper-plane icon (`SEND_ICON`, now exported from `components/ui/icons.tsx` so the plugins library and the App Center can share one path). The icon button is gated on the same `skillsLoaded` flag the previous whole-card button was, so a quick-start without the agent's installed skills still stays inert. The card's own disabled state is gone — only the quick-start button is gated, the body always opens the preview.

## Detail Modal

The Modal renders `ExampleDetailModal` from `features/chat/example-detail.tsx`, mirroring `PluginDetailModal`'s chrome (cover tile + title + full description + meta + a skill-chips section + a read-only prompt body). The Modal's footer carries a cancel button and a primary "在草稿中打开" button that calls the same `fillExample`/`fillShortcut` the icon button does, so a user who reads first and decides still lands on the same composer state as a one-click fill. Shortcuts render with `⚡` cover, a fixed `S.chat.appCenter.shortcutMeta` line, and an empty skill section under the placeholder `S.chat.appCenter.noSkillsHint` — the shortcut doesn't pin any skills.

## Strings

`S.chat.appCenter` gains `detailTitle`, `invoke`, `invokeHint`, `promptLabel`, `skillsLabel`, `noSkillsHint`, `metaLine(folderName, skillCount)`, and `shortcutMeta`. The page-level `pageDesc` and `fillHint` are unchanged. All new keys mirror to `strings-en.ts`.

## Compatibility

No data migration, no server changes — pure web-side. The `fillExample`/`fillShortcut` body is unchanged (park + saveDraft + navigate `/chat/new`); the difference is only where the call is wired. The card's outer styling changed from a single rounded button to a flex row, so the existing `grid grid-cols-1 sm:grid-cols-2` container still lays them out two-per-row without any change in spacing.