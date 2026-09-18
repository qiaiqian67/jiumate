# Park the desktop pet in the corner, and give it transparency, a size setting, animation and a speech bubble

- **Date:** 2026-09-18
- **Type:** feature
- **Scope:** `desktop`, `server`, `web`

[中文版](2026-09-18-pet-window-corner-bubble-and-size.zh.md)

The floating Petdex pet now behaves like the implementation it was ported from: it parks in the bottom-right corner, paints no background of its own, animates, can be sized, and reports the tracked session's activity in a speech bubble.

## Window

- The default position is the bottom-right of the primary work area (24px margin), clamped to a known display. The old default was the top-left corner, which parked the pet over the app's own title bar and read as "nothing appeared".
- The window is content-sized: the page reports the space it needs over a new `pet:resize` IPC and the shell keeps the **bottom-right corner fixed**, so a bubble grows the window up and to the left instead of pushing the pet off the edge it is parked against. Sizes are clamped to 64px minimum and 360×240 maximum.
- On Windows, `resizable: false` makes the window's minimum track size follow its current size, which turned `pet:resize` grow-only — a bubble could appear but never leave. The shell re-enables resizing for the duration of each resize call, which re-pins that minimum to the new size.
- `pet:open` no longer re-applies the saved position to an already-open window. Doing so undid a drag the user had not released yet and fought the resize anchor.
- Dragging moved into the renderer (pointer events + `pet:move`), and the released position is now written back to `petWindowPosition`. The position was previously never persisted, so every restart returned the pet to the default corner.

## Transparency

- The pet page marks `<html>` with `linsight-pet-host`, and the stylesheet drops the app-wide opaque `body` background under that class. The Electron window was already transparent; the opaque body was what showed as a white slab behind the pet.

## Size

- The pet footprint dropped from 192×208 to 96×104, and the new `petWindowScale` pref (0.5–2, default 1) scales it. Settings → Application offers small / medium / large.
- When a scaled pet plus its bubble would exceed the shell's 360px ceiling, the bubble narrows instead of overflowing.

## Animation

- The walk cycle's duration now comes from the mood's CSS class rather than the atlas cadence. Six idle frames at 1100ms each is a 6.6s loop, which read as a still image.
- Each mood carries a transform animation on top of the walk — breathing at rest, a work bob, a hover hop, a wobble while dragging — and dragging selects the run row and its direction.

## Speech bubble

- New `PetBubble` renders the tracked session's title, a status line (`待机` / `工作中` / `整理上下文`) and the tail of the assistant's latest output, clipped to two lines.
- The activity bridge payload grew from `{ mood, timestamp }` to carry `state`, `title`, `output` and the pet appearance, so the chat window is also how a pet or size change reaches the floating window — a second Electron window's own prefs fetch runs once, at mount.
- The bubble lingers for six seconds after a task finishes so its final line stays readable, then hides.

## Compatibility

- `petWindowScale` is a new `ui_prefs` key; absent or `null` means the default size, so existing rows need no migration.
