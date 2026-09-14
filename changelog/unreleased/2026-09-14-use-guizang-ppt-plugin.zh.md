# use-guizang-ppt 插件上线 Magazine Web PPT 幻灯片

- **Date:** 2026-09-14
- **Type:** feature
- **Scope:** `plugins`

[English](2026-09-14-use-guizang-ppt-plugin.md)

把 [op7418/guizang-ppt-skill](https://github.com/op7418/guizang-ppt-skill)(歸藏)作为可选的 `office-productivity` 插件加入内置库。**默认不预装**(`preinstall: false`),用户在需要演示型幻灯片时从插件库手动安装。

## 包含内容

插件携带 `SKILL.md`、`references/`(10 篇参考文档,覆盖 Style A 与 Style B 的布局、主题、组件、配图提示、演讲者模式、截图裁切与生产清单)、`scripts/`(三个验证脚本)和 `assets/`(`template.html`、`template-swiss.html`、`motion.min.js`、showcase PNG 和九张 CleanShot 风格的 `.webp` 背景),均从上游打包时按原样引入。上游 `LICENSE`(AGPL-3.0)按 AGPL 要求放在插件根。

## 落点约定

- Skill 的 frontmatter 只保留 `name` 和 `description`,与所有其他内置 skill 的 slim 库形态一致;`plugin.json` 是元数据唯一载体。
- `description`、`description_zh`、`short_description`、`short_description_zh` 全部使用真实字符,不写 `\uXXXX` 转义。
- 所有 vendored 文本文件从 CRLF 规范化为 LF,与仓库其他提交文本一致。
- Skill 正文顶部加了 `## Before you start` 一节,沿用所有其他 skill 的约定——用户消息只提到 skill 名时先问清楚再生成,同时重申上游的规则:支持方/赞助方清单不得出现在任何生成的 PPT、HTML 封面或配图里。
- 插件以 `@linsight/use-guizang-ppt` 登记进 `@prismshadow/linsight-core`、`@prismshadow/linsight-cli` 和 `@prismshadow/linsight-desktop` 的依赖列表,让插件加载器(`pluginRoots()`)在每个宿主里都能找到。
- `plugins/README.md`、根 `README.md` / `README.zh.md`、加载器测试(`packages/core/test/plugins.test.ts`)与文档同步测试(`packages/docs/test/skills-sync.test.ts`)都在它们的固定位置登记了新插件;docs sync 测试从磁盘派生插件集合,所以未来再加插件时不写文档就过不了这道关。
- `assets/` 下的 HTML 模板、压缩后的运行时 JS 和预构建的验证脚本通过 `.prettierignore` 跳过 prettier——它们是上游内容,不是仓库源。

## 许可证

AGPL-3.0,从上游继承。`package.json` 的 `license` 字段写 AGPL,插件根的 `LICENSE` 是上游原文件。

## 来源

- 仓库:<https://github.com/op7418/guizang-ppt-skill>
- 维护者:歸藏(op7418)
- 升级路径:重新拉取上游 `main`,把 `SKILL.md`、`references/`、`scripts/` 和 `assets/` 覆盖到 `skills/guizang-ppt-skill/`,统一换行符,把 `plugin.json` 的 `version` bump 到下一个 `YYYY-MM-DD.N`。
