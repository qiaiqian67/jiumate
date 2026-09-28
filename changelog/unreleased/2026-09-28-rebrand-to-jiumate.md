# Brand rename: Linsight → JiuMate

- **Date:** 2026-09-28
- **Type:** refactor
- **Scope:** `core`, `server`, `cli`, `web`, `desktop`, `docs`, `landing`, `skills`, `tooling`, `ci`
- **Breaking:** yes — every npm package name, CLI binary, data root path, env-var prefix, cookie name, install URL and release bucket changes; pre-existing on-disk data and install scripts targeting the `linsight*` names no longer resolve.

[中文版](2026-09-28-rebrand-to-jiumate.zh.md)

The project drops the `linsight` / `Linsight` / `LINSIGHT` brand and ships as **JiuMate** (Chinese: **九川**). This is the second rename in the project's history and it follows the convention the first one set (`changelog/0.3.0/2026-09-07-brand-rename-to-linsight.md`): a case-sensitive literal sweep with the per-surface scope honoured, the frozen changelog folders left alone, and the kernel advanced when the default system prompt moves.

## Compatibility

Existing installations stop working as soon as this build runs, because every external identifier moved:

- **Package names.** `@prismshadow/linsight-{cli,core,desktop,docs,landing,server,web,inspirations,pets,skins}` → `@prismshadow/jiumate-{…}`; `@linsight/*` → `@jiumate/*`. Any `package.json` listing the old names fails dependency resolution.
- **CLI binaries.** `linsight` / `linsight-hmr` → `jiumate` / `jiumate-hmr`.
- **Data root.** `~/.linsight/{data,dev-data,…}` → `~/.jiumate/{…}`. An existing install must be moved, or pointed at with `JIUMATE_HOME`.
- **Env vars.** `LINSIGHT_*` → `JIUMATE_*`, including `LINSIGHT_HOME`, `LINSIGHT_API_TOKEN`, `LINSIGHT_PROJECT_ID`, `LINSIGHT_AGENT_ID`, `LINSIGHT_WEB_DIST` and `LINSIGHT_PREVIEW_ORIGIN`.
- **Cookie name.** `linsight_session` → `jiumate_session`. Logged-in browser sessions from the old build are invalidated.
- **Install URLs and the release bucket.** `linsight.ooo` → `jiumate.ooo`, and `linsight-releases.oss-cn-beijing.aliyuncs.com` → `jiumate-releases.oss-cn-beijing.aliyuncs.com`. **Neither exists yet** — see below.
- **Default system prompt.** The built-in `DEFAULT_SYSTEM_PROMPT` now names the agent `JiuMate`, so the kernel advanced: `KERNEL_VERSION` is `2026-09-28`, the previous prompt-tab hash and the re-anchored in-process reconstruction hash are appended to `KERNEL_SUPERSEDED_TAB_HASHES.prompt`, and the generation list records the move. Only the prompt tab moved; runtime, tools, skills, memory, vault and schedules are unchanged.
- **Frozen changelog folders.** `changelog/{0.1.0…0.3.0}/` retain the old brand in their prose because they record what shipped under that name; their content is not rewritten.

## Two things this rename cannot do for you

Both are outside the repository and both matter more than the sweep itself:

1. **The domain and the OSS bucket do not exist under the new names.** `install.sh` / `install.ps1`, the CLI's update source and the desktop's update source all point at `jiumate.ooo` and `jiumate-releases.oss-cn-beijing.aliyuncs.com` now. Until that domain is registered and that bucket is created (or these are pointed at whatever the real endpoints are), a fresh install and the update check will fail. Reverting is one substitution in those four files if the name is not settled.
2. **The GitHub repository still answers to its old path.** Every badge, clone URL and doc link now reads `github.com/qiaiqian67/jiumate`, which 404s until the repository is renamed on GitHub (which then redirects the old path, so nothing breaks permanently).

## Details

- The sweep walked the **git-tracked** file set rather than the directory tree — the precise definition of "the repository". That excludes build output, caches and local logs without guessing at ignore rules, and it mattered: the one directory named `build` in this repo (`packages/desktop/build`) is tracked source (electron-builder config and the Linux installer templates, 11 references) that a directory-name skip would have silently missed.
- 859 files changed content and 41 paths were renamed. Path renames cover the CLI entry points (`cli/src/{linsight,linsight-hmr}.ts`), the release launchers (`scripts/launchers/`), the logo assets in all three packages (`linsight-logo.svg/png`), the `LinsightLogo` component file, the agent skills (`.agents/skills/linsight-*`, `plugins/agent-development/skills/linsight-*`), and 22 landing blog posts.
- **Two historical statements were repaired by hand afterwards**, because a literal sweep makes a sentence that *describes a past rename* assert something false. `kernel-history.ts`'s frozen label for the `048198c3…` prompt hash says that rename went to `Linsight` (it did); the 0.3.0 line in `CHANGELOG.md` / `CHANGELOG.zh.md` likewise names `Linsight` as the name that release introduced. The rest of the changelog index keeps the current brand, which is the convention the first rename established.
- **The Chinese name is used where the product names itself**: `strings.ts`'s `appName` (the login heading, the app header and the document title) and the `README.zh.md` heading are `九川`; the English surfaces are `JiuMate`. Inline brand mentions inside Chinese prose stay Latin, matching the existing convention.
- `pnpm-lock.yaml` was deleted and regenerated after clearing `node_modules` once, to drop the stale `@linsight+*` pnpm-store entries.
- **Stale build output had to be cleared too, and would otherwise have failed the build.** `packages/*/dist` still held `.d.ts` files from before the rename, and `pnpm typecheck` checks the server against core's *emitted* declarations — so it reported `LinsightContext` / `LinsightInterface` errors for identifiers that no longer existed anywhere in source. Removing every `dist` (and `.tsbuildinfo`) and rebuilding fixed it. The previous rename's note about clearing `node_modules` is the same idea; dists belong on that list now that packages resolve each other through `exports`.
- Test fixtures whose numbers encode the brand's length were recomputed. `messaging-telegram.test.ts` pins Telegram entity offsets in UTF-16 code units: `@linsight_test_bot` is 18 units and `@jiumate_test_bot` is 17, so five mention lengths dropped by one, a second-mention offset moved 34 → 33 and another 23 → 22, and the two `text_mention` lengths covering a display name went 14 → 13 and 22 → 21. The docs search test's merged-range `end` went 8 → 7.
- Verification: `pnpm build`, `pnpm format:check`, `pnpm typecheck`, `pnpm lint` clean; `pnpm test` green — docs 53/53, landing 71/71, skins 113/113, inspirations 43/43, pets 21/21, cli 434, desktop 219, core 1149, web 1920, server 1831 (53 skipped). The stopped dev stack was then restarted by hand to confirm the renamed server boots, resolves `~/.jiumate/dev-data`, serves an existing Session, and that the Vite dev server returns `<title>JiuMate</title>` with `jiumate-logo` in the markup. One core test (`exec_command` Ctrl-C interruption) flaked once under the full parallel run and passed 3/3 in isolation — a Windows signal-timing flake, unrelated to the rename.
