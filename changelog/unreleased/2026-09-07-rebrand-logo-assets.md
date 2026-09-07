# Rebrand logo assets (web, landing, docs, desktop)

- **Date:** 2026-09-07
- **Type:** feature
- **Scope:** `web`, `landing`, `docs`, `desktop`

[中文版](2026-09-07-rebrand-logo-assets.zh.md)

The product logo is replaced across the four surfaces that ship it. The new mark was supplied as `F:\下载\AI-logo.png` (1024×1024 PNG, 608 KB) and `F:\下载\AI-logo.svg` (927 KB wrapping PNG); each surface picks the right format:

- `packages/{web,landing,docs}/public/linsight-logo.svg` is the canonical SVG used by the `<img>` LinsightLogo component, the favicon, the OG share card, and every README / blog / doc reference. Replaced.
- `packages/{web,landing,docs}/public/linsight-logo.png` is the raster master for places that need a 32×32 raster directly. Replaced.
- `packages/desktop/build/icon.png` (1024×1024, electron-builder source), `build/icon-mac.png` (1024×1024 with 824 px artwork centred for the macOS safe area), and `build/icons/{128,256,512}x{512}.png` are regenerated from the SVG via the existing `packages/desktop/scripts/render-icon.mjs`.

## Why the SVG is self-contained

The previous logo SVG referenced an external PNG via `<image xlink:href="linsight-logo.png"/>`. When the SVG is loaded through `<img>` (the LinsightLogo component) or used as a favicon, browsers sandbox it and silently drop the external image reference — the SVG drew a blank white square. Inlining the PNG as a base64 data URI inside `<image xlink:href="data:image/png;base64,...">` makes the SVG self-contained and renders correctly in every context. Side effect: each `linsight-logo.svg` is now ~811 KB. If a smaller favicon is wanted, swap the PNG inside the SVG for a vectorized version or add a `<link rel="icon" type="image/png" sizes="32x32" href="/linsight-logo.png">` fallback so browsers fetch the smaller raster for tiny sizes.

## Verification

- Vite cache cleared after the swap (`packages/web/node_modules/.vite`) per `scripts/dev-prebuild.mjs` discipline.
- Headless Chromium screenshot against `http://[::1]:7365/login` confirms the new mark renders in `<LinsightLogo>`.
- Desktop icon rasterization verified: center pixel opaque `RGB(233,235,247)` α=255, corners transparent (rounded-corner baked in), ~28.5% opaque pixels.