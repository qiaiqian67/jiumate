# 新包需要的那一次手动发布，现在有脚本了

- **Date:** 2026-10-23
- **Type:** process
- **Scope:** `ci`, `tooling`

[English](2026-10-23-bootstrap-npm-publish.md)

发布工作流通过 OIDC trusted publishing 发到 npm，而 Trusted Publisher 只能为一个**已经存在于 registry 上**的包配置——npm 的设置页列出的是可以指向 workflow 的那些包，一个从未发布过的名字不在其中。所以一个新包的第一次发布不能由工作流来做，只能用一次性的 granular token 手工发，发完撤销。

这一步原先只写在发布工作流的一段注释里，别处没有，于是很容易做错三件事：顺序有讲究（依赖还没发布的包，谁都装不上）、用 `npm publish` 而不是 `pnpm publish` 会发出一个根本装不上的包、而版本标记会改到不该提交进仓库的文件。

`scripts/bootstrap-npm-publish.mjs` 就是这一步。它做的是工作流 `publish-npm` 作业做的同样的事——标记版本、构建每个包、把 LICENSE 与构建好的 web 资源拷进包目录——然后用 `pnpm publish` 按依赖顺序逐个发布：插件在前，然后 `agenthub`、`inspirations`、`pets`、`skins`，再 `core`、`server`、`cli`。registry 上已有的版本会被跳过，所以一次中断的运行可以从断处继续。

`scripts/bootstrap-npm-publish.sh` 是给 shell 用的包装。它在没有 token 时拒绝运行、在工作树不干净时拒绝运行，并在结束时撤销版本标记——标记是发布过程的产物，不是要提交的东西。

`--dry-run` 打印计划，什么都不发。

`docs/RELEASING.md` 把整件事写清楚了：一次发布是什么、bootstrap 这一步以及之后怎么配 Trusted Publisher、一次发布要成功必须先具备的四样东西、以及失败的发布怎么重试。

## 兼容性

没有运行时行为变化。这些脚本只由手工运行，且只影响 npm registry 和运行它时所在的工作树。
