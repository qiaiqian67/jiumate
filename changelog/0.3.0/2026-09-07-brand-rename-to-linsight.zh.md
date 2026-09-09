# 品牌更名：PenguinHarness → Linsight（灵悉）

- **Date:** 2026-09-07
- **Type:** refactor
- **Scope:** `core`, `server`, `cli`, `web`, `desktop`, `docs`, `landing`, `skills`, `tooling`, `ci`
- **Breaking:** yes — 所有 npm 包名、CLI 二进制、数据根路径、环境变量前缀、Cookie 名、HTTP 路由全部变更；任何指向 `penguin*` 名称的旧磁盘数据与安装脚本均不再可解析。

[English](2026-09-07-brand-rename-to-linsight.md)

项目脱去 `penguin` / `Penguin` / `PENGUIN` 品牌，正式以 `Linsight`（中文：灵悉）为名发布。旧品牌的字面量在工作区被逐一清扫：七个 npm 包归入 `@prismshadow/linsight-{cli,core,desktop,docs,landing,server,web}`，十二个插件包迁入新作用域 `@linsight/*`，两个 CLI 二进制改为 `linsight` / `linsight-hmr`，默认数据根迁至 `~/.linsight/data`，Cookie 改为 `linsight_session`，环境变量前缀统一为 `LINSIGHT_*`，所有指向旧 GitHub 仓库的 URL、所有公开的 type / class / 日志行 / 错误信息 / UI 字符串 / README / 博客文章 / 文档页 / Skill 正文全部随之更新；三个已冻结的 changelog 文件夹按计划刻意保留旧品牌字样。

## 兼容性

新构建一旦运行，现有安装即失效，因为所有外部标识符都已迁移：

- **包名。** `@prismshadow/penguin-{cli,core,desktop,docs,landing,server,web}` → `@prismshadow/linsight-{...}`；`@penguinharness/*` → `@linsight/*`。任何 `package.json` 仍引用旧名将无法解析依赖。
- **CLI 二进制。** `penguin` / `penguin-hmr` → `linsight` / `linsight-hmr`。PATH 与启动器中旧名称的入口不再可用。
- **数据根。** `~/.penguin/{data,dev-data,dev-data-cli,…}` → `~/.linsight/{...}`。旧安装必须迁移（或通过 `LINSIGHT_HOME` 指向旧路径）才能被新服务识别。
- **环境变量。** `PENGUIN_HOME`、`PENGUIN_API_TOKEN`、`PENGUIN_SEED_ADMIN_PASSWORD`、`PENGUIN_PROJECT_ID`、`PENGUIN_AGENT_ID`、`PENGUIN_SESSION_ID`、`PENGUIN_LANG`、`PENGUIN_WEB_DIST`、`PENGUIN_API_PROXY`、`PENGUIN_API_URL`、`PENGUIN_ADMIN_PASSWORD`、`PENGUIN_SHELL`、`PENGUIN_E2E` → `LINSIGHT_*`。
- **Cookie 名。** `penguin_session` → `linsight_session`。旧构建的浏览器会话全部失效。
- **默认系统提示词。** 内置 `DEFAULT_SYSTEM_PROMPT` 模板中的智能体名称改为 `Linsight`，因此按哈希命中旧 prompt tab 的 `system_config.yaml` 在下次内核更新时迁移为新文案。内核版本号为 `2026-09-07`，旧 prompt tab 哈希已记入 `KERNEL_SUPERSEDED_TAB_HASHES.prompt`，一次性迁移仍可解析。
- **已冻结的 changelog 文件夹。** `changelog/{0.1.0..0.2.9}/` 保留旧品牌字样，因为其记录的是该名称下发布过的内容；正文不做改写。

## 细节

- 改写脚本通过 `ripgrep`（大小写不敏感）遍历工作区，按节作用域施加 `penguin` → `linsight`、`Penguin` → `Linsight`、`PENGUIN` → `LINSIGHT`、`penguin-harness` / `PenguinHarness` → `linsight` / `Linsight`、`penguinharness` → `linsight` 的字面替换；中文副本中的品牌引用统一替换为「灵悉」。
- 插件目录 `plugins/agent-development/skills/{penguin-config,penguin-orchestration,penguin-sdk}` 已重命名为 `linsight-*`，所有 `SKILL.md` 的 frontmatter `name:` 字段同步更新。
- 删除 `pnpm-lock.yaml` 后重新生成；清空过一次 `node_modules/` 以丢弃残留的 `@penguinharness+*` pnpm store 条目。
- Agent 配置内核前进一个世代：`KERNEL_VERSION = "2026-09-07"`，`KERNEL_DEFAULT_TAB_HASHES.prompt` 按改名后的 prompt 重新计算，旧哈希 append 到 `KERNEL_SUPERSEDED_TAB_HASHES.prompt`，记录上方的世代注释新增一行。
- 测试 fixture 调整因改名导致的字符数变化：`messaging-telegram.test.ts` 中 8 处 `length: 17` 的 mention entity 改为 `length: 18`，同文件中第二个 entity 的 offset 整体右移 1 位以对准新 handle；两处覆盖 display name `Linsight Test` 的 `text_mention` entity 由 `12 → 14`、`21 → 22`，覆盖改名多出的那 1 个字符。
- 验证矩阵：`pnpm install` + `pnpm build` 干净通过；`pnpm format:check`、`pnpm typecheck`、`pnpm lint` 干净；core `model-catalog` 37/37、`kernel-version` 19/19，landing 71/71，docs 53/53，plugins 15/15，web 1623/1623，server 113 passed / 3 skipped / 5 files failed——5 个失败文件全部为 Windows 平台 `EPERM: symlink` 限制，与本次更名无关，是既有平台性问题。
