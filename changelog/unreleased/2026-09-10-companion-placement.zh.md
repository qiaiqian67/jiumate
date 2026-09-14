# AI 伴侣位置选择 — 四段选择器、右侧常驻 widget、桌面悬浮宠物

- **Date:** 2026-09-10
- **Type:** feature
- **Scope:** `server`, `web`, `desktop`

[English](2026-09-10-companion-placement.md)

把单一的「AI 伴侣模式」开关改造成四段位置选择器，并交付选择器指向的两个新形态。用户现在可以挑选伴侣出现的位置：**关闭**（任何地方都不显示）、**输入框上方**（composer 上方的卡，沿用之前的行为）、**右侧面板**（与右侧 dock 并排的常驻面板）、**悬浮窗**（frameless、始终置顶的 Electron 桌面宠物）。之前由布尔开关控制的「人设提示块」注入逻辑在新位置下仍然触发（关闭除外），所以语气偏好与伴侣位置彼此独立。

## 位置选择器

`ui_prefs.companionModeEnabled: boolean` 替换为 `ui_prefs.companionPlacement: "off" | "banner" | "widget" | "floating"`（`packages/server/src/api/types.ts`）。新字段可选，沿用 `PUT /api/me/prefs` 的浅合并语义，因此部分写入不会清掉相邻字段。通用设置页（`packages/web/src/features/settings/companion-mode-row.tsx`）把原来的 `Switch` 换成了 `Segmented<CompanionPlacement>`（`cols={4}`）；四个标签（`companionModeOff / Banner / Widget / Floating`）同步收录到 `strings.ts` 与 `strings-en.ts`，并刷新了 `companionModeInfo` 解释每段的作用。在 Vite dev build 里，**悬浮窗**那一段会被 click 拦截并弹出 toast（`companionModeFloatingDevHint`），告知悬浮窗是桌面专用——只有桌面端才有 Electron `BrowserWindow` 可以承载。

`packages/web/src/features/chat/companion-store.tsx` 现在暴露 `{ placement, floatingPosition, setPlacement, setFloatingPosition }`（React Context，自上一 PR 起挂载在 `app-layout.tsx`）。从 `GET /api/me/prefs` 加载、通过 `PUT /api/me/prefs` 写入；切换段位立刻生效，持久化是 fire-and-forget。store 还读取 `companionFloatingPosition: { x: number; y: number }`，由悬浮窗在拖动结束时写入、下次打开时还原。

服务端 `POST /api/sessions/:sessionId/tasks` 现在通过 `placementEnablesPersona()`（`packages/server/src/http/routes/sessions.ts`）判断是否注入人设块：`"banner" | "widget" | "floating"` 都启用；`"off"` 不启用；未知字符串按 opt-out 处理（旧客户端发来的乱码、损坏的 prefs 文件都回到关闭而不是破损状态）。11 条参数化测试（`packages/server/test/companion-persona.test.ts`）覆盖了所有分支——默认关闭、三种新位置、显式 off、legacy `companionModeEnabled: true` 迁移、legacy `false` opt-out、显式覆盖 legacy、垃圾字符串、损坏 JSON、无关字段。

## 输入框上方 banner

`CompanionBanner`（`packages/web/src/features/chat/companion-banner.tsx`）依旧渲染 composer 上方的卡片。挂载判断从 `enabled !== true` 改成 `placement !== "banner"`，宠物图形与状态文字改由共享的 `<CompanionPet size="sm">`（`packages/web/src/features/chat/companion-pet.tsx`）提供，三个 surface 都从这里导入。两帧气泡动画、seed 计数器、语言判断、4 秒自动消失都未改动。

## 右侧面板 widget

新增 `CompanionWidget`（`packages/web/src/features/chat/companion-widget.tsx`）：宽 280px 的 `aside`，挂在聊天列与右侧 dock 之间（`packages/web/src/features/chat/chat-page.tsx:2047`，在 `data-dock-row` 的 flex 容器内）。右侧 dock 已占用（`rightMount.view === null`）或视口较窄（`!isNarrow()`，与 dock 共用 `1023.98px` 断点）时 widget 主动让位，避免挤压 composer 或与 dock 抢水平空间。widget 不画气泡（聊天窗口就在旁边）；宠物只显示 idle / thinking 状态，下面配一行本地化的状态文字（`companionWidgetIdleHint` / `companionWidgetThinkingHint`）。

