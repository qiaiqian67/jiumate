# Give the skill card the plugin card's controls, and add the mount route that was missing

- **Date:** 2026-10-12
- **Type:** fix, feature
- **Scope:** `core`, `server`, `web`

[中文版](2026-10-12-skill-card-parity.zh.md)

The skill card had grown its own set of controls, separate from the plugin
card's. This makes them one set.

## The dropdowns are gone

The corner of a skill card held an origin badge, a category select and a
switch. Two problems, neither of them about styling.

**None of them is an action.** The badge states a fact. Filing a skill into
a category is what the category chips above and 管理分类 are for — the page
already has one filing system, and a dropdown on the card is a second door
into the same room.

**Two text-bearing controls in a row of glyphs make that row its own
system.** The plugin card is five 28px borderless glyphs and a switch. The
skill card was two dropdowns. The eye reads two pages, not two views of one.

A skill card now carries the same five controls, in the same glyphs, in the
same order: 升级 / 快捷调用 / 管理安装 / 启用禁用 / 删除.

Origin and category moved to the meta line, where the version already is —
they are information about the skill, not controls.

## Quick invoke, manage installs and delete actually do something

Those three buttons **did nothing** when pressed. Last change drew the
machine switch and the upgrade and listed the rest without implementing
them. They are implemented now.

**快捷调用** goes through the page's existing draft mechanism, and is
available only when the Agent in question actually has the skill — the
same rule the plugin card follows.

**管理安装** needed a route that did not exist: `POST /skills/:name`, which
mounts a Skill from the machine store onto one Agent. Only the unmount
existed.

Mounting and unmounting are **Agent-scoped**, and distinct from deleting
(the machine scope): unmounting removes that Agent's directory and leaves
the machine copy, so re-mounting is one click and the Skill is not lost.
Conflating the three is how a user loses a Skill they meant to keep.

**删除** removes it from the machine store and leaves every Agent's copy.

## One set of glyphs

Four icon paths lived in two files and now share `card-icons.ts`. **Reuse
where reuse exists** — the bin is still `session-row-menu.tsx`'s, because
redrawing a near-identical path for the sake of "consistency" is precisely
the divergence the module exists to remove, and in a row of glyphs you can
see the difference.

## A real bug, found on the way

`readMachineSkillFiles` walked only the current level and never descended
into subdirectories, so a Skill's auxiliary files under `reference/API.md`
were never read.

In other words: **any Skill with a file in a subdirectory lost those files
when mounted**, producing a Skill that cannot reach its own documentation.

The bug was three commits old and untested the whole time. The test I wrote
last change — "the payload is visible in the machine store" — asserted on
the layer `replaceSkillDirectory` wrote, not on the one the reader returns.
Both paths existed; only the write path was covered.

The recursion should have been there from the start.