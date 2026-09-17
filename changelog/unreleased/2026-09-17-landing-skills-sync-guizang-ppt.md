# Landing skills section registers guizang-ppt-skill

- **Date:** 2026-09-17
- **Type:** fix
- **Scope:** `packages/landing`
- **PR:** [#4](https://github.com/qiaiqian67/linsight/pull/4)

[中文版](2026-09-17-landing-skills-sync-guizang-ppt.zh.md)

`packages/landing/test/skills-sync.test.ts` derives its expected skill set from disk under `plugins/*/skills/**/SKILL.md` and asserts that every shipped skill is named in both `strings.ts` (zh) and `strings-en.ts` (en). The `use-guizang-ppt` plugin shipped on 2026-09-14 added `plugins/use-guizang-ppt/skills/guizang-ppt-skill/`, but the landing page's skills section did not register the new chip.

The omission broke `test (rest)` and `test-windows (rest)` (which together with `test-macos (rest)` cascade to the `ci` aggregator). The other three sync surfaces updated by the original commit — `plugins/README.md`, the root `README.md` / `README.zh.md`, and `packages/docs/content/skills.{en,zh}.md` — already list `guizang-ppt-skill`.

## What changes

`packages/landing/src/lib/strings.ts` and `packages/landing/src/lib/strings-en.ts` both append `"guizang-ppt-skill"` to the `Office Productivity` / `办公效率` group's `skills` array. The chip renders in the existing landing page `Skills` section with no other UI change.

The chip placement mirrors `use-guizang-ppt`'s `category: "office-productivity"` manifest, matching how `bento-slides` (from `use-bento-slides`) and `firecrawl` (from `use-firecrawl`) already live in the same group.