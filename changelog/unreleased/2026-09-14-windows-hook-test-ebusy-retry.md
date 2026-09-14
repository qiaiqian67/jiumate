# Windows hook test EBUSY retry covers every afterEach

- **Date:** 2026-09-14
- **Type:** fix
- **Scope:** `core`

[中文版](2026-09-14-windows-hook-test-ebusy-retry.zh.md)

Extended the Windows-specific EBUSY retry in `packages/core/test/hooks.test.ts` from the single `describe("script hooks")` block to every other `afterEach` that rmdir's a script temp dir. The retry loops `fs.rm` up to 10 times with a 20ms gap, surfaces the final error if every attempt fails, and is a no-op on POSIX.

## Coverage

Four additional `afterEach` blocks now use the same retry loop, alongside the existing one for `describe("script hooks")`:

- `describe("…tool-script-…")` — covers the `scriptPreToolUseHook` flow.
- `describe("…prompt-hook-…")` — covers the per-package `prompt` hook.
- `describe("…hooks-…")` — covers the `EnvironmentInterface` glue tests.
- `describe("…tool-hooks-…")` — covers the in-tool hook execution tests.

Each temp dir is created by `fs.mkdtemp` with the matching prefix in that block's `beforeEach`, so the retry target is identical in shape to the one already proven on Windows.