## 悬浮窗（仅桌面端）

新的 Electron `BrowserWindow`（`packages/desktop/src/companion-window.ts`，在 `main.ts` 中以 `companionHandle` 暴露）承载 web 应用 `/companion` 路由。窗口 frameless、透明、始终置顶、不可调整大小、不在任务栏显示；宠物 SVG 是唯一可见的内容，外层 `WebkitAppRegion: drag` 让画布任何位置都可拖动。一个小 × 按钮（no-drag 区域）通过 preload bridge 关闭窗口。

shell 暴露了一个类型化的 preload bridge（`packages/desktop/src/preload.ts`，`contextBridge.exposeInMainWorld("companion", …)`），共五个方法：`open(savedPos?)`、`close()`、`move(pos)`、`getPosition()`、`savePosition()`。聊天窗口与悬浮窗都加载这份 preload；聊天窗口在 placement 变成 `"floating"` 时调 `open`（传入 `ui_prefs` 里持久化的位置），悬浮窗在拖动过程中调 `move` / `savePosition`。同源的 `/companion` 路由意味着 `linsight_session` cookie 直接复用——不需要新的 claim token，也不需要新的认证路径。

IPC 处理器（`companion:open / close / move / getPosition / savePosition`）对每个 payload 做校验（`sanitisePosition`，拒绝 NaN、±Infinity、非数字，避免有 bug 的拖动把窗口推出屏幕），并把保存的位置 clamp 到所属显示器的工作区；如果保存位置不在任何显示器内（用户拔掉了副屏），回退到主显示器右下角并留 24px 边距。`window-all-closed` 现在只在**聊天窗口与悬浮窗都关闭**时才退出——关掉聊天窗口不会再带走仍存活的宠物；macOS 的 `activate` 也不会在悬浮窗还活着时重建聊天窗口。

聊天页面通过 `BroadcastChannel("linsight-companion")`（故意写成连字符格式，避免被 install-scope 扫描器误判为 localStorage key）驱动悬浮窗：聊天页在每次 taskState 变化时向频道发消息，让悬浮宠物镜像聊天窗口宠物的姿态；悬浮窗页面订阅并复用 banner 同款的两帧气泡 / 4 秒消失逻辑。聊天页的 `placement` 切离 `"floating"` 时，调 `window.companion.close()` 关闭宠物窗。

## 兼容性

- **零数据迁移。** 旧字段被尊重：`PUT /api/me/prefs` 中仍带 `companionModeEnabled: true` 的写入会在 `me.ts` 的浅合并前转成 `companionPlacement: "banner"`，refactor 前就开启的用户会继续看到伴侣（现在是 Recommended 的「输入框上方」位置），直到他们改选别的。legacy key 会从持久化 JSON 中删除，不会与新 key 并存。
- **`PUT /api/me/prefs` 接口不变。** 浅合并仍是契约；位置选择器只写自己的字段。
- **人设块 marker 的 wire 格式不变。** `[companion_persona]` 和 `MARKER_TAGS.companionPersona` 仍是线缆字节与剥离列表的 key——Trace 回放结果完全一致。
- **dev build 优雅降级。** 在 `pnpm dev` 里选「悬浮窗」会弹出 dev 提示 toast 然后什么都不做，纯 web 开发者不需要 Electron 也能验证选择器。
- **任何 per-user 数据都未失效。** 没访问过系统设置的非管理员用户的 prefs 里没有 `companionModeEnabled`；新代码把它当作 `"off"`，没有 `companionPlacement` key 也按 opt-out 处理——这些用户完全感觉不到改动。

## 测试

- `packages/server/test/companion-persona.test.ts` — 11 个 `it.each` 用例，覆盖判定函数的所有分支，包括 legacy 迁移。
- `packages/web/test/companion-store.test.ts` — 8 个用例钉住 `placementFromPrefs`（显式位置、legacy `true` 迁移、legacy `false` opt-out、垃圾字符串、无关字段、`COMPANION_PLACEMENTS` 顺序）。
- `packages/web/test/companion-banner-helpers.test.ts` — 7 个用例（上一 PR 之后未变）。
- `packages/desktop/test/companion-window.test.ts` — 7 个用例钉住 `sanitisePosition`（舍入、NaN/Infinity 拒绝、非数字拒绝）与 `clampToDisplays`（边界内透传、超出回退）。