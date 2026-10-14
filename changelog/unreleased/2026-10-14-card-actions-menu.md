# Fold the library card's five buttons into one ellipsis menu

- **Date:** 2026-10-14
- **Type:** change
- **Scope:** `web`

[中文版](2026-10-14-card-actions-menu.zh.md)

The hover actions on the plugin and skill cards are now one ellipsis that
opens a menu. **Where they live changed; what they do did not.** Same five
commands, same handlers, same enable/disable conditions, same order.

Five icon buttons laid over the name were a control strip rather than an
affordance: on a 3-up grid the group cost the name a third of its own width,
and five glyphs side by side carry no hierarchy — they read as five unrelated
commands rather than one row of things you can do to this card.

## Reused rather than rebuilt

`Dropdown` in portal mode (the panel escapes the grid's own overflow — an
in-flow absolutely-positioned panel is clipped by any ancestor with a
non-visible overflow on one axis), `ELLIPSIS_ICON` in filled mode, the
overflow menu row classes, `usePortalPanel`'s dismissal and focus handling.
The sidebar's session rows already established all of it.

## Three decisions worth recording

**The update dot rides both.** On the trigger, because a card whose update is
waiting should say so without being opened — that is the one thing the dot
exists for. And on the menu row, because the row that performs the update
should carry it too. The row-level dot is `UPDATE_DOT_INLINE`, not
`UpdateDot`: that one is absolutely positioned for hanging on a control's
corner, and a menu row is not a `relative` anchor, so it would have
positioned against the Dropdown root and floated off the row it belongs to.

**The switch stayed a `Switch`, in the panel's foot.** In a list of commands
the power mark was the only one whose state lives in the glyph rather than in
its shape — filled vs. outline is a difference nobody reads at a glance — and
it is a persistent state rather than a command, which is what the separator
says.

**Unavailable commands stay listed and muted.** A plugin with no recorded
source, a bundled skill that cannot be removed: hiding those leaves "why can't
I upgrade this" unanswered, so the row shows disabled with the reason in its
tooltip.

## A test that counted on a syntax

`skill-controls-are-wired.test.ts` matched `onClick={() => …}` to prove the
five controls were wired to real handlers. Menu items take `onClick: () => …`,
so after the move it found one handler and reported five controls with none —
the exact failure it exists to catch, arrived at from a refactor that changed
no behaviour. It now counts both syntaxes.

## The switch's label drops the subject

The knob in the panel's foot reads 「启用」 or 「禁用」, with no plugin or
skill name beside it. The panel is opened from the card whose name is already
on screen, so repeating it says nothing the user cannot see.

**Not dropped from the accessible name, though.** Every card carries this
switch, so a screen reader reading only 「启用」 announces the same control
fifteen times with nothing to tell them apart — `aria-label` composes
`{label} {subject}`, and the title tooltip does too.

## Not verified

Keyboard focus does not enter the panel on open (`activeElement` stays on the
trigger; the panel is focusable when asked directly). `Dropdown` is supposed
to move focus to the first item — its `panelItems()` selector finds them, so
the mechanism is not obviously the cause. Whether this is pre-existing in
`Dropdown` or something this change exposed **was not established**: the
comparison probe against the sidebar's long-standing `Dropdown` caller came
back inconclusive, reporting the panel closed for both. Named here rather than
claimed as either a regression or a non-issue. Escape-to-close and
focus-return-to-trigger were verified working.

web 2101 green; typecheck and lint clean.