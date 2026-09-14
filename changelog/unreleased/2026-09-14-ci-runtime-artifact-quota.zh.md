# CI runtime artifact 上传不再阻塞聚合 gate

- **Date:** 2026-09-14
- **Type:** process
- **Scope:** `ci`

[English](2026-09-14-ci-runtime-artifact-quota.md)

把 `runtime` 矩阵 job 里的 `Upload runtime artifact` 步骤改为非阻塞。步骤现在使用 `continue-on-error: true` 和 `if-no-files-found: warn`,这样 GitHub Actions artifact 存储配额命中(或某个 OS 变体缺打包树)时,`ci` 聚合 gate 不再变红。

## 改了什么

- `.github/workflows/ci.yml`:`runtime` job 的 `Upload runtime artifact` 步骤改为 `continue-on-error: true` + `if-no-files-found: warn`,代替之前的 `error` 行为。这一步的目的是把打包好的 desktop 树暴露给下游 workflow;漏一次上传在那里可恢复,但卡住配额导致 PR 没法合并不行。

## 为什么现在改

`companion-k` 和 `docs/restore-0.3.0-decisions` 上每次 push 都命中 artifact 配额。desktop build、preflight、`verify-packed-cli` 全部成功,只有 upload 这一步失败。配额每 6–12 小时重算,但这段时间里 CI gate 一直红。
