# 伴侣 VRM 渲染器

- **Date:** 2026-09-17
- **Type:** feature
- **Scope:** `server`, `web`

[English](2026-09-17-companion-vrm.md)

伴侣专属设置页现在与 2D、Live2D 并列暴露第三个头像渲染器：`vrm`。选中后会懒加载 three.js + `@pixiv/three-vrm`，并通过 `<CompanionPet>` 复用点（Live2D 渲染器已经在用的同一个挂载点）渲染带骨骼绑定的 VRM 模型。36 px 的 banner 因为尺寸限制（36 px 看不清脸）继续走 SVG；widget 和浮动窗口遵守用户的选择。

`companionAvatarRenderer` 闭合枚举在 server 和 web 两端从 `"svg" | "live2d"` 扩展为 `"svg" | "live2d" | "vrm"`。VRM 预设目录落在新的 `companionAvatarVrmPreset` 字段上，有自己的闭合列表 —— Live2D 与 VRM 目录 id 空间互不相干、各自演化，因为它们是不同文件格式、授权来源也不同。手写 PUT 不能塞垃圾 id 进任一槽位：server 端 validator 会拒绝未知 id。

## 改动点

新模块 `packages/web/src/features/chat/companion-vrm/` 完全对照 `companion-live2d/` 的结构：

- `manifest.ts` 在构建时通过 `import.meta.glob({ eager: true })` 读取 `public/avatars-vrm/` 下每个预设子目录里的 JSON sidecar；运行时不会 404 反复打，构建期一次走完。每个 sidecar 携带明确的 `license` 字符串。
- `use-vrm-model.ts` 探测 WebGL，实例化 three.js 的 `Scene`、相机和环境光，用 `GLTFLoader` + `@pixiv/three-vrm` 加载所选 `.vrm`，并在 unmount 时拆掉整个图。`onReady` 回调把加载好的模型交回 React 侧，让它可以在每个姿态变化时同步应用 expression。
- `CompanionVrm.tsx` 是 React 包装组件。它通过 `React.lazy(() => import("./CompanionVrm"))` 在 `<CompanionPet>` 内部懒加载，`<Suspense>` fallback 用 `<PetSvg>`，这样用户会先看到一帧现有 2D 狐狸，而不是空白方框。
- `pose-to-expression.ts` 把 L.1 起 SVG 和 Live2D 层一直在用的同一组七个 `CompanionPose` 值映射成 VRM expression 权重（`neutral`、`happy`、`blink`、`aa`、`sad`、`surprised`）。重复派发同一姿态是 no-op，所以运行时不会在每次 render 之间空转。
- `preset-preview.tsx` 是设置页选择缩略图 —— 沿用 Live2D 预览的 `IntersectionObserver` 懒挂载模式，每个缩略图瓦片在滚入视口前不付 three.js 的下载成本。

伴侣外壳现在的判断：

```ts
const useLive2D = avatarRenderer === "live2d" && size !== "sm" && resolvedLive2D !== null;
const useVrm    = avatarRenderer === "vrm"    && size !== "sm" && resolvedVrm   !== null;
```

两个渲染器共用一个 `on3dFallback` 回调 —— 当 WebGL 不可用或资产加载失败时把渲染器翻回 `"svg"`，现有 toast 每个 session 提示一次，下一次 render 切回 SVG 层。

设置页把 `CompanionAvatarRenderer` 从两段选择器扩展成三段（`2D / Live2D / VRM`），并加了平行的预设行，门控在 `avatarRenderer === "vrm"`。两行预设互不依赖：用户在 Live2D 和 VRM 之间切换渲染器时，保留最后一次选的 Live2D 或 VRM id，因为 Live2D 和 VRM 的 id 空间互不相干。

`packages/web/package.json` 把 `three` 和 `@pixiv/three-vrm` 加进 `dependencies`；`packages/web/vite.config.ts` 把这两个包加入 `optimizeDeps.include`，让 dev server 预打包 chunk 边界，跟 Live2D entry 预打包 pixi.js 一个原理。只用 SVG 的用户永远不会下载 three.js。

## 兼容性

`companionAvatarRenderer` 枚举扩展是线协议变化。旧客户端（或手编 prefs JSON）存的 `"vrm"` 在新 server 上继续可用：新闭合枚举把 `"vrm"` 视为合法值。反向也兼容 —— web 端 store 的 hydrate helper 仍然把任意未知 renderer 字符串塌缩成 `"svg"`，所以先于本客户端的 server 如果发了 `"vr2"` 也不会把当前伴侣搞坏。

`companionAvatarVrmPreset` 字段是新增的。prefs 里缺这字段时客户端 hydrate 到 `"vrm-sample-a"`（闭合列表的第一项）；其他伴侣 pref 写入都不需要这个字段。

打包的 VRM 模型是占位。`public/avatars-vrm/<id>/index.json` sidecar 这次进，但真正的 `.vrm` 文件没进 —— 后续资产 PR 会带明确 `license` 字符串落地。当前设置页对两个预设都渲染彩色圆形 fallback，跟 Live2D 在 Cubism SDK 示例数据落地前的样子一致。