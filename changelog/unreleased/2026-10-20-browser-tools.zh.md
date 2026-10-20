# 让智能体读页面并在页面上动作

- **Date:** 2026-10-20
- **Type:** feature
- **Scope:** `core`, `docs`

[English](2026-10-20-browser-tools.md)

两个内置工具 `browser_read` 与 `browser_act` 驱动 Agent 浏览器：桌面应用的内置浏览器，或用户自己的 Chrome，由用户选择。`browser_read` 报告后端与打开的标签页、打开 URL、关闭标签、把页面扫成简化 HTML 或纯文本，并在同一轮里把截图作为图像内容返回。`browser_act` 点击、输入，并在页面自身的源内运行 JavaScript。

## 读与写分成两个工具

- `browser_read` 是 `r`。它不替用户改变任何东西，因此以只读走审批流。
- `browser_act` 是 `rw`，所以一次点击、一行输入、一段脚本都要经过审批。点击能提交订单，脚本能读走 `document.cookie`。
- 合成一个工具、只带一个权限，就得让高频的读承担低频的写的分量。拆开之后，只想看一眼页面的模型完全不必经过审批，而点击仍然要问。

## 截图以图像本身回来

`browser_read` 的 `screenshot` 通过 `ToolResult.images` 返回，模型在请求它的那一轮就看到了页面。把截图写到磁盘再读回来，是同一张图，却要多花一次工具调用和一次往返。

## 后端由用户选，每次调用都说清是哪个

智能体驱动哪个浏览器是用户的设置，两个工具都不挑。每次调用都报告后端，因为一个以为自己读的是内置浏览器、实际读的是 Chrome 的模型，会从长得一模一样的页面上得出错误的结论。标签页与用户共享，用户可以看着、也可以随时接管。

## 宿主提供什么

这两个工具自身不持有状态，也不碰磁盘。它们调用宿主注入的 `BrowserPort`（`EnvironmentServices.browser`），而没有浏览器界面的宿主会如实说明，而不是抛一个 errno。后端之间的差异由 `BrowserBackendCapabilities` **声明**，而不是探测，所以工具像运行时一样据此分支，而接入第二个后端时这里不需要改动。

## 兼容性

- 内置工具集新增两条，因此推进了内核：`KERNEL_VERSION` 现为 `2026-10-20`，工具页此前的默认 hash 移入 `KERNEL_SUPERSEDED_TAB_HASHES`。`tools.builtin` 仍是上一版默认的 Agent 会推进到新版；被用户改过的则保留自己的行。
- 除此之外，既有 Agent 落盘的 `tools.builtin` 列表按原样冻结，与所有新增内置工具一样：本次变更之前创建的 Agent，需要手工把这两条加进它的 `system_config.yaml` 才会拿到它们。
- 没有数据迁移，既有行为不变。
