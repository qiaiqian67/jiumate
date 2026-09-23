# 移除 use-guizang-ppt 插件

- **Date:** 2026-09-23
- **Type:** process
- **Scope:** `skills`, `docs`, `landing`, `tooling`

[English](2026-09-23-remove-guizang-ppt-plugin.md)

移除 `use-guizang-ppt` 插件及其全部引用。该插件以 AGPL-3.0 打包 [op7418/guizang-ppt-skill](https://github.com/op7418/guizang-ppt-skill)(歸藏),而这是本项目不予分发的协议;同样的演示文稿场景由 `use-bento-slides`(MIT)覆盖。

## 细节

- 删除 `plugins/use-guizang-ppt/`，并从 `@prismshadow/linsight-core`、`@prismshadow/linsight-cli` 和 `@prismshadow/linsight-desktop` 的依赖列表中移除 `@linsight/use-guizang-ppt`。
- 从 `plugins/README.md`、`README.md` / `README.zh.md`、`packages/docs/content/skills.{en,zh}.md` 的 `office-productivity` 分组，以及 Landing 页技能区（`packages/landing/src/lib/{strings,strings-en}.ts`）中移除该插件。
- 移除 `.prettierignore` 中两条仅为该插件内联资源而存在的条目。
- 从 `scripts/check-licenses.mjs` 的 `EXCEPTIONS` 中移除 `@linsight/use-guizang-ppt` 条目——它此前作为 AGPL 例外被记录在案。
- 移除该插件累积的四条 `unreleased/` changelog 条目——两条宣布上线、两条记录 Landing 页同步修复——因为它从未进入任何发布版本，否则同一份发布说明里会同时出现正反两半。
- `packages/docs/content/third-party.{en,zh}.md` 记录了这道闸门产出的第一条例外正是该插件，以及它已被移除。
