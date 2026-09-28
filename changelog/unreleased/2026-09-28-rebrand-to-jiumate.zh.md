# 品牌改名：Linsight → JiuMate

- **Date:** 2026-09-28
- **Type:** refactor
- **Scope:** `core`, `server`, `cli`, `web`, `desktop`, `docs`, `landing`, `skills`, `tooling`, `ci`
- **Breaking:** yes —— 每一个 npm 包名、CLI 二进制、数据根路径、环境变量前缀、cookie 名、安装链接与发布桶都会改变；沿用 `linsight*` 旧名的既有磁盘数据与安装脚本不再可解析。

[English](2026-09-28-rebrand-to-jiumate.md)

项目去掉 `linsight` / `Linsight` / `LINSIGHT` 品牌，改用 **JiuMate**（中文：**九川**）。这是本项目历史上第二次改名，遵循第一次改名（`changelog/0.3.0/2026-09-07-brand-rename-to-linsight.md`）立下的约定：大小写敏感的逐字面量扫描、按界面区分作用域、冻结的 changelog 目录不动、默认系统提示词变动时推进 kernel。

## 兼容性

本次构建一运行，既有安装即停止工作，因为所有外部标识都移动了：

- **包名。** `@prismshadow/linsight-{cli,core,desktop,docs,landing,server,web,inspirations,pets,skins}` → `@prismshadow/jiumate-{…}`；`@linsight/*` → `@jiumate/*`。任何仍列出旧名的 `package.json` 都会依赖解析失败。
- **CLI 二进制。** `linsight` / `linsight-hmr` → `jiumate` / `jiumate-hmr`。
- **数据根。** `~/.linsight/{data,dev-data,…}` → `~/.jiumate/{…}`。既有安装必须搬移，或用 `JIUMATE_HOME` 指过去。
- **环境变量。** `LINSIGHT_*` → `JIUMATE_*`，含 `LINSIGHT_HOME`、`LINSIGHT_API_TOKEN`、`LINSIGHT_PROJECT_ID`、`LINSIGHT_AGENT_ID`、`LINSIGHT_WEB_DIST`、`LINSIGHT_PREVIEW_ORIGIN`。
- **Cookie 名。** `linsight_session` → `jiumate_session`。旧构建下的登录浏览器会话全部失效。
- **安装链接与发布桶。** `linsight.ooo` → `jiumate.ooo`，`linsight-releases.oss-cn-beijing.aliyuncs.com` → `jiumate-releases.oss-cn-beijing.aliyuncs.com`。**这两个目前都还不存在**——见下。
- **默认系统提示词。** 内置 `DEFAULT_SYSTEM_PROMPT` 现在称该 Agent 为 `JiuMate`，因此 kernel 已推进：`KERNEL_VERSION` 为 `2026-09-28`，上一版 prompt tab 哈希与重新锚定的进程内重建哈希一并追加到 `KERNEL_SUPERSEDED_TAB_HASHES.prompt`，并在生成列表里记录本次移动。只有 prompt tab 移动；runtime、tools、skills、memory、vault、schedules 均未变。
- **冻结的 changelog 目录。** `changelog/{0.1.0…0.3.0}/` 保留旧品牌措辞，因为它们记录的是以那个名字发布的东西；其内容不被改写。

## 两件本次改名无法替你完成的事

都在仓库之外，而且都比扫描本身更重要：

1. **新名下的域名与 OSS 桶都还不存在。** `install.sh` / `install.ps1`、CLI 的更新源、桌面端的更新源现在都指向 `jiumate.ooo` 与 `jiumate-releases.oss-cn-beijing.aliyuncs.com`。在该域名注册、该桶建立之前（或把这些指向真实端点之前），全新安装与更新检查都会失败。如果名字还没定，回退只是在那四个文件里做一次替换。
2. **GitHub 仓库仍响应旧路径。** 所有徽章、克隆地址与文档链接现在都写 `github.com/qiaiqian67/jiumate`，在 GitHub 上重命名仓库之前它 404（重命名后旧路径会重定向，所以不会永久损坏）。

