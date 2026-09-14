# 伴侣 — 立体头像（Live2D 渲染层）

- **Date:** 2026-09-12
- **Type:** feature
- **Scope:** `server`, `web`

[English version](2026-09-12-companion-live2d.md)

伴侣的 2D SVG 狐狸现在可以换成伪 3D 的 Live2D 模型。姿势状态机——SVG 层自 L.1 起就用的同一套七个名字（`idle / thinking / listening / speaking / celebrating / confused / sleepy`）——在同一个 `<CompanionPet>` 切换点后面驱动 Cubism 模型的动画组和参数覆盖。从未打开新设置项的用户看不到任何行为变化；默认渲染器仍是 SVG，默认模型是 Hiyori。

## 发布内容

伴侣专属设置页（`packages/web/src/features/settings/companion-section.tsx`）在 ASR 行下面新增两行：

- **立体头像**（`companionAvatarRendererLabel`）：`Segmented<CompanionAvatarRenderer>` 两段选择器，覆盖 `2D / Live2D`。`Info` 气泡说明 WebGL 要求和静默回退到 SVG 的行为。
- **模型**（`companionAvatarPresetLabel`）：一排横向 `<PresetPreview>` 缩略图，仅在渲染器为 `Live2D` 时显示。每个缩略图 48 px，展示本地化的显示名；选中的那个带橙色边框。

内置三个模型在封闭列表里：Hiyori、Mark、Mao，全部来自官方 Cubism SDK 示例数据，按 Live2D Cubism SDK Sample Data License 分发。manifest 目录（`packages/web/src/features/chat/companion-live2d/manifest.ts`）在构建时通过 `import.meta.glob` 扫描 `public/avatars/<id>/index.json`；运行时按需懒加载 `.moc3` / 贴图 / 动作，浏览器把它们当作不可变的静态资源缓存。封闭列表在服务端和 web 端保持一致——服务端拒绝未知 preset id，web 端的 hydration helper 对未知字符串回退到 `hiyori`，用户绝不会看到损坏的 picker。

## 姿势状态机保持不变

七姿势的 `CompanionPose` 枚举（已由 `companion-pet.test.ts` 锁定）通过 `packages/web/src/features/chat/companion-live2d/pose-to-motion.ts` 驱动 Live2D 层。每个姿势映射到一个 Cubism 动画组加参数覆盖（`ParamEyeLOpen`、`ParamMouthOpenY`、`ParamAngleZ` 等），与 SVG `POSE_GEOMETRY` 表对齐，所以两个渲染器在视觉上一致——`thinking` 闭眼并低头 -3°，`celebrating` 眯眼微笑，`confused` 低头 -8°。helper 通过 `poseToMotionForTest` 导出，单测可以在不启动 pixi.js 的情况下锁定每一对映射。Idle 动画播放模型自带的循环；同一个 helper 服务设置 picker 的 `<PresetPreview>`，让用户在 48 px 看到的动画与 96 px 的真宠物播放的动画一致。

## WebGL 自动回退

运行时永远不会展示损坏的画布。三种失败模式汇入同一个 `<CompanionLive2D onFallback>` 回调，把 store 渲染器翻回 `"svg"` 并显示一次 toast：

1. **WebGL 不可用**——宿主浏览器无法创建 WebGL 上下文（公司 kiosk、加锁的 Electron build、老 Android WebView）。`use-live2d-model.ts` 先探测 `canvas.getContext("webgl2")`，再 `webgl`；两者都缺失则报 `no-webgl`。
2. **资产缺失**——用户在资产尚未灌入前打开了 Live2D。`.moc3` 返回 404；`Live2DModel.from(url)` reject；hook 报 `load-failed`。
3. **Live2D 模型 JSON 解析错误**——损坏或不完整的资产。也归到 `load-failed`。

`prefers-reduced-motion: reduce` 通过 `motionManager.stopAll()` 生效，而不是关闭渲染器——宠物仍然渲染当前姿势，只是不播放动画。

## 服务端校验

`UiPrefs` 增加两个可选字段（`packages/server/src/api/types.ts`）：

```ts
companionAvatarRenderer?: CompanionAvatarRenderer;  // "svg" | "live2d"
companionAvatarPreset?: CompanionAvatarPreset;      // "hiyori" | "mark" | "mao"
```

