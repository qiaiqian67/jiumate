# AI companion placements — four-way picker, right-rail widget, and floating desktop pet

- **Date:** 2026-09-10
- **Type:** feature
- **Scope:** `server`, `web`, `desktop`

[中文版](2026-09-10-companion-placement.zh.md)

Replaced the single "AI companion mode" toggle with a four-way placement picker, and shipped the two surfaces the picker points to. The user now picks where the companion lives: **Off** (no companion anywhere), **Banner** (a card above the composer, the prior behaviour), **Widget** (a persistent right-rail panel next to the dock), or **Floating** (a frameless, always-on-top Electron desktop pet). The persona-block injection that the previous boolean toggle controlled still triggers for every placement except Off, so the user's chosen tone-of-voice is independent of where the pet appears.

## Placement picker

`ui_prefs.companionModeEnabled: boolean` was replaced by `ui_prefs.companionPlacement: "off" | "banner" | "widget" | "floating"` (`packages/server/src/api/types.ts`). The new field is optional and shares the same shallow-merge `PUT /api/me/prefs` semantics, so a partial write never clobbers neighbouring fields. The companion-mode row on the General settings page (`packages/web/src/features/settings/companion-mode-row.tsx`) now renders a `Segmented<CompanionPlacement>` with `cols={4}` instead of a `Switch`; the four labels (`companionModeOff / Banner / Widget / Floating`) ship in both `strings.ts` and `strings-en.ts`, alongside a refreshed `companionModeInfo` describing what each placement does. In the Vite dev build the **Floating** segment is intercepted at click time and shows a toast (`companionModeFloatingDevHint`) explaining that the floating window is desktop-only — the desktop app is the only host with an Electron `BrowserWindow` to put the pet in.

The store at `packages/web/src/features/chat/companion-store.tsx` now exposes `{ placement, floatingPosition, setPlacement, setFloatingPosition }` (a React Context consumed by `app-layout.tsx` since the previous PR). It hydrates from `GET /api/me/prefs` and writes through `PUT /api/me/prefs`; flipping a segment applies instantly and the persistence happens fire-and-forget. The store also reads `companionFloatingPosition: { x: number; y: number }`, persisted by the floating window on drag-end and restored on the next open.

The server's `POST /api/sessions/:sessionId/tasks` handler now gates the persona-block injection through `placementEnablesPersona()` (`packages/server/src/http/routes/sessions.ts`): any of `"banner" | "widget" | "floating"` enables it; `"off"` does not; an unknown string is opt-out (garbage from a stale client or a corrupted prefs file lands on "off", not "broken"). The 11-case parameterised test (`packages/server/test/companion-persona.test.ts`) pins every branch — default off, each of the three new placements, explicit off, the legacy `companionModeEnabled: true` migration, the legacy `false` opt-out, the explicit-overrides-legacy precedence, garbage strings, corrupted JSON, and unrelated fields.

## Banner

`CompanionBanner` (`packages/web/src/features/chat/companion-banner.tsx`) still renders the thin card above the composer. The mount gate changed from `enabled !== true` to `placement !== "banner"`, and the pet visual + status text now come from a shared `<CompanionPet size="sm">` (`packages/web/src/features/chat/companion-pet.tsx`) that all three surfaces import. The two-frame bubble animation, the seed counter, the language-sniff helper, and the 4 s auto-dismiss are unchanged.

## Widget

`CompanionWidget` (`packages/web/src/features/chat/companion-widget.tsx`) is a new right-rail surface — a 280-px-wide `aside` that mounts between the chat column and the right dock (`packages/web/src/features/chat/chat-page.tsx:2047`, inside the `data-dock-row` flex container). The widget yields when the right dock is occupied (`rightMount.view === null`) and on narrow viewports (`!isNarrow()`, the same `1023.98px` breakpoint the dock uses), so it never crowds the composer or fights the dock for horizontal space. It does not draw a bubble (the chat conversation is already next to it); the pet just sits idle / thinking with a localised one-line status (`companionWidgetIdleHint` / `companionWidgetThinkingHint`) underneath.

