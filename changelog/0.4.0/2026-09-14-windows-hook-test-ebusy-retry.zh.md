# Windows hook 测试 EBUSY retry 覆盖所有 afterEach

- **Date:** 2026-09-14
- **Type:** fix
- **Scope:** `core`

[English](2026-09-14-windows-hook-test-ebusy-retry.md)

把 `packages/core/test/hooks.test.ts` 里针对 Windows 的 EBUSY retry 从只覆盖 `describe("script hooks")` 一处,扩展到所有其他 `rmdir` 脚本临时目录的 `afterEach`。retry 循环对 `fs.rm` 最多重试 10 次,每次间隔 20ms,最后一次仍失败则抛出,在 POSIX 上是 no-op。

## 覆盖范围

除已存在的 `describe("script hooks")` 外,另外 4 个 `afterEach` 现在使用同一个 retry 循环:

- `describe("…tool-script-…")` — 覆盖 `scriptPreToolUseHook` 流程。
- `describe("…prompt-hook-…")` — 覆盖 per-package `prompt` hook。
- `describe("…hooks-…")` — 覆盖 `EnvironmentInterface` 胶水测试。
- `describe("…tool-hooks-…")` — 覆盖 tool 内 hook 执行测试。

每个临时目录在对应块的 `beforeEach` 中用匹配前缀由 `fs.mkdtemp` 创建,retry 目标的形态跟 Windows 上已验证的那一个完全一致。
