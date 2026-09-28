# 产品标识替换为矢量品牌资产

- **Date:** 2026-09-28
- **Type:** feature
- **Scope:** `web`, `landing`, `docs`, `desktop`

[English](2026-09-28-rebrand-logo.md)

四个承载产品标识的界面全部替换。新标识以内联 SVG 提供 —— 四个圆角矩形，没有位图：一个 `#151515` 的圆角方块，两条白条和一条金条（`#FFD700`）。

## SVG 缩小约 2100 倍，且不再需要那个绕法

旧标识把图形以 base64 PNG 内联在 `<image xlink:href="data:image/png;base64,…">` 里，因为当 SVG 通过 `<img>` 或作为 favicon 加载时，外部 `xlink:href` 会被浏览器静默丢弃 —— 图标会画成一个空白的白色方块。那次内联正是每个 `linsight-logo.svg` 有约 793 KB 的唯一原因。

新标识是纯矢量，因此这个绕法不再需要，文件只有 **380 字节**。它在任何尺寸下都清晰，而这正是 `web/index.html` 和 `docs`/`landing` 两处 favicon 里 `<link rel="icon" type="image/svg+xml">` 本来就想达到的。

## 文件

- `packages/{web,landing,docs}/public/linsight-logo.svg` —— 三份字节一致（已用哈希核对）。使用方包括 `LinsightLogo` 组件、三个界面的 favicon、通知图标、OG 分享卡（`landing/scripts/og-cover.html`）、landing 的导航/首屏/页脚/支柱、`HarnessLogo`、两个 README，以及 docs 导航。
- `packages/{web,landing,docs}/public/linsight-logo.png` —— 1024×1024 栅格母版，已重新生成。
- `packages/desktop/build/icon.png` —— 1024×1024 Windows 母版。
- `packages/desktop/build/icon-mac.png` —— 1024×1024，824 px 图形居中，使 Finder/Launchpad/Dock 中的视觉尺寸与原生图标一致。
- `packages/desktop/build/icons/{128,256,512}x{512}.png` —— Linux 目标用的 freedesktop 图标集。

## 浅色界面的外观变化

旧标识是自带白色背景的方块，靠 `className` 做圆角裁切；在浅色主题下它会融进页面背景。新标识自带 `#151515` 深色圆角方块，因此在两种主题下都读作一枚应用磁贴，不再融入背景。这是有意为之 —— 在此标注是因为它在登录页和 landing 首屏上无需任何 CSS 改动就能看出来。

## 验证

每一张栅格图都以**采样真实像素**核对，而不是看文件大小：圆角处 `A=0`、背景 `RGB(21,21,21)`、两条白条 `RGB(255,255,255)`、金条 `RGB(255,215,0)` —— 在 1024、512、256、128 以及内缩的 macOS 母版上逐一确认。随后又把**运行中应用自身地址**渲染到无头 Chrome 并复验同样的像素，所以验证覆盖的是服务器实际吐出的资源，而不只是磁盘上的文件。

给下一次换标的两个环境提示：

- `packages/desktop/scripts/render-icon.mjs` 在本机跑不起来 —— Playwright 的浏览器未安装（需要 `npx playwright install`）。栅格化改用已安装的 Chrome 完成（`--headless=new --default-background-color=00000000`，可保留透明的圆角）。
- Windows 上的 Chrome 有最小窗口尺寸，所以 `--window-size=128,128` 实际会按更大视口渲染、只截左上角。小尺寸改为从已验证的 1024 图高质量降采样得到。
- 替换后清除了 Vite 缓存（`packages/web/node_modules/.vite`），遵循上一次换标记录的做法。
