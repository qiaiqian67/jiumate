# Quick invoke now reaches the composer

- **Date:** 2026-10-13
- **Type:** fix
- **Scope:** `web`

[中文版](2026-10-13-quick-invoke-reaches-composer.zh.md)

Clicking **快捷调用** on a skill card navigated to the new-chat page with
an empty composer. The skill was selected in the draft cache and then
overwritten about 300ms later, before the composer read anything back.

## The cause

`persistNow` rebuilt the whole `DraftCache` from component state:

```ts
const data: DraftCache = { text: textRef.current, workspace, approvalMode };
if (skillsRef.current.length > 0) data.skills = skillsRef.current;
```

It models part of the draft. The `skills` entry is written by the plugin
page **before** the chat page mounts, so at the first `persistNow()` the ref
behind it was still empty — and the mount-time write replaced a correct
value with nothing.

Both writers were individually correct. The bug was the race between them,
which is why every layer read as correct in isolation.

It now spreads the stored draft first, so fields this component does not
model survive. The keys assigned after it still win, so the fields it does
own are never stale.

## Found by driving the running app

Five fixes shipped first, each a real bug, each with passing tests, none of
them this one: a missing `agents` field on `PluginItem`, a draft cache read
before the user id arrived, `initialSkills` read only on mount, a prune
guard spent one tick too early.

Every one was found by reading source. The actual defect was visible in a
browser in one pass, by recording what the page writes:

```
[0] {"agentId":"default_agent","text":"","skills":["data-analysis"]}
[1] {"text":"","workspace":"","approvalMode":"allow-all"}
```

One test had been asserting that `persistNow` rebuild from state — encoding
the defect — and passed for two commits while the feature was visibly
broken.

`.agents/skills/jiumate-manual-test/SKILL.md` now records the API-token
route for driving the app without a password, the write-tracing technique,
and the rule that a UI bug report is settled by looking rather than by
theorising.