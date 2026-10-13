# The agents list becomes a browsable grid

- **Date:** 2026-10-13
- **Type:** feature
- **Scope:** `web`

[中文版](2026-10-13-agents-grid.zh.md)

The agents page listed every Agent as one full-width horizontal band — a
name and id, a description, seven counts, a sparkline and four buttons in a
row. Every one of those rows was as wide as the page, so the page read as a
spreadsheet and an Agent was hard to pick out of it.

It is now a three-column grid, one column on a phone, with a rotating
featured strip and a category row above it.

## The grid

Cards are vertical: avatar, name, version, id, description, counts,
actions. `auto-rows-fr` keeps the cards in a row level without measuring
anything — the row takes the tallest card and the rest stretch to match, so
one long description no longer leaves its neighbours with ragged bottoms.

The sparkline is gone. At card width it had nowhere to sit without either
shrinking the text beside it or overflowing the column, and a chart small
enough to fit says less than the session count it was drawn from.

## Search and categories

A search box in the title row filters by display name, id **and**
description. The id because an Agent is referenced by it in configs and
commands; the description because it is where two similarly-named Agents
actually differ.

The category chips are **derived from the Agents themselves** — the prefixes
of ids that are namespaced (`team:writer` → `team`). `AgentSummary` has no
category field, so a hardcoded chip list would be a second source of truth
that drifts from the data it filters, and chips for categories nobody has an
Agent in are a dead end. They scroll horizontally rather than wrapping: a
wrap would push the grid down by a line that changes height as the list
changes.

Search and chips narrow the grid **only**. The featured strip keeps drawing
from the whole Project — it is a sampler of what exists, and a panel
advertising Agents the page is currently hiding is worse than no panel.

"No matching agents" is now distinct from "no agents": the first means the
filter excludes them, the second that the Project has none.

## The featured strip

One Agent at a time, rotating every six seconds, with arrows to move it
manually. The arrows appear only when there is more than one — a pair of
controls that cannot move is a dead affordance.

## Nothing was lost

Every control the row had is on the card: new chat, settings, usage, delete,
and the stat counts still deep-link to their settings tabs. Built-in Agents
still refuse to offer delete. The kernel-update pill moved to its own line
under the title, because at card width there is no room for it beside the
name and shrinking the name would cost more.

## A typo that a test could not have caught

The grid's class went out as `lg:grid-cols3` — no hyphen. Tailwind has no
such class, so it was silently dropped: the rule did nothing, and **the class
was still in the DOM the whole time**. An assertion on the class string would
have passed.

It surfaced only because the browser was asked to resolve
`gridTemplateColumns`, which came back with two tracks where three were
asked for. The test now asserts the whole class string *and* negates the
typo, and the verification reads the computed value.

web 2073 green.

---

The row was rebuilt, not restyled, so a control could have fallen off a card
without failing anything. The new test names each one.