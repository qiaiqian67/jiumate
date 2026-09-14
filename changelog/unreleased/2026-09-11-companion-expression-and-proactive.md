# AI companion — expression layer, proactive-trigger skeleton, companion-specific settings page

- **Date:** 2026-09-11
- **Type:** feature
- **Scope:** `server`, `web`

[中文版](2026-09-11-companion-expression-and-proactive.zh.md)

Building on the four-way placement picker shipped yesterday, this round adds the three things the pet needs to feel alive: a multi-pose state machine driven by the agent's `SessionStatus` (L.1), a proactive-chat trigger skeleton that watches user activity and decides when the pet is allowed to speak (L.2), and a companion-specific settings page where the user picks the pet's name, pronoun, and proactive interval (L.3). Together they are the smallest viable slice of the airi-style "the user wants to spend time with it" goal, designed so a later TTS / ASR / VRM phase plugs in without rewiring this layer.

## Pet expression layer

The shared `<CompanionPet>` (`packages/web/src/features/chat/companion-pet.tsx`) now drives a 7-pose state machine — `idle / thinking / listening / speaking / celebrating / confused / sleepy` — keyed off `SessionStatus`. `poseFromTaskStateForTest` maps `idle` to `idle` and every other state (`running`, `compacting`) to `thinking`; the banner flips the pet into `celebrating` while the reaction bubble is up so the visible pose change mirrors the conversational beat. The pet SVG carries its geometry in a single `POSE_GEOMETRY` table — `tilt`, `eyeY`, `eyeShape`, `mouth`, `tailSpeed`, `ears` — so adding a pose means adding one row, not a re-layout.

Visual behaviour:

