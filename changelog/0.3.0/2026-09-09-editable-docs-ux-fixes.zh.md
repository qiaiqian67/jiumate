# 文件面板 Markdown 编辑器：保存留编辑、切换视图不丢草稿、Mermaid 渲染

- **Date:** 2026-09-09
- **Type:** feature
- **Scope:** `web`

[English](2026-09-09-editable-docs-ux-fixes.md)

文件面板编辑器来自 [2026-09-08-editable-docs](./2026-09-08-editable-docs.zh.md)，当天收集到 4 处交互瑕疵，全部在 `feat/editable-docs` 分支上与服务端冲突检查（[2026-09-09-editable-docs-server-conflict](./2026-09-09-editable-docs-server-conflict.zh.md)）同步修复。

## 保存后留在编辑模式 (#40)

- **保存**不再自动跳回渲染视图。用户留在编辑器里，工具栏的 **保存** / **取消** 一直亮着；响应头里的 ETag 立即写回 `preview.etag`，下次保存的 `If-Match` 闭环不被打破。
- 后台再去取一次文件，最新字节最终落到 `preview.content`；用户手动切到 **渲染** 或 **源码** 时看到的就是刚刚保存的内容——正是 #40 描述的「实时显示已经保存内容」。
- 编辑器内部的 `Cmd/Ctrl-S` 走同一条 `saveMdEdit` 路径，同样不切走。

## 切换视图不丢草稿 (#41.1)

- `.md` 文件的预览工具栏三个开关常驻：**渲染** / **源码** / **编辑**。互相切换不会清掉未保存的字节。
- 编辑中切到 **渲染**：渲染的是 `draftMd`（用户当前键入的草稿），不是磁盘上的 `preview.content`。**源码** 同理——展示的也是草稿原文。
- 非编辑态点 **编辑**：触发 `enterMdEdit`（把 `preview.content` 快照进 `draftMd`、挂载编辑器）；编辑中再点 **编辑**：相当于把焦点还给编辑器。

## 布局：去掉嵌套滚动条与下方空白 (#41.2)

- MarkdownEditor 旧版用 `h-full` + `overflow-auto` 包了一层，导致面板的滚动条与编辑器自身的滚动条并存；短文档时下方又是一大片空白。现在编辑器按自然高度展开：长文档由 CodeMirror 自带的 `.cm-scroller` 用 `max-height: 60vh` 滚，外层面板只在编辑器真的超过视口时才滚——没有嵌套滚动条，单行文件下也没有大段空白。

## Mermaid 在聊天与文件预览里都渲染 (#41.3)

- 之前 `MermaidBlock` 只挂在导出流水线上。聊天消息渲染（`features/chat/md.tsx`）与工作区 md 预览现在都把 ``` `mermaid` 围栏路由到 `MermaidBlock`，而不是 Shiki 驱动的 `CodeBlock`（那个 chrome 对 SVG 没意义）。Mermaid 本身保持懒加载，**只在消息落定后渲染**——流式回复期间显示原始围栏源码，避免每个 delta 重渲时冻屏。
- 给 Mermaid 的 nonce（也就是它要求的全局唯一 DOM id 的一部分）格式是 `callerId-hash32(code)`：`callerId` 在聊天里是消息 id，在文件预览里是 `preview.nonce`；`hash32` 是源码体的 FNV-1a 哈希——同一页上重复的图能拿到不同的 nonce，改动图源代码一定会翻转 nonce（Mermaid 重渲）。
- 新增 `packages/web/test/md-mermaid.test.ts` 钉住四条分支决策：落定的 mermaid → MermaidBlock；流式中的 mermaid → 纯 `<pre>`；其它语言 → CodeBlock；math 围栏 → KaTeX。

## GFM 覆盖验证 (#41.4)

- 现有的 `packages/web/test/markdown-gfm.test.ts`（表格、任务列表、删除线、自动链接、footnote）通过共享的 `lib/markdown-plugins.ts` 流水线覆盖 GFM。5 个用例全部通过——管线无需改动，这个测试是「功能已发布」的缺失证据。

## 测试

- `pnpm --filter @prismshadow/linsight-web test`：1685 个用例全过（包含新增的 `md-mermaid.test.ts`、既有的 `markdown-gfm.test.ts`，以及编辑器依赖的 `apiFetchWithMeta` / `uploadWorkspaceFile` 闭环测试）。
- `packages/web/test/workspace-browser-edit.test.ts` 与 `workspace-browser-mermaid.test.ts` 在隔离环境下覆盖工具栏与适配器。
- 端到端 `packages/web/e2e/workspace-edit.spec.mjs` 已更新——保存后手动点 **渲染** 再断言落盘字节（`pnpm test:e2e` 本身需要 `npx playwright install chromium`，本环境 headless shell 缺失，端到端门靠构建 + 单元套件的绿色来把守）。