# 文件面板内置 Markdown 编辑器 + `editable-doc` 插件

- **Date:** 2026-09-08
- **Type:** feature
- **Scope:** `web`, `plugins`, `core`, `cli`, `desktop`

[English](2026-09-08-editable-docs.md)

文件面板的 `.md` 预览在「渲染」「源码」之外新增了**编辑**开关。点中即换出 CodeMirror 6 的 Markdown 编辑器（懒加载、单独成块），快捷键：**Cmd/Ctrl-S 保存**、**Esc 取消**。保存走的就是既有的 `PUT /api/sessions/:sessionId/files/content` 接口——不增路由、不增权限：保护预览的同一个成员或所有者校验顺带把写入也盖住了。整个编辑回路（打开、改、写、再渲染读取）全部留在同一组件里；草稿不跨会话保留，切到别的文件、未保存的字节按点「返回」或「取消」那样被丢掉。

## `editable-doc` 插件

- 新增预装插件 `plugins/editable-doc/`——`@linsight/editable-doc`，被 `core`、`cli`、`desktop` 各自声明为 workspace 依赖，loader 在每个 Agent 运行之处都能读到。
- 一个技能 **`format`**，教 Agent 写出之后仍可编辑的 Markdown：每节拆成 H2 段、可独立阅读；代码块的开头必带语言（` ```mermaid `、` ```ts ` …）；列表是真 Markdown 列表、表格用 GFM 表格，不是空白堆出来的「表格」；不用 HTML 摆版；代码块不嵌进列表项里；一节超过约 80 行就以 H3 拆开。

## 冲突横幅

- 用户存有未保存草稿的同时，Agent 又写了同一个 `.md` 文件，会冒出一条黄色横幅：**重新加载**（用服务端最新字节替换编辑器草稿）、**仍要保存**（撤下横幅；真正的保存仍按 Save 按钮走）。服务端后写覆盖，banner 只是提醒，不是锁。

## 取消／返回列表的丢弃确认

- 取消与返回列表都查 `editorDirty`；若草稿未落地，沿用既有的 `ConfirmModal` 弹出「放弃未保存的修改？」。没改动的编辑直接退回阅读视图。

## i18n

- 新增 5 个 `S.files.*` 键（`edit`、`editSave`、`editCancel`、`editConflictBanner`、`editDiscardConfirm`），中英两份（`strings.ts`、`strings-en.ts`）。`packages/web/test/workspace-browser-edit.test.ts` 里的 i18n 键一致性单测会覆盖到它们。

## README 表格

- `plugins/README.md`、`README.md`、`README.zh.md` 各自的办公效率 / Office Productivity 列各多一行 `editable-doc`。`packages/core/test/plugins.test.ts` 中的 README 表格守门测试保证三份始终同步。

## 测试

- `packages/core/test/plugins.test.ts`：loader 能加载 `editable-doc`；总数断言（12 → 13）、`office-productivity` 分组成员表、以及对 `format` 技能正文的新增断言，全部归入标准 `pnpm --filter @prismshadow/linsight-core test`。
- `packages/web/test/workspace-browser-edit.test.ts`：状态机覆盖——UTF-8 → base64 往返（ASCII／CJK／emoji）、i18n 键一致性、`MarkdownEditor` 模块导出与插件清单。
- `packages/web/e2e/workspace-edit.spec.mjs`：基于 Playwright 与 mock LLM 的端到端往返——通过既有的 `PUT /files/content` 接口种一个 `.md` 文件，在文件面板里打开，分别走 Save 按钮与 `Mod-S` 两条路径编辑，断言 toast 与服务端再次取回的内容一致。