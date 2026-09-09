# 替换产品 logo 资源(web、landing、docs、desktop)

- **Date:** 2026-09-07
- **Type:** feature
- **Scope:** `web`, `landing`, `docs`, `desktop`

[English](2026-09-07-rebrand-logo-assets.md)

四个承载 logo 的界面统一替换为新版本。新版素材由用户提供:`F:\下载\AI-logo.png`(1024×1024 PNG,608 KB)与 `F:\下载\AI-logo.svg`(927 KB,包了 PNG);每个界面按需选取合适格式:

- `packages/{web,landing,docs}/public/linsight-logo.svg` —— 被 `<img>` 引用的 LinsightLogo 组件、favicon、OG 分享卡、各处 README / blog / 文档都用到,是权威矢量版本。已替换。
- `packages/{web,landing,docs}/public/linsight-logo.png` —— 需要 32×32 位图的场景的栅格母版。已替换。
- `packages/desktop/build/icon.png`(1024×1024,electron-builder 源)、`build/icon-mac.png`(1024×1024,824 px 居中以匹配 macOS 安全区)、`build/icons/{128,256,512}x{512}.png` —— 用现有的 `packages/desktop/scripts/render-icon.mjs` 从 SVG 重新栅格化。

## 为什么要自包含的 SVG

旧版 SVG 通过 `<image xlink:href="linsight-logo.png"/>` 引用外部 PNG。当 SVG 通过 `<img>` 标签(LinsightLogo 组件)或 favicon 加载时,浏览器会把它放进沙箱并静默丢弃对外部 image 的引用 —— 渲染出来是一个空白的白色方块。把 PNG 以 base64 data URI 内联进 SVG(`<image xlink:href="data:image/png;base64,...">`),SVG 就完全自包含,在所有上下文里都能正确渲染。副作用是每个 `linsight-logo.svg` 现在 ~811 KB。如果想要更小的 favicon,可以把 SVG 里的 PNG 换成矢量化的版本,或者加 `<link rel="icon" type="image/png" sizes="32x32" href="/linsight-logo.png">` 让浏览器在小尺寸下取更小的栅格。

## 验证

- 替换后按 `scripts/dev-prebuild.mjs` 的纪律清掉 Vite 缓存(`packages/web/node_modules/.vite`)。
- 用 headless Chromium 截 `http://[::1]:7365/login` 验证 `<LinsightLogo>` 渲染出新版本。
- 桌面端 icon 栅格化校验:中心像素不透明 `RGB(233,235,247)` α=255,四角透明(圆角已烘进 PNG),不透明像素占比 ~28.5%。