# Ignore per-package Claude session state

- **Date**: 2026-09-07
- **Type**: process
- **Scope**: repo
- **PR**: —
- **Issue**: —
- **Breaking**: no

When the Linsight dev workflow runs in this repo, Claude Code (or a similar agent) writes per-session observation logs under `packages/<name>/.claude/auto-handoff-obs-<session-id>.jsonl`. These files are machine-local — they identify one session and contain auto-generated transcripts — and were showing up as untracked after every agent run, risking accidental commits if a contributor typed `git add .`.

This change adds a single rule to `.gitignore`:

```
# Per-package Claude Code session state (auto-handoff observation logs).
# These are emitted by a session and are not shareable across machines.
packages/*/.claude/
```

The rule:

- Matches any directory named `.claude` directly under a package (depth 2).
- Ignores both the directory and its contents (the trailing `/` makes it directory-only, but git's ignore semantics ignore the contents too).
- Does **not** affect the root-level `.claude` text pointer at `E:\MyProjects\linsight\.claude`, which is a one-line file containing `.agents` and is intentionally committed so Claude Code sessions and other agents resolve to the same `.agents/skills/` directory.
- Does **not** affect `.agents/settings.local.json` or `.agents/**/*.local.*`, which were already ignored separately.

## Verification

```
$ git check-ignore -v packages/desktop/.claude/auto-handoff-obs-1c751abd.jsonl
.gitignore:34:packages/*/.claude/    packages/desktop/.claude/auto-handoff-obs-1c751abd.jsonl
```

`git status` no longer lists the per-package `.claude/` directories as untracked.