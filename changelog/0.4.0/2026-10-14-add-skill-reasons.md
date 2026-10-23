# "No skills were added" now says why

- **Date:** 2026-10-14
- **Type:** fix
- **Scope:** `web`

[中文版](2026-10-14-add-skill-reasons.zh.md)

Adding a skill from a URL failed with a sentence containing no information
at all, while the server had already computed the answer.

The client sends that message only when the server answered **201 with an
empty `added`**. So the archive parsed — a parse failure is a 404, and the
server log shows `201 19099ms` — and every individual write threw. The server
records a `reason` for each of those in `result.failed`, and the client used
them for the partial-success branch right below, then dropped them for the
total-failure branch.

The one branch that explains why nothing is on disk now was the one that said
nothing.

It now reports them: `没有添加任何技能：<name>（<reason>）`, falling back to the
old sentence only when the server really did send no reason, so the message
can never render with nothing after the colon.

## The underlying cause is not identified

Reproduced against the real route through `/archive`, which runs the same
parse-then-write path as `/url`. Both archive shapes tried —
`<skill>/SKILL.md` and `<repo>-main/.agents/skills/<name>/SKILL.md` — return
201 with a populated `added`, as do the directory route and the existing 48
tests. So the archive shape is not it, and neither is the write path.

I did not go further, because guessing at a filesystem failure from a two-line
symptom is how the wrong fix gets shipped.

This change is a prerequisite for finding it: the reason is now on screen, so
the next attempt names itself.

web 2083 green; typecheck and lint clean.