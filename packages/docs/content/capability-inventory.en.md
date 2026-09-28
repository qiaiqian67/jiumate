---
title: Capability inventory
description: What every package ships today, where the key paths live, and which finer details are still missing. The inventory methodology lives in capability-matrix.
---

This page is the authoritative inventory of what JiuMate ships today. Each row cites the file path it leans on; if the path is wrong or has moved, treat the row as wrong. The page's credibility rests entirely on the paths it references.

Inventory scope:

- [packages/core](#packagescore) — SDK and execution engine
- [packages/server](#packagesserver) — HTTP API, SSE routing, scheduler, persistence
- [packages/web](#packagesweb) — React 19 SPA
- [packages/cli](#packagescli) — the `jiumate` command and its subcommands
- [plugins/](#plugins) — the 12 shipped plugin packages
- [packages/desktop](#packagesdesktop) — Electron shell
- [Public sites / repo engineering](#public-sites-repo-engineering) — landing, docs, CI, signing, release

## packages/core

| Dimension | Status | Key path |
|---|---|---|
| Agent loop | Single-stream ReAct; **tools run in parallel**, approvals run serially; subagents max one level (`MAX_SUBAGENT_DEPTH = 1`) | `engine/context-engine.ts` |
| Streaming output | The only output mode; `partial_*` increments in real time, segments finalize a full `model_msg` at end | `llm/generative-model.ts` |
| LLM abstraction | All providers come through `@prismshadow/agenthub`; tool calling, vision, inline thinking, prompt caching, thinking level, fast mode all supported | `interfaces/llm.ts:137` |
| Retry classification | Only 4 classes are fatal (credentials, 4xx, fast-mode-unsupported, assembly failure); everything else is retryable; defaults `maxReconnects = 5`, `maxTurnAttempts = 20` | `context-engine.ts:427` |
| Tool set | 9 built-in (read/write/edit/shell/input-shell/2× subagent/2× image); **no built-in web fetch / git / grep** | `environment/tools/registry.ts:37` |
| OmniMessage protocol | 7 payload classes + 9 event classes; the bracket-marker form (`[tag]…[/tag]`) is authoritative; the angle-bracket form is supported indefinitely | `omnimessage/types.ts`, `markers/` |
| Trace | Append-only JSONL, single `write(2)` + `O_APPEND`; records `request_begin/end`, `token_usage`, `subagent`, `approval_decision`, `compaction_begin/end`, `hook`, `mcp_connect_begin/end`; **no structured query layer, no remote, no compression, no size/count rotation** | `trace/writer.ts:207` |
| Sandbox | `command_policy` blocks a short regex of `rm -rf`, `mkfs`, etc.; **no OS-level sandbox**; absolute paths allowed; symlinks followed | `internal/command-policy.ts` |
| Plugins | npm packages, `plugin.json` + `skills/<name>/SKILL.md` + `hooks/*.mjs` (pure Node subprocess, stdin/stdout JSON); **no marketplace, no signing, no hot-install** | `plugins/index.ts` |
| Public API | 7 subpath entries + main barrel, exporting `Agent`, `Session`, `ContextEngine`, placeholders, `GenerativeModel`, `Environment`, `Writer`, hooks, marker parsers | `index.ts` |
| i18n | Core has no runtime i18n; `error_message` stays English on purpose, the Web translates by `error_code` | — |

## packages/server

Hono 4 + `node:sqlite` + `ws`, ~50k LOC, 121 test files / 44k lines.

The runtime shell (`createRuntimeApp`, `bootAppDeps`) and the platform surface (`buildAppDeps`, `createApp`, `app.ts:1120-1256`) are separated. Almost all business routes live in the platform; `POST /api/hmr/upgrade` can push a signed gzip hot-replacement of the whole platform. Only `/api/auth`, `/api/desktop`, `/api/hmr`, and static hosting stay in the runtime layer.

| Dimension | Status | Key path |
|---|---|---|
| HTTP routes | ~200 endpoints, mounted in `app.ts:465-492` (runtime) and `app.ts:1154-1256` (platform). Main subtrees: `/api/projects/:p/...`, `/api/projects/:p/agents/:a/...`, `/api/sessions/:id/...` (40+ subroutes; largest file `sessions.ts` is 1395 lines), `/api/sessions/:id/messaging/{feishu,telegram,qq,wechat}/...`, `/api/terminals/...`, `/preview/:token/*`. Validation is hand-written (`http/validate.ts`); **no OpenAPI schema, no API versioning, no `HEAD` / `OPTIONS` handling** | `app.ts` |
| Auth model | Single-tenant single-admin, two-role ACL (owner/member) + admin. Cookie `jiumate_session` (HttpOnly, SameSite=Lax, 30-day sliding renewal); `<root>/api-token` is re-minted at every startup, Bearer = admin equivalent | `auth/service.ts`, `auth/api-token.ts` |
| First-login claim | 144-char random password generated, hashed, plaintext discarded; startup prints a first-login link (30-day validity); `/api/auth/claim` strictly validates the token | `auth/service.ts:44,129` |
| Projects | `project_id` = directory name, immutable; only display name can change; non-admin id must be prefixed `<userId>-`; **no soft-delete / archive / ownership transfer** | `project-service.ts:158-175` |
| Agent | Full filesystem config at `system_config.yaml` + `AGENTS.md`; member can write both; tar.gz import/export with explicit overwrite flag | `agent-service.ts:445` |
| Skills / plugins | ZIP upload/download; `assertSafeEntryPath` blocks zip-slip; `MAX_ARCHIVE_BYTES = 14MB` plus per-file and total limits; member can write; **no signing, no virus scan** | `skills.ts:46-56` |
| Models | `PUT /models` is whole-table declarative replacement; `/test`, `/detect`, `/list`, `/detect-vision` probe live; OAuth via `/model-oauth/*` (PKCE all server-side); **no ETag / If-Match — last write wins** | `models.ts:225-329` |
| LLM path | **Does not proxy.** Server runs `createCoreSessionLoader` → `createAgent` in-process; credentials live in `.project_config.toml`, per-project (0600, plaintext), owner-writable only; `modelConfigChanged` invalidates runtime cache, broadcasts `credentials_updated` to every channel, triggers remote machine sync | `runtime/session-manager.ts:224` |
| SSE / realtime | `/api/sessions/:id/stream` and `/api/events` share a `Channel`; event id `<epoch>-<seq>` (8-char epoch per process); ring buffer 10k / 8MB; `Last-Event-ID` hits replay, misses unicast `resync_required`; `: ping` every 20 seconds; first event is always authoritative `task_state` + replays all outstanding approvals; tasks return 202 and decouple from SSE — closing the tab does not stop the task | `sse.ts`, `channel.ts` |
| Persistence | `node:sqlite` `DatabaseSync`, WAL + FK + `busy_timeout=5000`; 16 tables: `users`, `auth_sessions`, `projects`, `project_members`, `agents`, `sessions`, `usage_records`, `error_records`, `schedule_state`, `messaging_bindings`, `ui_prefs`, `server_settings`, `machine`, `machines`, `machine_project`, `trace_files`, `trace_sessions`; **only `error_records` has a 20k-row + periodic-trim policy; `usage_records` grows unbounded; most user-facing tables have no FK** | `schema.ts`, `database.ts:49` |
| Migrations | `PRAGMA user_version` strictly monotonic, DDL frozen, each step `BEGIN/COMMIT` + rollback + `swapSafe` flag; non-swap-safe migrations throw `RestartRequiredError` on the hot-push path rather than half-applying; 4 migrations so far | `db/migrations.ts` |
| Usage / billing | `token_usage` event → one `usage_records` row per request; **cost is computed at query time, never stored**; peak/off-peak supported; grouped by `date|agent|model|session`, granularity `minute|hour|day|week|month` with zero-fill; subagent consumption attributed to the main session via `origin_session_id`; **no invoicing, budget, quota, alert** | `services/usage-service.ts` |
| Scheduler | In-process, 30-second tick; schedule is declarative TOML, the system never writes back; runtime state in `schedule_state`; **no backfill, no queue-when-busy, no mtime-gated scan, no cron expression, no retry/backoff on failure**; `POST /:id/retry-now` forces one run | `runtime/scheduler.ts` |
| Background loops | Channel sweep, 30-minute idle runtime cleanup (`unref`), TTL-cached `UpdateCheckService`, background `UpdateJob` (readable progress via `GET /api/version/update`), machine SSH lanes / tunnels, messaging long connections, startup `adoptUnmanagedTraceSessions` | — |
| Vault / secrets | `<agent>/.vault.toml` 0600; key names follow shell env rules, value ≤ 8192 bytes (Linux `E2BIG`); **plaintext storage is by design; no KMS, no rotation; the model only sees the key name** | `state/agent-vault.ts:107` |
| File upload | Request body limit **derived per admin attachment budget** — measured (chunked-safe), not read from a header; defaults 100MB/file, 120MB/request, admin range 1–200MB; `INLINE_IMAGE_MAX_MB` is a separate smaller cap (base64 4/3 expansion in trace JSONL); zip-slip + `realpath` double defence | `attachment-limits.ts`, `workspace-files-service.ts` |
| Same-origin XSS | Workspace file reads force `nosniff` + `Cache-Control: no-store`; inline HTML downgrades to `text/plain`; `?preview=1` gets `CSP: sandbox` (no `allow-same-origin`); SVG keeps `image/svg+xml` (so `<img>` renders) while still serving `CSP: sandbox` (so direct navigation fails); `?preview-redirect` issues a signed token then 302s to the dedicated preview origin; preview hostname serves only `/preview/*`, `/api` is 401 forever and does not read cookies; preview token is host-bound with TTL | `sessions.ts:1211-1257`, `preview.ts` |
| i18n | Server is **English-only** by design. The contract is `error.code` not `message`; the Web translates via the hand-maintained `S.errors.byCode` table; **no `Accept-Language` handling; no compile-time or test-time validation between server codes and the frontend table** — adding or renaming a code silently degrades to raw English | `http/errors.ts:121-127` |
| Tests | 121 vitest files / 44k lines; `TEST_PASSWORD_HASH_COST = 2` (minimum legal scrypt) keeps the suite fast; production strength asserted separately; E2E in `packages/web/e2e/` (31 Playwright specs + mock LLM); **no load/soak, no fuzz, no coverage threshold, no server-codes ↔ frontend-table contract test** | `test/helpers.ts` |
| Production hardening | Strengths: per-request derived body limit, dedicated preview origin, explicit opt-in `JIUMATE_TRUST_PROXY=1`, default 127.0.0.1 binding, 0600 + `O_EXCL|O_NOFOLLOW` for secret files, `timingSafeEqual` for tokens and passwords, single-instance lock (pid alive + port listening dual signal); **missing: rate limiting beyond login, audit log, CORS, global security headers, request id, structured logging, SSRF protection, optimistic concurrency, member role narrowing** | `app.ts`, `lock.ts`, `auth/middleware.ts` |

## packages/web

React 19 + Vite 7 + Tailwind 4.

| Dimension | Status | Key path |
|---|---|---|
| Routing | 9 main routes + full-screen terminal; 9-tab Agent settings; **no route-level code splitting** | `router.tsx` |
| Chat UI | Complete: markdown + Shiki + KaTeX + xterm, file/image drag-drop, 9 tool cards, subagent topology, context donut, conversation outline, `/compact`, `/agent` and `/model` switches | `features/chat/*` |
| Virtual lists | **None at all** — long sessions accumulate DOM indefinitely | — |
| Agent management | 9 tabs (overview / system prompt / runtime / tools / MCP / skills / hooks / memory / vault / schedule); placeholder insertion chip | `features/agents/agent-settings-page.tsx` |
| SKILL.md editor | **None** — only ZIP round-trip or chat install prompt | `features/agents/skills-tab.tsx` |
| Model management | 170 KB `models-page.tsx`, grouped by vendor, credentials masked, OAuth supported; **no per-key rotation UI** | `features/models/models-page.tsx` |
| Trace viewer | Embedded in chat page dock tab; CUDA-style swimlane timeline; **no standalone cross-session trace browser** | `features/traces/trace-panel.tsx` |
| Eval | Read-only scoreboard; **no A/B prompt compare, no UI-side scoring** | `features/benchmark/benchmark-page.tsx` |
| Settings | Modal popup; language (zh / en / follow), theme (light / dark / follow), font scale, accent color, terminal theme, currency; admin: user management, proxy, upload, trace import | `features/settings/*` |
| i18n | zh + en, **type system enforces parity** (`placeholders-parity.test.ts`); hard-coded JSX literals are not audited | `lib/strings.ts` (2451 lines) + `strings-en.ts` (2497 lines) |
| State management | zustand + hand-written fetch; **no React Query / SWR** — switching tabs refetches | — |
| a11y | Full keyboard, ARIA, Esc-layer stack, tone system; **modals have no explicit focus-trap** (Esc-only close) | `components/ui/modal.tsx` |
| PWA | **None** — no service worker, manifest, `beforeinstallprompt`, or offline | — |
| Voice input | **None** | — |
| Tests | 118 unit + 31 Playwright e2e; **no visual regression** | `test/`, `e2e/` |

## packages/cli

`@prismshadow/jiumate-cli`.

28 subcommands across `auth`, `config`, `run`, `chat`, `ls`, `logs`, `input`, `agent`, `project`, `cost`, `schedule`, `server`, `web`, `update`, `version`. Persistent `node:readline` + bracketed-paste handling + `\` line continuation; `/exit`, `/clear`, `/compact`, `/goal[:budget]`, `/thinking`, `/verbose`. **Every read command supports `--json` for scripting; `--background` and `--timeout 0` for non-blocking usage.** Connection resolution: explicit `--server` env > live `<root>/server.lock` > auto-spawn background server. 401 auto-reloads `<root>/api-token`. **No tab completion, no history file, no OAuth/SSO.**

## plugins

12 shipped:

```
@jiumate/agent-development   4 skills   LLM/config/orchestration/SDK
@jiumate/agent-tuning        4 skills   init/benchmark/eval/optimize
@jiumate/continual-learning  1 hook     stop: distil discoveries past 30 turns into a skill
@jiumate/data-analysis       1 skill
@jiumate/goal                2 hooks    user_prompt + stop: `/goal` backend
@jiumate/humanizer           1 skill    3-layer AI-tell removal
@jiumate/model-development   3 skills   llamafactory / ollama / vllm
@jiumate/skill-porting       1 skill    install skills from external ecosystems
@jiumate/software-development 2 skills  SE workflow + design language
@jiumate/use-bento-slides    1 skill    .bento.html slides
@jiumate/use-claude-code     1 skill    remote SSH Claude Code
@jiumate/use-firecrawl       1 skill    search / scrape
```

No plugin **adds a tool** — they all extend behavior via Skill (LLM-side) and Hook (subprocess-side). **No scaffolder / generator** (`pnpm create-plugin` does not exist).

## packages/desktop

Electron 43. Three-platform packaging (mac / win / linux). macOS Developer ID + notarization; Windows Authenticode via EVSign with `verifyUpdateCodeSignature`. **Linux AppImage is unsigned; no apt channel.** `electron-updater` talks to GitHub Releases; first check at 20 seconds, then every 6 hours. The server runs in an Electron `utilityProcess`; **no renderer IPC bridge** (the window is a pure browser, everything is HTTP); **no tray icon, no system notifications, no crash reporting.**

## Public sites / repo engineering

- **Landing** (`packages/landing`) — 11 sections, bilingual; Playwright uses a mock LLM to capture 12 product screenshots.
- **Docs** (`packages/docs`) — 24 slugs × 2 languages = 48 files; four sidebar sections (start, guides, design, reference); Ctrl/Cmd+K full-text search, copy-Markdown button; **no version switcher, no auto-generated API page, no RSS, no per-post og:image, no analytics.**
- Both deployed to GitHub Pages on the custom apex `jiumate.ooo`.

CI is multi-shard and multi-platform (`ci.yml`), with separate `desktop-build.yml` for signing and `release.yml` for publishing. `pages.yml` deploys the public sites. **No CODEOWNERS, no Dependabot, no `gitleaks`, no SBOM.** Apache-2.0 LICENSE plus per-package copy at publish. SECURITY.md, CONTRIBUTING.md, ISSUE templates, Discord link.