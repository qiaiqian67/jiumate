# 文件面板 MD 渲染视图的 Mermaid 闪烁

- **Date:** 2026-09-09
- **Type:** fix
- **Scope:** `web`

[English](2026-09-09-editable-docs-rendered-flicker.md)

接 [2026-09-09-editable-docs-ux-fixes](./2026-09-09-editable-docs-ux-fixes.zh.md) 之后：流程图能渲染出来，但整个 MD 面板一直在抖，控制台无报错。根因：`WorkspaceBrowser` 的 JSX 里把 `components` 当成内联对象字面量传给 `<ReactMarkdown>`，父组件每次提交都拿到一组全新的 `pre` / `img` / `a` 函数引用——react-markdown 视为新组件类型，React 就把每个代码块 unmount 再 mount，`MermaidBlock` 的 `useEffect` 清空 innerHTML、异步导入 mermaid、调用 render()，循环往复。

## 改了什么

- 把 Markdown 渲染视图抽成独立的 `React.memo` 包裹的 `RenderedMd` 组件。它的 `components` map 用 `useMemo`，依赖文件路径、读 nonce、会话 id、源码高亮阈值、相对链接点击回调这些输入。父组件提交但没改它们时，组件类型保持稳定，React 不再 unmount/mount 代码块。
- 相对链接点击回调 `onLinkClick` 接普通函数引用；`WorkspaceBrowser` 的 `previewPath` 早就稳定（通过 ref 锁住，给 openRequest 定位 effect 用），不会触发额外的 re-render。

## 顺带影响

- 同一个 `components` map 还管图片缓存破坏符（`v=<nonce>`）和相对链接解析。memo 化后两者都保留，只是不会再随父组件提交白白重跑。

## 测试

- `pnpm --filter @prismshadow/linsight-web test`：1685 个用例全过。`workspace-browser-edit.test.ts`、`workspace-browser-mermaid.test.ts`、`markdown-gfm.test.ts`、`md-mermaid.test.ts` 都保持绿。