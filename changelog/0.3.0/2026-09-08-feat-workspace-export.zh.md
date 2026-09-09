# 工作区文件多格式导出（PDF / DOCX / EPUB / RTF / TXT）

- **Date:** 2026-09-08
- **Type:** feature
- **Scope:** `web`, `server`, `desktop`, `ci`

[English](2026-09-08-feat-workspace-export.md)

文件面板的预览工具栏新增 **Export** 下拉菜单，支持 `.md` 与 `.html` 文件。v1 共发布 7 种格式：Markdown、HTML、PDF、DOCX、EPUB、RTF、TXT；PNG、JPG 暂缓。菜单在底层服务缺失时直接置灰菜单项而不是点击后才报错，置灰项的 tooltip 写明原因（Pandoc 未安装，或在 `linsight server` 模式下提示"PDF 导出需要桌面应用"）。

## 客户端格式

- **Markdown** 直接下发原始字节——无网络往返、无序列化。`download` 属性只重写扩展名，不动内容。
- **HTML** 由文件预览同一条 unified 流水线产出自包含 HTML 文档：Mermaid 围栏已预解析为内联 SVG，外链最小化的 KaTeX CSS。走既有 `<a download>` Blob 通道，不经过服务端。

## 服务端格式

- **DOCX / EPUB / RTF / TXT** 走 Pandoc：Web 在客户端把 Markdown 序列化为 HTML，向新增的 `POST /api/sessions/:id/files/export` 提交 `{ path, format, html }`，服务端 `pandoc -f html -t <format> --output -` 派生子进程。Pandoc 二进制缺失时这四项菜单置灰并显示 `Pandoc is not installed.` tooltip；`GET /api/version/capabilities` 是唯一可信信号。
- **PDF** 走桌面 shell 的隐藏 BrowserWindow + `webContents.printToPDF`（A4、½″  margins、保留背景色）。客户端仍然先序列化为 HTML，服务端通过 updater 已经在用的 utilityProcess 消息端口把 HTML 转发给 shell，shell 再把生成的字节回传。CLI / `linsight web` 模式返回 503 `pdf_unavailable_in_cli`，由 capability 标志决定菜单项的可用性。

## 协议格式

- `DesktopExportRequest` / `DesktopExportResult` 定义在 `packages/server/src/api/desktop-export.ts`。Shell 通过新增的细粒度子路径（`@prismshadow/linsight-server/desktop-export`）导入同一份类型，不会拉整个 api barrel。
- 导出路由复用既有 `resolveSession` 鉴权——与其他所有文件路由使用同一道成员/所有者闸门。

## Desktop shell

- `packages/desktop/src/export-pdf.ts`：隐藏窗口渲染器；data URL 与临时文件的分流（1.5MB 阈值）写在这里，避免大文档撞 Chromium data-URI 解析器的上限。
- `packages/desktop/src/pandoc-path.ts`：纯函数式路径解析；查找顺序 `LINSIGHT_PANDOC` → `resourcesPath/pandoc/pandoc[.exe]` → `appPath/dist/bin/pandoc/pandoc[.exe]` → `PATH`。dev 模式下由 `scripts/build-assets.mjs` 把二进制放到 dev staging 目录。
- `main.ts`：`wireExportPdfRelay` 在 updater 用的同一条端口上注册导出收件箱，两边都按 `type` 判别符过滤后再处理，无 preload bridge。

## 打包

- `electron-builder.yml` 在 win / mac / linux 的 `extraResources` 下都加上 Pandoc；macOS 端用 `${arch}` 变量覆盖 arm64 与 x64。
- `scripts/download-pandoc.mjs` 是 CI 按平台调用的一次性下载脚本（版本可通过 `PANDOC_VERSION` 环境变量覆盖）。脚本写到 `build/pandoc/<platform>/pandoc[.exe]`，正好对应 `electron-builder.yml` 的 `from:`；staging 目录带 `.gitkeep`，本地非 CI 构建不会因为目录缺失而失败。
- `.github/workflows/desktop-build.yml` 增加 "Bundle Pandoc" 步骤，根据 `RUNNER_OS` / `RUNNER_ARCH` 选择正确平台。

## Capabilities 端点

- `GET /api/version/capabilities` 返回 `{ pandoc: { available, version }, pdf: { available, reason } }`。Web 在首次打开 Export 菜单时才读取（不在挂载时读取——从不打开菜单的会话零调用），读取失败时降级为"全部置灰"，保证 MD / HTML 仍可用。

## i18n

- 新增 9 个 `S.files.*` 键（`export`、`exportMd`、`exportHtml`、`exportPdf`、`exportDocx`、`exportEpub`、`exportRtf`、`exportTxt`、`exportPreparing`、`exportUnavailableReason`），`strings.ts`（zh）与 `strings-en.ts`（en）同步更新。`packages/web/test/workspace-export.test.ts` 中的 parity 校验保证两边严格对齐。

## 测试

- `packages/web/test/markdown-html.test.ts`：序列化契约——自包含文档、Mermaid 围栏预渲染、GFM 表格 / 任务列表 / 删除线齐备、错误的 Mermaid 降级为 `<pre>` 而非抛错。
- `packages/web/test/post-binary.test.ts`：新增 `postBinary` helper——2xx 返回 Blob、非 2xx 携带服务端 code/message、非 JSON 错误体回退 `http_error` + 本地化文案、网络失败映射为 `network_error`。
- `packages/web/test/workspace-export.test.ts`：capability 标志 → 置灰状态、MD 直通（无序列化、无网络）、HTML / DOCX / PDF 走正确的客户端 API、i18n 联动。
- `packages/web/test/workspace-browser-export.test.ts`：结构锁定——ExportMenu 位于工具栏，按 `preview.kind ∈ {"md","html"}` 守门，绑定四个预期 props；模块导出可调用 `ExportMenu`。
- `packages/desktop/test/pandoc-path.test.ts`：锁定查找顺序；`LINSIGHT_PANDOC` 覆盖胜过 packaged resources；覆盖文件缺失则往下走；dev staging 对非打包构建不可见。
- `packages/desktop/test/export-pdf.test.ts`：协议格式解析 + data-URL 与临时文件的分流判定。
- `packages/desktop/test/download-pandoc.test.ts`：平台映射匹配真实 Pandoc 发布版；版本可经环境变量覆盖；staging 目录对齐 `electron-builder.yml`。
- `packages/desktop/test/installer-pandoc.test.ts`：锁定每个平台的 `extraResources` 映射；两个文件引用同一套平台集合。

## 手动冒烟

- `pnpm dev` 配真实 Pandoc：打开 Agent 报告，点击 Export → PDF，浏览器下载 `report.pdf`。在阅读器中确认 Mermaid 已渲染为 SVG、KaTeX 公式排版正确、表格 / 任务列表 / 代码块背景保留。DOCX 同理在 Word / Pages 中验证。
- `pnpm dev` 不安装 Pandoc：打开同一份报告，确认 DOCX / EPUB / RTF / TXT 置灰并显示 tooltip；桌面模式下 PDF 仍可用，MD / HTML 任何时候都可用。