# CI runtime artifact upload no longer blocks the aggregate gate

- **Date:** 2026-09-14
- **Type:** process
- **Scope:** `ci`

[中文版](2026-09-14-ci-runtime-artifact-quota.zh.md)

Made the `Upload runtime artifact` step in the `runtime` matrix job non-blocking. The step now sets `continue-on-error: true` and `if-no-files-found: warn`, so a GitHub Actions artifact-storage quota hit (or a missing tree for an OS variant) no longer turns the `ci` aggregate gate red.

## What changed

- `.github/workflows/ci.yml`: `runtime` job's `Upload runtime artifact` step now uses `continue-on-error: true` and `if-no-files-found: warn` instead of the previous `error` behaviour. The step's purpose is to expose the packed desktop tree to a downstream workflow; a missed upload is recoverable there, while a quota-blocked PR merge is not.

## Why now

The artifact quota was hit on every push across `companion-k` and `docs/restore-0.3.0-decisions`. The desktop build, the preflight, and `verify-packed-cli` all completed successfully; only the upload step failed. Quota is recalculated every 6–12 hours, but the CI gate was failing the whole time.
