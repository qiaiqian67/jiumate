# 打包发布的名字改到 @jiumate 作用域下

- **Date:** 2026-10-23
- **Type:** refactor
- **Scope:** `core`, `server`, `web`, `cli`, `desktop`, `docs`, `landing`, `installer`, `plugins`

[English](2026-10-23-rename-npm-scope.md)

这十一个要发布的包，名字里带着那个已经不再拥有它们的名字。`@prismshadow/jiumate-core` 现在是 `@jadelau/core`，`@prismshadow/jiumate-server` 现在是 `@jadelau/server`，cli、web、desktop、docs、inspirations、installer、landing、pets、skins 同理。十九个插件包本来就在 `@jadelau/*` 下，所以现在两套包待在一个作用域里，而不是两个。

这次改名走遍每一个"写下"包名而不只是"提到"包名的地方：每个 `package.json` 的 `name` 字段、源码里每一处 `import` 与 `type` 说明符、`workspace:*` 的依赖边、CI 与发布工作流里的 `pnpm --filter` 选择器、先走 `plugins/*/` 再走 `core`、`server`、`cli` 的 npm 发布循环，以及安装脚本里那行一行安装建议。

作用域之外还有三样东西跟着一起动了，因为它们带着同一个名字：桌面应用的 `appId` 与 `appUserModelId` 现在是 `com.jiumate`，六个插件包的 `url` 字段指向本仓库而不是旧仓库，README 与 landing 博客里的引用署名与作者署名读作 JiuMate。

## 没有动的东西

`@prismshadow/agenthub` 是另一个已经发布的库——core 与 cli 依赖的模型网关，在另一个仓库里发布，registry 上已经是 0.4.15。改一个不归我们改的包名会直接弄坏安装，所以它保持原样。它是源码里剩下的唯一一个 `prismshadow`。

changelog 里提到这些名字的旧条目也保持原样。那些条目记录的是写下它们时的事实；改写它们会篡改历史。唯一的例外是本条及其对应条目。

## 关于发布的一点说明

`@jadelau/*` 这些名字在 registry 上是空闲的，这正是这次搬移成立的前提——但 Trusted Publisher 只能为一个已经存在于 registry 上的包配置，所以这十一个包每个都需要先 bootstrap 发布一次，发布工作流才能真正把它们发出去。`v0.4.0` 这个 tag 早于这次改名，所以它今天若跑起来，发的是旧名字；下一个 tag 带的是新名字。

## 兼容性

已发布的包名变了，所以 `npm install @prismshadow/jiumate-core` 不再解析，`@jadelau/core` 开始解析。旧名字从未发布过，因此没有任何装过它们的东西会坏——没有需要下架的版本，也没有需要标废弃的版本。仓库内部的 import 路径随包名一起改了，仓库之外没有源码受影响。
