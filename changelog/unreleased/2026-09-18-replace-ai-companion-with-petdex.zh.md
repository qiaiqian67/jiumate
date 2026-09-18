# 用 Petdex 桌宠替换 AI 伴侣

- **Date:** 2026-09-18
- **Type:** refactor
- **Scope:** `core`, `server`, `web`, `desktop`
- **Breaking:** yes — OmniMessage 不再携带 `[companion_persona]` 块；`UiPrefs.companion*` 字段在 `PUT /api/me/prefs` 时静默丢弃。

[English](2026-09-18-replace-ai-companion-with-petdex.md)

AI 伴侣功能（SVG 狐狸 / Live2D / VRM、persona 注入、ASR 麦克风、TTS 反应气泡）已下线，由 Petdex 桌宠窗口取代。悬浮宠物改为 sprite 图集的 `BrowserWindow`，由会话活动驱动，配置入口合并到新的 Application 设置页。

## 上线内容

- **`@prismshadow/linsight-pets`** — 新工作区包。Arktype 校验的 `PetPackage` schema，manifest + sprite IO 严格限制（64 KiB / 32 MiB / 64 MiB / 128 个），SHA-256 指纹，`.linsight-pet-receipt.json` 收据往返，保证重装幂等。镜像 OpenBitFun `pet_packages.rs` 的字节级约定，使 Petdex 下载在两套宿主间互通。
- **`/api/pets`** — 服务器新增 REST 接口。`GET` 列出已安装宠物 + 诊断；`GET /api/pets/:slug/spritesheet` 下发已安装图集字节；`POST /api/pets/import` 接受 `{ path, expectedFingerprint? }` 并先校验后发布；`DELETE /api/pets/:slug` 移除已安装宠物。
- **`PUT /api/me/prefs`** — 接收新键 `enablePet` / `activePetId` / `petWindowPosition`；遗留 `companion*` 键静默丢弃。
- **`/pet` 路由 + 无边框宠物窗口** — 取代原 `/companion` 路由和 `companion-window.ts`。加载 `${appOrigin}/pet`，透明置顶，位置持久化，IPC 桥接 `window.pet`（含 `pickPackage` 目录导入）。
- **内置 Petdex 资源** — 将 OpenBitFun 的 13 套预设包放入 `packages/web/public/pets/`（`blue-golden`、`openbitfun-girl`、`deepseek-goldwhale` 等），设置页与悬浮窗渲染真实精灵表。
- **`Settings → Application → Desktop pet`** — 启用开关、完整预设 + 已导入网格、导入与删除。镜像 OpenBitFun `page === 'pet'` 块。
- **会话 → 宠物活动桥** — chat 页通过真正的 `BroadcastChannel` 推送当前 task-state mood（`rest / working / analyzing / compacting / idle`），悬浮宠物窗口跨窗口订阅。

## 下线内容

- `companion-persona` OmniMessage 标记和 `[companion_persona]` 块。移除 `MARKER_TAGS.companionPersona`、其构造器/解析器/谓词分支。
- 所有 `companion*` UI prefs（`companionPlacement`、`companionFloatingPosition`、`companionName`、`companionPronoun`、`companionProactiveTimeoutMs`、`companionTtsProvider/Voice`、`companionAsrProvider`、`companionAvatar{Renderer,Preset,VrmPreset}`）。
- Live2D 渲染器（`pixi.js`、`pixi-live2d-display`）、VRM 渲染器（`three`、`@pixiv/three-vrm`）、SVG 狐狸、ASR Web Speech hook、TTS Web Speech hook、主动触发器。
- 16 份 AI 伴侣功能的未发布 changelog 条目（`companion-mode / -placement / -banner / -asr / -expression-and-proactive / -tts / -live2d / -vrm`）。
- `packages/docs/content/draft-k-companion.{en,zh}.md` 及其在 `capability-matrix` 中的行。

## 迁移

- 之前存的 `companionPlacement: "floating"` 行：用户下次访问时宠物窗口仍会打开（同一 URI 上只是宠物替代伴侣）；banner/widget 位置会被静默丢弃。宠物本身无开关过渡——设置 `enablePet: false` 即可隐藏。
- 未来主版本可以在宠物之上重新加 persona 模式开关；除 OmniMessage 标记之外，本变更没有不可逆的内容。

## 兼容性

- 仅 OmniMessage 不再带 `[companion_persona]` 是协议级 breaking。更早的 Trace 即使带此块仍能解析——`stripLeadingMarkerBlocks` 不再识别该标签，因此遗留的 `[companion_persona]…[/companion_persona]` 块会在用户可见面原样显示。该标记从未发布（仅存在于 `unreleased/`），没有已上线 Trace 包含它。
- 适配 OpenBitFun `PetPackage` 格式的宠物包可直接导入。服务器端 `<data-root>/pets/<slug>/` 下的目录结构对未来的 v2-vN 版本向前兼容——宿主仅读取 `spriteVersionNumber` 来决定帧几何。