# Give the desktop pet a system-tray entry, a catalog refresh, and a scrollable bubble stack

- **Date:** 2026-09-18
- **Type:** feature
- **Scope:** `desktop`, `web`

[中文版](2026-09-18-pet-tray-and-bubble-stack.zh.md)

Three capabilities the reference implementation has and this port did not: control of the pet from the notification area, an on-demand reload of the pet catalog, and a bubble stack that does not silently drop older sessions.

## Tray

- While the pet is enabled the app now keeps an icon in the notification area, with a checkable `显示桌面宠物` item plus `显示主窗口` and `退出`. Mirrors OpenBitFun's `tray.rs` entry.
- The icon exists **only while the pet does**. Closing the main window quits the app unless the pet window is still open, and a tray that outlived the pet would quietly turn that into a background process nobody asked for.
- The `enablePet` pref lives in the renderer, so the item is a relay rather than a write: a click asks the chat window to flip the pref, and the chat window reports the state back over `pet:setEnabled`. The shell cannot reach `ui_prefs`.
- Labels follow the OS locale — the main process has no UI dictionary — and the icon is the 128px render copied to `dist/tray.png`, not the 1024px master (the notification area draws at ~16px).

## Settings

- `刷新列表` re-reads the pet catalog on demand. The list was already refreshed after an import or a delete, but a pack dropped into the data root by hand — or by another host sharing it — had no way to appear without reopening the dialog.

## Bubbles

- Every tracked task now gets a bubble. The stack scrolls past the shell's 240px ceiling instead of silently dropping the oldest sessions; the chat side already caps the list at `PET_MAX_TRACKED_TASKS`.
- The stack's height is set inline from the page rather than as a percentage in CSS: a percentage resolves against the dock's auto height, which let the stack overflow the window unclipped instead of scrolling inside it.
- The stack anchors with `margin-top: auto` instead of `justify-content: flex-end`. With `overflow-y: auto`, flex-end pushes the overflow out of the scrollable area on the block-start side, where it is clipped and unreachable.

## Compatibility

- No new prefs and no data migration; the tray is created from state the renderer already had.
