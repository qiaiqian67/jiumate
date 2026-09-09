# Brand rename: PenguinHarness → Linsight

- **Date:** 2026-09-07
- **Type:** refactor
- **Scope:** `core`, `server`, `cli`, `web`, `desktop`, `docs`, `landing`, `skills`, `tooling`, `ci`
- **Breaking:** yes — every npm package name, CLI binary, data root path, env-var prefix, cookie name and HTTP route changes; pre-existing on-disk data and install scripts targeting the `penguin*` names no longer resolve.

[中文版](2026-09-07-brand-rename-to-linsight.zh.md)

The project drops the `penguin` / `Penguin` / `PENGUIN` brand and ships under the name `Linsight` (Chinese: 灵悉). Every literal of the old brand was swept from the workspace: the seven npm packages in `@prismshadow/linsight-{cli,core,desktop,docs,landing,server,web}`, the twelve plugin packages under the new scope `@linsight/*`, the two CLI bins `linsight` and `linsight-hmr`, the default data root `~/.linsight/data`, the cookie `linsight_session`, the env-var prefix `LINSIGHT_*`, every URL pointing at the previous GitHub repository, every public type / class / log line / error message / UI string / README / blog post / doc page / skill body, and the three frozen changelog folders (intentionally untouched).

## Compatibility

Existing installations stop working as soon as this build runs because every external identifier has moved:

- **Package names.** `@prismshadow/penguin-{cli,core,desktop,docs,landing,server,web}` → `@prismshadow/linsight-{...}`; `@penguinharness/*` → `@linsight/*`. Any `package.json` listing the old names fails dependency resolution.
- **CLI binaries.** `penguin` / `penguin-hmr` → `linsight` / `linsight-hmr`. Launchers and PATH entries under the old names no longer resolve.
- **Data root.** `~/.penguin/{data,dev-data,dev-data-cli,…}` → `~/.linsight/{...}`. An existing install must be moved (or pointed at via `LINSIGHT_HOME`) before the new server can find its state.
- **Env vars.** `PENGUIN_HOME`, `PENGUIN_API_TOKEN`, `PENGUIN_SEED_ADMIN_PASSWORD`, `PENGUIN_PROJECT_ID`, `PENGUIN_AGENT_ID`, `PENGUIN_SESSION_ID`, `PENGUIN_LANG`, `PENGUIN_WEB_DIST`, `PENGUIN_API_PROXY`, `PENGUIN_API_URL`, `PENGUIN_ADMIN_PASSWORD`, `PENGUIN_SHELL`, `PENGUIN_E2E` → `LINSIGHT_*`.
- **Cookie name.** `penguin_session` → `linsight_session`. Logged-in browser sessions from the old build are invalidated.
- **Default system prompt.** The built-in `DEFAULT_SYSTEM_PROMPT` template now names the agent `Linsight`, so any `system_config.yaml` matched by hash against the previous prompt tab advances to the new wording on the next kernel update. The kernel version is `2026-09-07`; the previous prompt tab hash is recorded in `KERNEL_SUPERSEDED_TAB_HASHES.prompt` so a one-shot advance still resolves.
- **Frozen changelog folders.** `changelog/{0.1.0..0.2.9}/` retain the old brand in their prose because they record what shipped under that name; their content is not rewritten.

## Details

- The renamer walked the workspace via `ripgrep` (case-insensitive) and applied a literal `penguin` → `linsight`, `Penguin` → `Linsight`, `PENGUIN` → `LINSIGHT`, `penguin-harness` / `PenguinHarness` → `linsight` / `Linsight`, and `penguinharness` → `linsight` substitution with the per-section scope honored (zh copy got `灵悉` for the Chinese brand references).
- The plugin directory `plugins/agent-development/skills/{penguin-config,penguin-orchestration,penguin-sdk}` was renamed to `linsight-*` and every `SKILL.md` frontmatter `name:` field updated to match.
- `pnpm-lock.yaml` was deleted and regenerated; `node_modules/` was cleared once to drop the stale `@penguinharness+*` pnpm-store entries that had survived the rename.
- The agent config kernel advanced one generation: `KERNEL_VERSION = "2026-09-07"`, `KERNEL_DEFAULT_TAB_HASHES.prompt` recomputed against the renamed prompt, the previous hash appended to `KERNEL_SUPERSEDED_TAB_HASHES.prompt`, and a one-line generation note added above the record.
- Test fixtures adjusted where the rename changed character counts: eight `length: 17` mention entities in `messaging-telegram.test.ts` → `length: 18`, the second-entity offsets in the same file shifted by one to keep pointing at the new handle; the two `text_mention` entities covering the display-name `Linsight Test` were bumped from `12 → 14` and `21 → 22` to cover the one character the rename added.
- Verification matrix run: `pnpm install` + `pnpm build` clean; `pnpm format:check`, `pnpm typecheck`, `pnpm lint` clean; core `model-catalog` 37/37, `kernel-version` 19/19, landing 71/71, docs 53/53, plugins 15/15, web 1623/1623, server 113 passed / 3 skipped / 5 files failed — the five failing files all error with `EPERM: symlink` on Windows, a pre-existing platform limitation unrelated to the rename.
