# AI companion mode — settings switch and per-user persona injection

- **Date:** 2026-09-10
- **Type:** feature
- **Scope:** `core`, `server`, `web`

[中文版](2026-09-10-companion-mode.zh.md)

Added an opt-in "AI companion mode" toggle in System settings → General. When on, every new task the user sends is preceded by a `[companion_persona]` block carrying a short persona prompt, so the Agent replies in a softer, more attentive tone. The setting is per-user (`ui_prefs.companionModeEnabled`); off by default.

## Settings switch

A `Switch` row sits between the currency row and the trace-import row on the General page (`packages/web/src/features/settings/companion-mode-row.tsx`). It hydrates on mount via `GET /api/me/prefs` and persists on change via `PUT /api/me/prefs` (shallow merge), so a lost write only costs persistence — the next mount reads the stored value back. The `Switch` stays disabled until hydration lands, so the UI never flashes the wrong value before settling. The companion-mode strings land on `S.settings.companionModeTitle` and `S.settings.companionModeInfo`, mirrored to `strings-en.ts`.

## Marker

A new `[companion_persona]` marker (`packages/core/src/omnimessage/markers/origin-blocks.ts`) is added next to the other message-prefix markers (`[use_skills]`, `[handoff_from]`, `[scheduled_task]`, `[model_switch_from]`, `[background_task_done]`). The default persona text ships with the engine as `DEFAULT_COMPANION_PERSONA_TEXT`; `buildCompanionPersonaMessage(text?)` accepts an override for hosts that want their own copy. `parseCompanionPersonaMessage` is the inverse, with the same dual-form contract (canonical square form + legacy angle form for old Traces). The tag joins `TITLE_NOISE_TAGS`, so `stripLeadingMarkerBlocks` strips it from goal-mode objectives and `stripConversationMarkers` never lets it reach a generated Session title. `isWholeOriginBlock` also returns `true` for the new block.

## Server injection

`POST /api/sessions/:sessionId/tasks` reads `ui_prefs.companionModeEnabled` at the top of the handler (`safeReadPrefs` in `http/routes/sessions.ts`, which mirrors `me.ts`'s tolerance for corrupted JSON). When on, the handler prepends `userText(buildCompanionPersonaMessage(), "server")` to the parsed message list in both the goal branch and the plain branch. In the plain branch the prepended message is the FIRST element of the array fed to `attachFilesToInput`, so `appendAttachmentLines` (which only touches the LAST text message) leaves the persona block intact and the user's text still carries the file markers on it as the Web composer expects. In the goal branch the persona block stays in `messages` (the model sees it) but is stripped by `stripLeadingMarkerBlocks` before the saved `objective`, so the goal plugin does not re-inject the persona every round.

## Compatibility

No data migration. `UiPrefs` gains an optional `companionModeEnabled?: boolean` field (`packages/server/src/api/types.ts`); the existing `[key: string]: unknown` index signature already accepted it, so the field is purely IDE-level typing. Off by default, so existing users see no behaviour change. Switching the toggle has no effect on already-running Sessions — only on tasks started after the toggle (which is also when the server reads the prefs). The marker block never appears in Trace titles or goal objectives, so it does not contaminate anything the user might browse back to.