## Floating window (desktop only)

A new Electron `BrowserWindow` (`packages/desktop/src/companion-window.ts`, exposed in `main.ts` as `companionHandle`) hosts the web app at `/companion`. The window is frameless, transparent, always-on-top, non-resizable, and skips the taskbar; the pet SVG is the only visible chrome, with `WebkitAppRegion: drag` on the wrapper so dragging anywhere on the canvas moves the window. A small × button (no-drag region) closes the window via the preload bridge.

The shell exposes a typed preload bridge (`packages/desktop/src/preload.ts`, `contextBridge.exposeInMainWorld("companion", …)`) with five methods: `open(savedPos?)`, `close()`, `move(pos)`, `getPosition()`, and `savePosition()`. Both the chat window and the companion window load this preload; the chat window calls `open` when the placement becomes `"floating"` (passing the persisted position from `ui_prefs`), and the companion window calls `move` / `savePosition` during drag. The same-origin `/companion` route means the existing `linsight_session` cookie carries across — no new claim token, no new auth path.

IPC handlers (`companion:open / close / move / getPosition / savePosition`) sanitise every payload (`sanitisePosition` in `companion-window.ts` rejects NaN, ±Infinity, and non-numbers, so a buggy drag can't push the window off-screen) and clamp the saved position to whichever display's workArea it most likely belongs to, falling back to the primary display's bottom-right corner with a 24-px margin when the user has unplugged a monitor between sessions. `window-all-closed` now quits only when **both** the chat window and the companion window are gone — closing the chat window no longer yanks a still-open pet away, and `activate` on macOS refuses to recreate the chat window while the companion is alive.

The chat page drives the companion over a `BroadcastChannel("linsight-companion")` (hyphenated deliberately so the install-scope scanner doesn't mistake it for a localStorage key): the chat page posts `taskState` on every change so the floating pet mirrors the chat-window pet's pose; the companion page receives them and applies the same two-frame bubble / 4 s dismiss pattern as the banner. When the chat page's `placement` flips away from `"floating"`, it calls `window.companion.close()` to dismiss the pet.

## Compatibility

- **No data migration.** The previous boolean field is honoured: `PUT /api/me/prefs` writes that still carry `companionModeEnabled: true` are translated to `companionPlacement: "banner"` in `me.ts` before the shallow merge, so a user who opted in before the refactor keeps seeing the companion (now as the Recommended "banner" placement) until they pick something else. The legacy key is deleted from the persisted JSON, never stored alongside the new one.
- **`PUT /api/me/prefs` unchanged.** The shallow-merge semantics are still the contract; the placement picker only ever writes its own field.
- **The persona-block marker wire format is unchanged.** `[companion_persona]` and `MARKER_TAGS.companionPersona` are still the byte sequence on the wire and the strip-list key — Traces replay identically.
- **The dev build gracefully degrades.** Selecting Floating in `pnpm dev` shows the dev-hint toast and does nothing, so a web-only developer can verify the picker without an Electron shell.
- **No per-user data is invalidated.** A non-admin user who has never visited System settings has no `companionModeEnabled` in their prefs; the new code treats that as `"off"` and the absence of a `companionPlacement` key as opt-out — both invisible to such users.

## Tests

- `packages/server/test/companion-persona.test.ts` — 11 cases (`it.each`) covering every branch of the gate, including the legacy migration.
- `packages/web/test/companion-store.test.ts` — 8 cases pinning `placementFromPrefs` (explicit placement, legacy `true` migration, legacy `false` opt-out, garbage strings, unrelated fields, `COMPANION_PLACEMENTS` ordering).
- `packages/web/test/companion-banner-helpers.test.ts` — 7 cases (unchanged from the previous PR).
- `packages/desktop/test/companion-window.test.ts` — 7 cases pinning `sanitisePosition` (rounding, NaN/Infinity rejection, non-number rejection) and `clampToDisplays` (in-boundary pass-through, off-screen fallback).