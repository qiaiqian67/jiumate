# App Center page + draft screen tabs

- **Date:** 2026-09-10
- **Type:** feature
- **Scope:** `web`

[中文版](2026-09-10-app-center-page.zh.md)

A new `/app-center` page lists the whole examples catalog — built-in starters plus the user's saved shortcuts — filed into category tabs (Web apps / Agents / Schedules / My shortcuts). Each example is rendered as a card with the per-task cover glyph as a 56px thumbnail, a two-line title and a two-line description. Clicking a card parks the active draft, writes a new draft cache entry with the canned prompt + skill pins, and navigates to `/chat/new` — exactly what the same card does on the draft screen, so the two surfaces stay one catalog.

The draft screen's example block switched from bookmark-style folder rows to a tab strip at the same time. Each built-in folder's tasks render under its tab with the cover glyph sitting at the left of every row, so a returning user can recognize an example without reading the title. The "My shortcuts" tab keeps the existing `ShortcutsFolder` content; the active-tab state replaces the previous `openFolder` state with no behavior change beyond the tab affordance.

## Sidebar entry

`App Center` is the first entry of the page-nav group (`应用中心 → 评估中心` on both sides), pinned in `NAV_GROUP_KEYS` so the sidebar renders it directly off the manifest alongside Agents / Plugins / Models / Cost Center / Evaluation Center. `/app-center` also shows up in the collapsed rail's page list for consistency with the other pages. The route is wired in `router.tsx`; the page lives in `features/chat/app-center-page.tsx`.

## Data flow

Click on a card:

1. `parkActiveDraft(userId, projectId)` — moves any typed-but-unsent text into the parked drafts list (the same call the skill library's Quick Invoke uses).
2. `saveDraft(key, { ...loadDraft(key), agentId, text, skills, handoffAgentId: undefined })` — writes a new draft cache entry; `modelRef` is preserved through the spread so the user's model choice carries over.
3. `setCurrentAgentId(agentId)` + `navigate(/chat/new, { state: { agentId } })` — opens the draft page on the right agent. The user reads, edits, and sends there; nothing is sent from the App Center.

The card's disabled state mirrors the draft screen's gate on `skillsLoaded`: until the agent's installed skill list is known, the example's skill pins would be silently dropped, so the card stays inert.

## Compatibility

No data migration, no server changes — pure web-side. The `EXAMPLE_FOLDERS` registry gains a `cover?: string` field per task; existing entries were filled in with single-character emoji defaults. A row without a `cover` (older programmatic data) falls back to `S.chat.appCenter.coverFallback`.
