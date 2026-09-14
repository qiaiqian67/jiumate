# AI 伴侣模式 — composer 上方可见 Banner

- **Date:** 2026-09-10
- **Type:** feature
- **Scope:** `web`

[English](2026-09-10-companion-banner.md)

今日早些时候加的伴侣模式开关现在有了可见的形态：在 composer 上方多出一张轻量卡片，从同一个 `useCompanionStore` 读取开关状态。卡片里是一只内联 SVG 狐狸加一行状态文字；每次一轮对话结束，气泡会从宠物下方弹出、4 秒后淡出。开关默认关闭，未开启的用户看到的 DOM 完全不变。

## Banner 卡片

`packages/web/src/features/chat/companion-banner.tsx` 渲染一张橙色调的圆角卡片，挂载在 `chat-page.tsx` 的 `<ChatInput>` 之上（goal-status banner 之下，保留进行中 goal 的优先级）。卡片有三种状态，从 Session 流里读：

- **idle** — `taskState === "idle"`：宠物眼睛睁开、尾巴轻轻摇晃，文字显示 "🐾 我在这里陪着你"。
- **running** — 任何非 idle 的 `taskState`：眼睛闭成短杠，文字变成 "在想…"。
- **just done** — 每次 running → idle 切换都会在宠物下方弹出一个气泡反应（每语种 5 个候选短句，按轮次计数器确定性选取）。气泡挂载时是 `opacity-0 / -translate-y-1`，`requestAnimationFrame` 在下一帧切到可见态触发 `transition-all` 入场；4 秒后自动消失。

Banner 从新加的 context (`CompanionProvider`，定义在 `features/chat/companion-store.tsx`) 读取开关状态，Provider 挂在 `<AppLayout>` 根节点。设置弹窗里的 Switch 与 Banner 共享同一 store，因此切换开关会在下一次 render 时立即更新 Banner，无需刷新页面。`enabled === null`（prefs 还在加载）时 Banner 不会挂载，未水合的用户不会看到自己没要求的伴侣。

## 动画

尾巴摇摆和气泡的入场淡出由 `styles.css` 新增的纯 CSS 关键帧（`companion-tail-sway`）实现，`transform-box: fill-box` 让旋转支点跟随尾巴自身边界框。两个动画只动 `transform` 与 `opacity`，全局 `prefers-reduced-motion` 块直接禁用，无需额外的 JS media query — 减弱动效时宠物站定不动而非消失。

## 兼容性

零数据迁移。新 Banner 只读取早先那条伴侣模式条目写下的 `ui_prefs.companionModeEnabled`；唯一新增的接线是挂在 layout 根部的 `CompanionProvider`。卡片嵌在既有 composer 容器的 padding 之内，banner 自身挂载时下方布局才会上移（未开启的用户看不到任何变化）。无新依赖：宠物是内联 `<path>` / `<circle>` / `<rect>` + Tailwind 类，无需资源管线。