写时由 `packages/server/src/services/companion-prefs.ts` 校验。渲染器是封闭枚举（拒绝未知字符串）；preset 是封闭列表（拒绝未知 id）。被拒绝的写入不存储任何东西并返回 400——路由层契约与现有的 `validateCompanionAsrProvider` 一致。两个字段刻意保持独立：用户可以先切到 `"live2d"` 再选 preset（hydration helper 默认 preset 为 `hiyori`），服务端不要求二者一起发送。

## 兼容性

- **无数据迁移。** 两个新字段都是可选的。旧 prefs 文件以 `renderer = "svg"` + `preset = "hiyori"` hydrate——与 L.6 之前的默认以及新用户的默认值相同。
- **Live2D 是 opt-in 的。** 从未打开新设置项的用户看不到任何行为变化，零 bundle 成本（lazy import 边界把 `pixi.js` 排除在用户主 chunk 外），所有 surface 都保持现有的 2D 狐狸。
- **size 门控混合。** 36 px banner（`size === "sm"`）即使在用户选 `Live2D` 时也走 SVG——Cubism 模型脸缩小到 36 px 是一片模糊，相对于清晰的 SVG 是诚实的降级。widget（`md`，64 px）和悬浮窗（`lg`，96 px）尊重选择。这是文档化的诚实权衡；未来若模型渲染在 36 px 有改进，可以重新评估「响应式模型切换」。
- **资产归属。** 每个 preset 的 `index.json` 记录 `license: "Live2D Cubism SDK Sample Data License"`。未来的设置 → 关于页面或 `THIRD-PARTY-NOTICES.md` 登记表不需要并行索引就能读到。
- **三个 surface 同步切换。** 三个 surface（`companion-banner`、`companion-widget`、`companion-page`）都读同一个 `useCompanionStore()`，所以翻转渲染器会在同一个 render tick 更新 banner / widget / 悬浮窗。
- **WebGL 回退是静默的。** 用户显式选了 Live2D，绝不会看到空画布——运行时在翻 store 的同一个 tick 退到 SVG 并显示一次 toast。

## 资产灌入状态

运行时提供完整的管道（manifest、registry、渲染器、回退路径、测试）。Hiyori / Mark / Mao `.moc3` 文件本身不在本仓库——它们是官方 Cubism SDK 示例数据，按 Live2D Cubism SDK Sample Data License 分发，需要单独下载后放到 `packages/web/public/avatars/<id>/` 下。在资产灌入之前，每个 preset 都渲染橙色圆形占位，运行时触发 WebGL 回退路径；用户在资产灌入之前选了 Live2D，会看到一次 toast 然后伴侣保持 SVG。

## Tests

- `packages/server/test/companion-prefs.test.ts` — 两个 `describe` 块新增 14 个用例：每个渲染器 id 通过 `PUT /api/me/prefs` 往返，每个 preset id 往返，未知渲染器 / preset 字符串被 400 拒绝，失败的合并不会覆盖预先写入的不相关字段（与 L.4 / L.5 块保持一致）。
- `packages/web/test/companion-store.test.ts` — 新增 8 个用例，锁定 `companionAvatarFromPrefs`（缺失时回默认值、echo 合法值、对未知渲染器 / 未知 preset 回退、渲染器和 preset 独立 hydrate），以及 `COMPANION_AVATAR_RENDERERS`（`svg` 优先，是安全默认）和 `COMPANION_AVATAR_PRESETS`（`hiyori / mark / mao`，规范显示顺序）的封闭列表顺序。
- `packages/web/test/companion-live2d/pose-to-motion.test.ts` — 8 个用例锁定七姿势 → Cubism 动画映射：每个姿势返回非空的动画名，7 个动画名互不相同，每个条目都有有限数值的参数 record，抽查验证 `speaking` 驱动 `ParamMouthOpenY`，`thinking` / `confused` 驱动 `ParamAngleZ` 并使用与 SVG 对齐的倾斜值。
- `packages/web/test/companion-live2d/manifest.test.ts` — 4 个用例锁定目录结构：3 个 preset id 按 `COMPANION_AVATAR_PRESETS` 顺序排列，每个 preset 同时具备 `zh` 和 `en` 显示名，每个 `moc3Url` 落在 `/avatars/<id>/*.moc3` 下，每个 preset 记录 Live2D license 字符串。