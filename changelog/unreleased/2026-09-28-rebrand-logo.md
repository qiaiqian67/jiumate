# Product mark replaced with a vector brand asset

- **Date:** 2026-09-28
- **Type:** feature
- **Scope:** `web`, `landing`, `docs`, `desktop`

[中文版](2026-09-28-rebrand-logo.zh.md)

The product mark is replaced on all four surfaces that ship it. The new mark was supplied as inline SVG — four rounded rectangles, no raster: a `#151515` squircle with two white bars and a gold (`#FFD700`) one.

## The SVG is 2100× smaller and no longer needs a workaround

The previous mark embedded its artwork as a base64 PNG inside `<image xlink:href="data:image/png;base64,…">`, because an external `xlink:href` is silently dropped when an SVG is loaded through `<img>` or as a favicon — the icon drew a blank white square. That inlining was the only reason each `linsight-logo.svg` weighed ~793 KB.

The new mark is pure vector, so the workaround is unnecessary and the file is **380 bytes**. It also renders sharply at every size, which is what the `<link rel="icon" type="image/svg+xml">` in `web/index.html` and the two `docs`/`landing` favicons were already asking for.

## Files

- `packages/{web,landing,docs}/public/linsight-logo.svg` — byte-identical copies (verified by hash). Consumed by the `LinsightLogo` component, the favicon on all three surfaces, the notification icon, the OG share card (`landing/scripts/og-cover.html`), the landing nav/hero/footer/pillars, `HarnessLogo`, both READMEs, and the docs nav.
- `packages/{web,landing,docs}/public/linsight-logo.png` — 1024×1024 raster master, regenerated.
- `packages/desktop/build/icon.png` — 1024×1024 Windows master.
- `packages/desktop/build/icon-mac.png` — 1024×1024 with the 824 px artwork centred, so Finder/Launchpad/Dock give it native optical size.
- `packages/desktop/build/icons/{128,256,512}x{512}.png` — freedesktop set for the Linux targets.

## Appearance change on light surfaces

The old mark was a square on its own white background and relied on `className` for rounded-corner cropping; in light theme it blended into the page. The new mark carries its own dark `#151515` squircle, so it reads as an app tile in both themes and no longer blends. Intentional — flagging it because it is visible on the login page and the landing hero without any CSS change.

## Verification

Each raster was checked by sampling real pixels rather than by file size: rounded corners at `A=0`, background `RGB(21,21,21)`, both white bars `RGB(255,255,255)`, gold bar `RGB(255,215,0)` — at 1024, 512, 256, 128 and the inset macOS master. The running app's own origin was then rendered through headless Chrome and the same pixels confirmed, so the check covers the served asset, not just the file on disk.

Two environment notes for the next rebrand:

- `packages/desktop/scripts/render-icon.mjs` cannot run here — Playwright's browsers are not installed (`npx playwright install` needed). The rasterization was done through the installed Chrome (`--headless=new --default-background-color=00000000`, which preserves the transparent corners).
- Chrome on Windows enforces a minimum window size, so `--window-size=128,128` renders a larger viewport and screenshots only its top-left corner. The small sizes were produced by high-quality downscaling from the verified 1024 render instead.
- The Vite cache (`packages/web/node_modules/.vite`) was cleared after the swap, per the discipline the previous rebrand recorded.
