# AI companion mode — visible banner above the composer

- **Date:** 2026-09-10
- **Type:** feature
- **Scope:** `web`

[中文版](2026-09-10-companion-banner.zh.md)

The companion-mode switch added earlier in the day now has a visible face: a thin card pinned above the composer, drawn from the same `useCompanionStore` the toggle writes to. The card shows an inline-SVG fox and a one-line status; on every turn boundary it pops a small reaction bubble that fades after four seconds. Companion-mode stays off by default, so users who don't opt in see no DOM change at all.

## Banner card

`packages/web/src/features/chat/companion-banner.tsx` renders a `rounded-lg` row with an orange tint, mounted in `chat-page.tsx` right above `<ChatInput>` (and below the goal-status banner, which keeps the in-flight goal's progress on top). The card has three states read from the Session stream:

- **idle** — `taskState === "idle"`: the pet's eyes are open, the tail sways slowly, and the line reads "🐾 I'm here with you" / "🐾 我在这里陪着你".
- **running** — any non-idle `taskState`: eyes close to short bars, status flips to "thinking…" / "在想…".
- **just done** — every running → idle transition pops a reaction bubble below the pet (a one-word pool of five strings per language, picked deterministically by a turn counter). The bubble mounts at `opacity-0 / -translate-y-1` and a `requestAnimationFrame` flips it to the visible state on the next paint so the `transition-all` plays the entry animation; a four-second timer clears it.

The banner reads its enabled state from a single new context (`CompanionProvider` in `features/chat/companion-store.tsx`) mounted at the root of `<AppLayout>`. The Settings dialog's switch and the banner share that store, so flipping the toggle updates the banner on the next render without a reload. `enabled === null` (prefs still hydrating) keeps the banner unmounted, so an unhydrated user never sees a companion they didn't ask for.

## Animations

The tail sway and the bubble's rise-and-fade are pure CSS keyframes added to `styles.css` (`companion-tail-sway`, drawn from `transform-box: fill-box` so the pivot tracks the tail's local box). Both keyframes are pure `transform` / `opacity` animations, so the existing global `prefers-reduced-motion` block disables them cleanly without a JS media query — the pet stands still instead of disappearing.

## Compatibility

No data migration. The new banner only reads what the previous companion-mode entry already wrote (`ui_prefs.companionModeEnabled`); the only new wiring is the `CompanionProvider` mounted once at the layout root. The card sits inside the existing composer container's padding, so the layout below shifts only when the card itself is mounted (opt-out users see no change). No new dependency; the SVG pet is inline `<path>` / `<circle>` / `<rect>` with Tailwind classes, no asset pipeline.