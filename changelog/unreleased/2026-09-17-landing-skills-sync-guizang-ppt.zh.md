# Landing 技能区登记 guizang-ppt-skill

- **Date:** 2026-09-17
- **Type:** fix
- **Scope:** `packages/landing`
- **PR:** [#4](https://github.com/qiaiqian67/linsight/pull/4)

[English](2026-09-17-landing-skills-sync-guizang-ppt.md)

`packages/landing/test/skills-sync.test.ts` 从 `plugins/*/skills/**/SKILL.md` 派生期望的技能集合，并断言每个已发布的技能都登记在 `strings.ts`（中文）和 `strings-en.ts`（英文）里。9 月 14 日上线的 `use-guizang-ppt` 插件带出了 `plugins/use-guizang-ppt/skills/guizang-ppt-skill/`，但 Landing 页的技能区没有登记这条新 chip。

这次遗漏导致 `test (rest)` 与 `test-windows (rest)` 失败（与 `test-macos (rest)` 一起级联到聚合 gate `ci`）。原 commit 已经更新过另外三处同步点：`plugins/README.md`、根 `README.md` / `README.zh.md` 和 `packages/docs/content/skills.{en,zh}.md`，它们都已经包含 `guizang-ppt-skill`。

## 改动点

`packages/landing/src/lib/strings.ts` 和 `packages/landing/src/lib/strings-en.ts` 都在 Office Productivity / 办公效率 这一组的 `skills` 数组末尾追加 `"guizang-ppt-skill"`。Landing 页的 Skills 区块会直接渲染这条 chip，没有其他 UI 改动。

登记位置与 `use-guizang-ppt` 自身 `category: "office-productivity"` 的 manifest 一致，与 `bento-slides`（来自 `use-bento-slides`）和 `firecrawl`（来自 `use-firecrawl`）的归属保持一致。