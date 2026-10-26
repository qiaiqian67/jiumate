# 模型网关被搬进仓库

- **Date:** 2026-10-23
- **Type:** refactor
- **Scope:** `core`, `cli`, `ci`

[English](2026-10-23-vendor-agenthub.md)

源码里剩下的最后一个名字是 `@prismshadow/agenthub`——core 与 cli 依赖的模型网关。它住在另一个仓库里（`Prism-Shadow/model-message-stream-protocol`），在 npm 上发布在一个本项目已经不再拥有的作用域下，而本项目对它只有 pull 权限，所以这个依赖没法在原地改名。

现在它被搬了进来：`packages/agenthub/` 装着 AgentHub 0.4.15，逐字取自上游仓库的 `v0.4.15` tag，以 `@jiumate/agenthub` 的名字从本仓库发布。`src/` 下的 TypeScript 源码未作改动。在这里对它做的改动只限于它自己的元数据与文档——包名、`repository` / `bugs` / `homepage` 字段、`author` 字段、去掉仅供开发的依赖，以及 tracer 与 playground 页面里两处指向上游旧名的链接。Apache-2.0 许可证全文放在代码旁边，`THIRD-PARTY-NOTICES.md` 记下了代码的来处，也记明上游仍是把修复送去的地方。

因为这个包现在成了 workspace 成员，core 与 cli 以 `workspace:*` 依赖它，并从 `@jiumate/agenthub` 导入。发布工作流把它排在 core 之前发布，理由与插件包排在前面一样：`workspace:*` 依赖在发布时会被改写成具体版本，而 registry 上不存在的版本是装不上的。

## 这次搬移暴露出来的一件事

插件加载器过去靠 npm 名字判断什么算插件：凡是 `@jiumate/` 下的依赖都被当成插件。这在作用域里只有插件的时候成立，而当一个库加入作用域时它就不成立了——`@jiumate/agenthub` 被当作插件加载，把整个插件库拖垮了。现在插件靠它的 `plugin.json` 清单来辨认，那才是真正区分插件的东西；作用域不再决定这件事。

## 这要付出什么

上游的修复不再能靠升一个依赖版本拿到。要拿到，得从 `Prism-Shadow/model-message-stream-protocol` 取那个改动再应用到这里——这意味着本包的版本号与那个项目的版本号不再互相对应。上游项目仍在 npm 上以 `@prismshadow/agenthub` 发布，独立维护；两者现在可以分叉。

## 兼容性

导入路径从 `@prismshadow/agenthub` 变成了 `@jiumate/agenthub`，这个包从 npm 依赖变成了 workspace 成员。仓库内部的代码随之改过。仓库之外没有直接导入这个网关的代码——它一直是 core 模型层的实现细节——但已发布的 `@jiumate/core` 包现在把它打包进去而不是依赖它，所以装 core 的使用者会一并拿到这个网关，不需要额外的依赖。
