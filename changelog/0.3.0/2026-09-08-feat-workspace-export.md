# Workspace file multi-format export (PDF / DOCX / EPUB / RTF / TXT)

- **Date:** 2026-09-08
- **Type:** feature
- **Scope:** `web`, `server`, `desktop`, `ci`

[中文版](2026-09-08-feat-workspace-export.zh.md)

The Files panel's preview toolbar gained an **Export** dropdown for `.md` and `.html` files. Seven formats — Markdown, HTML, PDF, DOCX, EPUB, RTF, TXT — ship in v1; PNG and JPG are deferred. The dropdown disables a format whose backing service is missing rather than failing on click, and the disabled item's tooltip names the reason (Pandoc not installed, or "PDF export requires the desktop app" when running under `linsight server`).

## Client-side formats

- **Markdown** is the raw source bytes — no network round trip, no serialization. The download attribute rewrites the extension but never the content.
- **HTML** is a self-contained document rendered from the same unified pipeline the Files panel uses for preview, with Mermaid fences pre-resolved to inline SVG and a minimal KaTeX CSS link. Triggered through the existing `<a download>` Blob path; the server is not in this path.

## Server-side formats

- **DOCX / EPUB / RTF / TXT** flow through Pandoc. The web serializes the Markdown to HTML on the client, POSTs `{ path, format, html }` to a new `POST /api/sessions/:id/files/export`, and the server shells out to `pandoc -f html -t <format> --output -`. A missing Pandoc binary turns the four menu items disabled with a `Pandoc is not installed.` tooltip; `GET /api/version/capabilities` is the truth source.
- **PDF** uses the desktop shell's hidden BrowserWindow + `webContents.printToPDF` (A4, ½″ margins, backgrounds). The page still serializes the Markdown to HTML on the client; the server hands the HTML to the shell over the utilityProcess message port the updater already uses, and the shell posts the resulting bytes back. CLI / `linsight web` mode answers 503 `pdf_unavailable_in_cli`; the capability flag is what keeps the menu item honest.

## Wire shapes

- `DesktopExportRequest` / `DesktopExportResult` live in `packages/server/src/api/desktop-export.ts`. The shell imports the same types through a new granular subpath (`@prismshadow/linsight-server/desktop-export`) so it does not pull the full api barrel.
- The export route uses the existing `resolveSession` auth — same member-or-owner gate that protects every other file route.

## Desktop shell

- `packages/desktop/src/export-pdf.ts`: hidden-window renderer; the data-URL → tmp-file split (1.5MB) lives here so big Markdown reports do not crash Chromium's data-URI parser.
- `packages/desktop/src/pandoc-path.ts`: pure resolver; lookup order `LINSIGHT_PANDOC` → `resourcesPath/pandoc/pandoc[.exe]` → `appPath/dist/bin/pandoc/pandoc[.exe]` → `PATH`. A bundled binary in dev mode is staged by `scripts/build-assets.mjs`.
- `main.ts`: `wireExportPdfRelay` registers the export inbox on the same port the updater uses — both filter by `type` discriminator before acting, no preload bridge.

## Packaging

- `electron-builder.yml` ships Pandoc under `extraResources` for win / mac / linux, with `${arch}` substitution on macOS to cover both arm64 and x64.
- `scripts/download-pandoc.mjs` is the one-shot downloader CI runs per platform (PANDOC_VERSION env-overridable). The script writes to `build/pandoc/<platform>/pandoc[.exe]`, the path `electron-builder.yml`'s `from:` points at; the staging dirs carry `.gitkeep` so local non-CI builds do not trip the missing-source check.
- `.github/workflows/desktop-build.yml` gained a "Bundle Pandoc" step that picks the right platform from `RUNNER_OS` / `RUNNER_ARCH`.

## Capabilities endpoint

- `GET /api/version/capabilities` returns `{ pandoc: { available, version }, pdf: { available, reason } }`. The web reads it once on first open of the Export menu (not on mount — a session that never opens the dropdown pays no call) and folds failure into a fail-soft "everything disabled" answer so MD/HTML still work.

## i18n

- Nine new `S.files.*` keys (`export`, `exportMd`, `exportHtml`, `exportPdf`, `exportDocx`, `exportEpub`, `exportRtf`, `exportTxt`, `exportPreparing`, `exportUnavailableReason`) in both `strings.ts` (zh) and `strings-en.ts` (en). The parity guard in `packages/web/test/workspace-export.test.ts` keeps the two in lockstep.

## Tests

- `packages/web/test/markdown-html.test.ts`: serialization contract — self-contained document, Mermaid fences pre-rendered, GFM tables / task lists / strikethrough all present, erroring Mermaid falls back to a `<pre>` rather than throwing.
- `packages/web/test/post-binary.test.ts`: the new `postBinary` helper — Blob on 2xx, server's error code/message on non-2xx, http_error + localized message on non-JSON error bodies, network failure mapped to `network_error`.
- `packages/web/test/workspace-export.test.ts`: capability flags → disabled states, MD short-circuit (no serialization, no network), HTML / DOCX / PDF dispatch through the right client APIs, i18n propagation.
- `packages/web/test/workspace-browser-export.test.ts`: structural lock — the ExportMenu lives in the toolbar, gates on `preview.kind ∈ {"md","html"}`, binds the four expected props, and the menu module exports `ExportMenu` as a callable component.
- `packages/desktop/test/pandoc-path.test.ts`: lookup order is locked; an LINSIGHT_PANDOC override beats packaged resources; a missing override falls through; dev staging is invisible to a non-packaged run.
- `packages/desktop/test/export-pdf.test.ts`: wire-shape parser + data-URL-vs-tmp-file decision.
- `packages/desktop/test/download-pandoc.test.ts`: the platform map matches a real Pandoc release; the version is env-overridable; the staging dir matches `electron-builder.yml`.
- `packages/desktop/test/installer-pandoc.test.ts`: each platform's `extraResources` mapping is locked; both files reference the same platform set.

## Manual smoke

- `pnpm dev` with a real Pandoc on PATH: open an Agent report, click Export → PDF, watch the browser download `report.pdf`. Open in a reader, confirm Mermaid renders to SVG, KaTeX formulas stand, tables / task lists / code-block backgrounds hold. Repeat for DOCX in Word / Pages.
- `pnpm dev` with Pandoc uninstalled: open the same report, confirm DOCX/EPUB/RTF/TXT are disabled with the tooltip; PDF stays enabled in desktop mode, MD/HTML stay enabled always.