## 细节

- 扫描走的是**git 跟踪的文件集**，而不是目录树——这才是「这个仓库」的精确定义。这样无需猜测忽略规则就能排除构建产物、缓存与本地日志，而且这一点很关键：本仓库唯一一个名为 `build` 的目录（`packages/desktop/build`）是**被跟踪的源文件**（electron-builder 配置与 Linux 安装模板，11 处引用），按目录名跳过会静默漏掉它。
- 859 个文件的内容被改动，41 处路径被改名。路径改名覆盖 CLI 入口（`cli/src/{linsight,linsight-hmr}.ts`）、发布启动器（`scripts/launchers/`）、三个包里的 logo 资产（`linsight-logo.svg/png`）、`LinsightLogo` 组件文件、Agent 技能目录（`.agents/skills/linsight-*`、`plugins/agent-development/skills/linsight-*`），以及 22 篇 landing 博客文章。
- **事后手工修复了两处历史陈述**，因为逐字面量扫描会让一句「描述过去某次改名」的话断言出错误事实：`kernel-history.ts` 里 `048198c3…` 这个 prompt 哈希的冻结标签，写明那次改名改到的是 **Linsight**（确实如此）；`CHANGELOG.md` / `CHANGELOG.zh.md` 里 0.3.0 那一行同样回归 **Linsight** 作为那个版本引进的名字。changelog 索引的其余部分保持当前品牌——这是第一次改名立下的约定。
- **中文名用在「产品自我命名」之处**：`strings.ts` 的 `appName`（登录页标题、应用页头、文档标题）与 `README.zh.md` 的标题是 `九川`；英文界面是 `JiuMate`。中文行文里的品牌提及保留拉丁写法，与既有约定一致。
- 清除一次 `node_modules` 后删除并重新生成 `pnpm-lock.yaml`，以丢掉残留的 `@linsight+*` pnpm store 条目。
- **陈旧的构建产物也必须清掉，否则构建会失败。** `packages/*/dist` 里仍是改名之前生成的 `.d.ts`，而 `pnpm typecheck` 是拿 core **已产出的声明**去校验 server 的——于是它为源码里已不存在的标识符报出 `LinsightContext` / `LinsightInterface` 错误。删除全部 `dist`（以及 `.tsbuildinfo`）并重建即解决。上次改名记录里「清一次 node_modules」是同一个道理；在包之间通过 `exports` 互相解析之后，dist 也该进那份清单。
- 数字里编码了品牌长度的测试夹具已重算。`messaging-telegram.test.ts` 以 UTF-16 码元钉住 Telegram 实体偏移：`@linsight_test_bot` 是 18 个码元，`@jiumate_test_bot` 是 17，于是五处 mention 长度各减 1，一处第二 mention 偏移 34 → 33、另一处 23 → 22，两处覆盖显示名的 `text_mention` 长度 14 → 13、22 → 21。docs 搜索测试的合并区间 `end` 由 8 → 7。
- 验证：`pnpm build`、`pnpm format:check`、`pnpm typecheck`、`pnpm lint` 全清；`pnpm test` 全绿——docs 53/53、landing 71/71、skins 113/113、inspirations 43/43、pets 21/21、cli 434、desktop 219、core 1149、web 1920、server 1831（53 跳过）。随后手工重启已停止的 dev 栈，确认改名后的服务端能启动、解析 `~/.jiumate/dev-data`、服务既有 Session，并确认 Vite 开发服务器返回的标记里是 `<title>JiuMate</title>` 与 `jiumate-logo`。core 有一条测试（`exec_command` 的 Ctrl-C 中断）在全量并行运行时抖动了一次，单独复跑 3/3 通过——是 Windows 信号时序抖动，与本次改名无关。
