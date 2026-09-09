# Server-side conflict detection for in-place Markdown saves

- **Date:** 2026-09-09
- **Type:** feature
- **Scope:** `server`, `web`

[中文版](2026-09-09-editable-docs-server-conflict.zh.md)

The in-place Markdown editor added yesterday ([2026-09-08-editable-docs](./2026-09-08-editable-docs.md)) showed a yellow banner when the Agent rewrote a file while the user held a dirty draft — but the warning was advisory only, and the server still let the save through and clobbered the Agent's bytes. This entry closes that gap by making the server itself reject the clobber.

## What changed

- `GET /api/sessions/:sessionId/files/content` now returns a weak `ETag` header derived from the file's mtime. The editor captures it on read and echoes it back on save as `If-Match`.
- `PUT /api/sessions/:sessionId/files/content` accepts an optional `If-Match` header. When present, the server stats the file and compares the current mtime to the value encoded in the ETag; if they differ (or the file is gone), the write is rejected with `409 file_conflict` and a reload/overwrite prompt.
- A successful save returns a fresh `ETag` so the next save's round-trip stays valid without a re-read.
- `apiFetchWithMeta` in the web client now surfaces the response `ETag`; `uploadWorkspaceFile` accepts an optional `ifMatch` and forwards it as the `If-Match` header.
- When `If-Match` is omitted (existing scripted callers, desktop imports) the write still goes through unchanged — backward compatible with every previous client.

## The conflict modal

- The yellow advisory banner is replaced by a modal that surfaces on `409 file_conflict`. **Reload** discards the draft and re-fetches the server's bytes; **Save anyway** retries the PUT without `If-Match`, forcing the write through (the editor surfaces a clear "your changes will overwrite the Agent's" warning).
- A `409` on a deleted file is reported as "file no longer exists" — the save is blocked so a force-save cannot silently resurrect a path the user thought was gone.
- A malformed `If-Match` header is rejected with `400 bad_request` instead of being silently treated as "no conflict check". A save that should have failed loudly would otherwise 200 with a side-channel write.

## Tests

- `packages/server/test/files-content-ifmatch.test.ts` (new): ETag header on `GET`; backward-compatible PUT without `If-Match`; matching / stale / malformed `If-Match` on PUT; `PUT` on a deleted file is rejected as `409`; the file is never resurrected by a force-save; outsiders still get `404` before any conflict logic runs.
- `packages/web/test/workspace-browser-ifmatch.test.ts` (new): `apiFetchWithMeta` surfaces `ETag` (or `null` when absent); the `headers` option reaches the wire; `uploadWorkspaceFile` echoes `ifMatch` and returns the new ETag; a `409 file_conflict` surfaces as `ApiError(409, "file_conflict", ...)` so the modal branch is reachable.