- **Eye tracking.** The pet follows the cursor within a ±2 px window (clamped at the SVG's bounding box), so a hand hovering on the right side of the pet looks like the pet is following it.
- **Random blink.** Every 3-7 s the pet blinks, independent of pose; a `prefers-reduced-motion` media query silences the blink but not the pose changes.
- **Click reaction.** A click on the pet (mounted through any surface — banner, widget, floating) sets `isWaving` for 1.5 s: a per-side ear wiggle + an extra-fast tail wag. Stops propagation so the click does not also reach the composer or the dock.
- **Idle micro-motion.** A slow breathing scale and an occasional ear twitch keep the pet from looking frozen between turns.

The pose CSS keyframes (`companion-tail-sway-fast`, `companion-breathe`, `companion-ear-wave`) live in `packages/web/src/styles.css` next to the previous round's `companion-tail-sway`; each is transform-only so they layer cleanly with the existing animation. Status copy (`statusCopyForTest`) is keyed off pose in both `strings.ts` and `strings-en.ts`, and the unit test pins a non-empty, distinct string for every one of the seven poses in both languages so a future copy change cannot silently fall through to "I'm here with you".

## Proactive-trigger skeleton

`packages/web/src/features/chat/use-proactive-trigger.ts` is the L.2 skeleton: a hook that subscribes to `mousedown / keydown / touchstart / wheel` on `document`, re-evaluates every 5 s, and flips `armed` to `true` exactly once per quiet spell that exceeds the configured threshold. It does NOT yet call the LLM — that work belongs to a later phase which will subscribe to the `armed` transition and decide what to say. The split is intentional: the trigger is pure local logic (no I/O, no API surface), so its behaviour can be pinned by a unit test without stubbing anything, and the future "what to say" half can be swapped without disturbing the trigger.

Threshold semantics, pinned by `isProactiveArmedForTest`: any non-positive threshold (including `0`, the "Off" slider stop, and `NaN`) keeps the hook disarmed forever; only an idle gap strictly greater than or equal to the threshold fires `armed = true`. Any new activity event disarms immediately so the trigger does not fire twice for one quiet spell.

The hook is mounted on the chat page (`packages/web/src/features/chat/chat-page.tsx`) right after the BroadcastChannel handler; the mount is unconditional — `threshold = 0` simply causes the hook to drop its listeners and stay in the "never armed" state. The pet therefore observes real document events the moment the chat page is open, without needing a fake DOM in unit tests.

## Companion-specific settings page

A new **AI companion** page in the Personal group of System settings (`packages/web/src/lib/settings-sections.ts` adds `companion` between `appearance` and `account`). The page is independent of the Agent workflow: editing the companion's name or pronoun does not by itself enable the companion, and the page is visible even when the placement picker on General is "off".

Three rows, in `packages/web/src/features/settings/companion-section.tsx`:

- **Name** (`companionNameLabel`): a 40-character input. Empty means "use the default greeting" rather than "the user forgot to set one" — the server stores the empty string as-is, and downstream copy decides what to render.
- **Pronoun** (`companionPronounLabel`): a 4-segment `Segmented<CompanionPronoun>` over the closed list `he / she / they / it` (mirrors the new `CompanionPronoun` enum on the server). "they" is the default when unset; an unknown string is rejected server-side rather than silently mapped.
- **Proactive interval** (`companionProactiveTimeoutLabel`): a 6-stop `Segmented<number>` over `Off / 1 min / 5 min / 15 min / 30 min / 60 min`. The slider's ms value is rounded and clamped by `snapProactiveTimeoutMsForTest` so a stored value that does not match a stop (older build, manual edit) snaps to the nearest stop on hydrate.

Settings persist via three new optional `ui_prefs` fields (`companionName?: string`, `companionPronoun?: CompanionPronoun`, `companionProactiveTimeoutMs?: number`) added to `UiPrefs` in `packages/server/src/api/types.ts`. All three are validated on write by `packages/server/src/services/companion-prefs.ts` (length cap for the name, closed-list membership for the pronoun, 0-or-finite-in-range for the timeout); a rejected write stores nothing and returns 400, mirroring `draftShortcuts`. The store at `packages/web/src/features/chat/companion-store.tsx` now exposes `name / pronoun / proactiveTimeoutMs` alongside the existing `placement / floatingPosition`, hydrates from `GET /api/me/prefs`, and writes through `PUT /api/me/prefs` fire-and-forget.

## Compatibility

- **No data migration.** The three new fields are optional, and an old prefs file hydrates with `name = ""`, `pronoun = "they"`, `proactiveTimeoutMs = 0` — the same defaults a brand-new user sees.
- **Existing placements unchanged.** The 4-segment placement picker on General still owns the placement field; this page is strictly additive.
- **The persona-block marker wire format is unchanged.** `[companion_persona]` and `MARKER_TAGS.companionPersona` are still the byte sequence on the wire and the strip-list key.
- **Proactive chat is opt-in.** The default is `proactiveTimeoutMs = 0` ("never proactive"), so a user who never opens the new page sees no behaviour change. A user who does open it can dial the slider to 0 again at any time.
- **Validation is enforced server-side.** A request that bypasses the editor (e.g. a hand-crafted PUT) cannot put an unbounded name into the prefs row; the same 40-char cap, the same closed pronoun list, and the same `[60_000, 3_600_000]` ms range apply.

## Tests

- `packages/web/test/companion-pet.test.ts` — 4 cases: `COMPANION_POSES` is exactly the seven documented poses, `poseFromTaskStateForTest` maps `idle` → `idle` and every other state → `thinking`, `statusCopyForTest` returns non-empty distinct copy in both languages for every pose, and the most-seen `idle` vs `thinking` pair reads as different micro-copy.
- `packages/web/test/companion-store.test.ts` — 8 `placementFromPrefs` cases (existing) + 6 new `companionIdentityFromPrefs` cases pinning the three neutral defaults, every valid pronoun echoed, garbage strings and `NaN` falling back to the defaults.
- `packages/web/test/use-proactive-trigger.test.ts` — 6 cases: `isProactiveArmedForTest` never arms under `threshold <= 0`, arms exactly at the threshold, and `snapProactiveTimeoutMsForTest` snaps both exact stops and off-stop values to the nearest one.
- `packages/server/test/companion-prefs.test.ts` — 12 cases across the three fields: store-and-roundtrip for valid values, reject for each bounded case (name length, unknown pronoun, sub-floor / over-ceiling / non-numeric timeout), and the route-level "rejected write stores nothing" claim verified by seeding an unrelated field and re-reading after a failed PUT.