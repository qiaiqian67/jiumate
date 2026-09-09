# 内置 Markdown 编辑的服务端冲突检测

- **Date:** 2026-09-09
- **Type:** feature
- **Scope:** `server`, `web`

[English](2026-09-09-editable-docs-server-conflict.md)

昨天上线的内置 Markdown 编辑器（[2026-09-08-editable-docs](./2026-09-08-editable-docs.zh.md)）在用户持有未保存草稿、Agent 又写入同一文件时会弹一条黄色横幅——但这条横幅只是提醒，服务端仍允许保存并覆盖 Agent 的字节。这一改动让服务端本身拒绝这种覆盖。

## 变更内容

- `GET /api/sessions/:sessionId/files/content` 现在带一个弱 `ETag` 响应头，编码的是文件 mtime。编辑器读到后存起来，保存时回写为 `If-Match`。
- `PUT /api/sessions/:sessionId/files/content` 接受可选的 `If-Match` 头。出现时，服务端 stat 该文件并对比当前 mtime 与 ETag 里的值；若不一致（或文件已被删除），写入被拒绝，返回 `409 file_conflict`，前端弹窗让用户选择。
- 写入成功后响应里带一个新的 `ETag`，下次保存直接复用，不必先 GET。
- Web 端的 `apiFetchWithMeta` 现在把响应 `ETag` 透出；`uploadWorkspaceFile` 接受可选的 `ifMatch` 参数并转发为 `If-Match` 头。
- 不传 `If-Match` 时（既有的脚本化调用、桌面端导入）写入照旧通过——和历史客户端完全兼容。

## 冲突弹窗

- 原黄色提醒横幅替换为 `409 file_conflict` 时弹出的模态框：**重新加载**丢掉草稿、按服务端最新字节重新取；**仍要保存**去掉 `If-Match` 重试，强制写入（编辑器会明确提示「这会盖掉 Agent 的当前内容」）。
- 文件已删除时返回的 `409` 会带「文件已不存在」——强制保存不会悄悄复活一个用户以为不存在的路径。
- 格式不合法的 `If-Match` 头一律以 `400 bad_request` 拒绝，不会被悄悄当成「不做冲突检查」。否则本该大声失败的保存会带着副作用静默 200。

## 测试

- `packages/server/test/files-content-ifmatch.test.ts`（新增）：`GET` 带 `ETag`；无 `If-Match` 时 PUT 向后兼容；匹配 / 不匹配 / 格式非法的 `If-Match`；已删除文件的 PUT 返 `409` 且不会被强制保存复活；外部用户始终先被 `404` 拦下，冲突逻辑根本不跑。
- `packages/web/test/workspace-browser-ifmatch.test.ts`（新增）：`apiFetchWithMeta` 透出 `ETag`（缺失时为 `null`）；`headers` 选项确实发到线上；`uploadWorkspaceFile` 转发 `ifMatch` 并返回新 ETag；`409 file_conflict` 透出为 `ApiError(409, "file_conflict", ...)`，使模态分支可达。
