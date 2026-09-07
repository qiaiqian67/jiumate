---
title: Capability matrix and roadmap
description: What the platform does today, what it does not, and the gaps we plan to close. The decision table at the bottom is the canonical record of which gaps we have agreed to take on.
---

This page is the canonical inventory of Linsight's current capabilities and the gaps we have identified against the workloads a local-first multi-agent platform is expected to serve. It is a living document: the **Decision log** at the bottom records each gap's disposition, and the **Capability inventory** and **Gap analysis** sections above it are updated whenever that log changes. Treat the inventory as "shipped today" and the gap analysis as "known and queued for triage."

## Methodology

The inventory and gap analysis below were compiled by reading the implementation source directly, layer by layer:

- `packages/core` — the SDK and execution engine
- `packages/server` — the HTTP API, SSE streaming, scheduler, persistence
- `packages/web` — the React 19 SPA
- `packages/cli` — the `linsight` command and its subcommands
- `plugins/*` — the twelve shipped plugin packages
- `packages/desktop` — the Electron shell
- `packages/landing`, `packages/docs` — the public sites
- `.github/` — CI, release, security policy

Each item below is annotated with the file path that backs it. If a path is wrong or the file has changed, treat the corresponding claim as wrong — the inventory is only as good as the paths it cites.

---

## Capability inventory

### Core SDK — `packages/core` (v0.2.9)

| Area | Status | Where |
|---|---|---|
| Agent loop | Single-stream ReAct with **concurrent tool execution**; approvals are serial; subagents are capped at one level (`MAX_SUBAGENT_DEPTH = 1`). | `engine/context-engine.ts` |
| Streaming | The only output mode; `partial_*` deltas live, full `model_msg` back-filled at segment end. | `llm/generative-model.ts` |
| LLM abstraction | All providers routed via `@prismshadow/agenthub`; tool calling, vision, inline thinking, prompt caching, per-request thinking level, fast mode all supported. | `interfaces/llm.ts:137` |
| Retry classification | Four fatal classes only (auth, 4xx, fast-mode-unsupported, assembly failure); everything else is retryable. `maxReconnects = 5`, `maxTurnAttempts = 20`. | `context-engine.ts:427` |
| Tools | Nine built-in (read, write, edit, shell, input-shell, two subagent tools, two image tools). **No built-in web fetch / git / grep.** | `environment/tools/registry.ts:37` |
| OmniMessage protocol | Seven payload types plus nine event types. Square-bracket marker form (`[tag]…[/tag]`) is canonical; angle-bracket form is accepted indefinitely. | `omnimessage/types.ts`, `markers/` |
| Trace | Append-only JSONL with a single `write(2)` under `O_APPEND`. Records `request_begin/end`, `token_usage`, `subagent`, `approval_decision`, `compaction_begin/end`, `hook`, `mcp_connect_begin/end`. **No structured query, no remote sink, no size or count rotation, no compression.** | `trace/writer.ts:207` |
| Sandboxing | `command_policy` blocks a small deny list of `rm -rf`, `mkfs`, etc. **No OS-level sandbox.** Absolute paths allowed; symlinks followed. | `internal/command-policy.ts` |
| Plugins | npm packages with `plugin.json`, `skills/<name>/SKILL.md`, `hooks/*.mjs` (plain Node subprocesses, JSON on stdin/stdout). **No marketplace, no signing, no hot install.** | `plugins/index.ts` |
| Public API | Seven sub-path entries plus the main barrel, exporting `Agent`, `Session`, `ContextEngine`, the placeholders, `GenerativeModel`, `Environment`, `Writer`, the hooks, the marker parsers. | `index.ts` |
| i18n | No runtime i18n at the core layer. `error_message` stays English on purpose; the Web translates from `error_code`. | — |

### Server — `packages/server` (Hono 4 + `node:sqlite` + `ws`, ~50k LOC, 121 test files / 44k lines)

The runtime shell (`createRuntimeApp`, `bootAppDeps`) is split from the platform surface (`buildAppDeps`, `createApp` at `app.ts:1120-1256`). Almost every business route lives in the platform and can be replaced wholesale via a signed gzip push to `POST /api/hmr/upgrade`; only `/api/auth`, `/api/desktop`, `/api/hmr`, and static hosting stay runtime-owned.

| Area | Status | Where |
|---|---|---|
| HTTP routes | ~200 endpoints, mounted at `app.ts:465-492` (runtime) and `app.ts:1154-1256` (platform). Notable subtrees: `/api/projects/:p/...`, `/api/projects/:p/agents/:a/...`, `/api/sessions/:id/...` (40+ subroutes, the largest file `sessions.ts` at 1395 lines), `/api/sessions/:id/messaging/{feishu,telegram,qq,wechat}/...`, `/api/terminals/...`, `/preview/:token/*`. Validation is hand-rolled (`http/validate.ts`); **no OpenAPI schema, no API versioning, no `HEAD`/`OPTIONS` handling.** | `app.ts` |
| Auth model | Single-tenant, single-admin, two-role ACL (owner/member) plus admin. Cookie `linsight_session` (HttpOnly, SameSite=Lax, 30-day sliding). `<root>/api-token` minted fresh every boot, Bearer = admin-equivalent. | `auth/service.ts`, `auth/api-token.ts` |
| First-login claim | Random 144-bit password generated, hashed, and discarded. A first-login link is printed at boot (30-day TTL). `/api/auth/claim` compares the token verbatim. | `auth/service.ts:44,129` |
| Projects | `project_id` is the directory name and is immutable; only the display name is editable. Non-admin ids must be `<userId>-` prefixed. **No soft-delete, no archive, no transfer-ownership.** | `project-service.ts:158-175` |
| Agents | Full filesystem-backed config under `system_config.yaml` + `AGENTS.md`. Members can rewrite both. tar.gz export/import with explicit overwrite flag. | `agent-service.ts:445` |
| Skills / Plugins | ZIP upload/download; `assertSafeEntryPath` blocks zip-slip; `MAX_ARCHIVE_BYTES = 14MB` plus per-file and total caps. **Replace semantics with explicit `overwrite` flag. Member-writable. No signing, no virus scanning.** | `skills.ts:46-56` |
| Models | `PUT /models` is a whole-table declarative replace. Live probes `/test`, `/detect`, `/list`, `/detect-vision`. OAuth via `/model-oauth/*` (PKCE server-side). **No ETag / If-Match — last write wins.** | `models.ts:225-329` |
| LLM path | **No proxy.** The server runs `createCoreSessionLoader` → `createAgent` in-process. Credentials live in `.project_config.toml` per project (0600, plaintext), owner-only writes. `modelConfigChanged` invalidates runtime caches, broadcasts `credentials_updated` on every channel, and fires remote-machine sync. | `runtime/session-manager.ts:224` |
| SSE / realtime | `/api/sessions/:id/stream` and `/api/events`, both over `Channel`. Event id `<epoch>-<seq>` (8-char epoch per process). Ring buffer 10k / 8MB. `Last-Event-ID` hit replays; miss unicasts `resync_required`. `: ping` every 20 s. First event is always an authoritative `task_state` plus replay of all pending approvals. Tasks return 202 and run decoupled from the SSE — closing the tab does not stop the run. | `sse.ts`, `channel.ts` |
| Persistence | `node:sqlite` `DatabaseSync`, WAL + FK + `busy_timeout=5000`. Sixteen tables: `users`, `auth_sessions`, `projects`, `project_members`, `agents`, `sessions`, `usage_records`, `error_records`, `schedule_state`, `messaging_bindings`, `ui_prefs`, `server_settings`, `machine`, `machines`, `machine_project`, `trace_files`, `trace_sessions`. **Only `error_records` has a 20k-row cap with periodic prune; `usage_records` grows unbounded; no FK on most user-facing tables.** | `schema.ts`, `database.ts:49` |
| Migrations | `PRAGMA user_version`-stamped, contiguous, frozen DDL, `BEGIN/COMMIT` + rollback per step, `swapSafe` flag. Non-swap-safe migrations throw `RestartRequiredError` on the hot-push path rather than half-applying. Currently four. | `db/migrations.ts` |
| Usage / billing | `token_usage` events → one `usage_records` row per request. **Cost is computed at query time, never stored.** Peak/off-peak tier support. Group by `date|agent|model|session`, granularity `minute|hour|day|week|month` with zero-filled series. Sub-agent spend attributed to the parent via `origin_session_id`. **No invoicing, no budgets, no quotas, no spend alerts.** | `services/usage-service.ts` |
| Scheduler | In-process, 30 s tick. Schedules are declarative TOML files the system never writes back; runtime state is in `schedule_state`. **No backfill, queue-when-busy, mtime-gated scan, no cron expression support, no jitter, no retry/backoff on a failed firing.** `POST /:id/retry-now` forces one. | `runtime/scheduler.ts` |
| Background loops | Channel sweep, 30-min idle runtime sweep (`unref`'d), TTL-cached `UpdateCheckService`, background `UpdateJob` (readable via `GET /api/version/update`), machine SSH lanes and tunnels, messaging long-lived connections, startup `adoptUnmanagedTraceSessions`. | — |
| Vault / secrets | `<agent>/.vault.toml` 0600. Key names shell-env-shaped, values capped at 8192 bytes (Linux `E2BIG` ceiling). **Plaintext at rest by design. No KMS, no rotation. Model sees key names only.** | `state/agent-vault.ts:107` |
| File upload | Request body limit **derived per request from the admin attachment budget** — measured (chunked-safe), not header-read. Defaults: 100 MB per file, 120 MB per request, 1–200 MB admin range. `INLINE_IMAGE_MAX_MB` separate (base64 inflates 4/3 into trace JSONL). zip-slip + `realpath` double guard. | `attachment-limits.ts`, `workspace-files-service.ts` |
| Same-origin XSS | Workspace file reads get `nosniff` + `Cache-Control: no-store`. Inline HTML downgraded to `text/plain`. `?preview=1` served under `CSP: sandbox` (no `allow-same-origin`). SVG keeps `image/svg+xml` (so `<img>` renders) and gets `CSP: sandbox` (so direct navigation is inert). `?preview-redirect` mints a signed token and 302s to a separate preview origin. The preview hostname serves only `/preview/*`; `/api` there hard-401s and never honors a cookie. Preview tokens are host-bound with TTL. | `sessions.ts:1211-1257`, `preview.ts` |
| i18n | English only on the server, by design. The contract is the `error.code`, not the message. The Web translates from a hand-maintained `S.errors.byCode` table. **No `Accept-Language` handling. No compile-time or test link between server codes and the frontend table** — a new or renamed code silently degrades to raw English. | `http/errors.ts:121-127` |
| Tests | 121 vitest files / 44k lines. `TEST_PASSWORD_HASH_COST = 2` (lowest legal scrypt) to keep the suite fast; production strength is asserted separately. E2E in `packages/web/e2e/` (31 Playwright specs + mock LLM). **No load/soak, no fuzzing, no coverage threshold, no contract test tying server codes to the frontend table.** | `test/helpers.ts` |
| Production hardening | Strong: per-request derived body limit, separate preview origin, `LINSIGHT_TRUST_PROXY=1` opt-in, 127.0.0.1 default bind, `0600` + `O_EXCL|O_NOFOLLOW` secret files, `timingSafeEqual` for tokens and passwords, single-instance lock with both pid-alive and port-listening signals. **Missing: rate limiting outside login, audit log, CORS, global security headers, request id, structured logging, SSRF protection on owner-supplied endpoints, optimistic concurrency, member-role narrowing.** | `app.ts`, `lock.ts`, `auth/middleware.ts` |

### Web — `packages/web` (React 19 + Vite 7 + Tailwind 4)

| Area | Status | Where |
|---|---|---|
| Routes | Nine main routes plus a full-window terminal. Nine-tab agent settings. **No route-level code splitting.** | `router.tsx` |
| Chat UI | Complete: markdown + Shiki + KaTeX + xterm, file/image drop, nine tool cards, subagent topology graph, context donut, conversation outline, `/compact`, `/agent` and `/model` switch commands. | `features/chat/*` |
| Virtual lists | **None.** Long chat transcripts grow the DOM unboundedly. | — |
| Agent management | Nine tabs (Overview, System Prompt, Runtime, Tools, MCP, Skills, Hooks, Memory, Vault, Schedule). Placeholder insert chips. | `features/agents/agent-settings-page.tsx` |
| SKILL.md editor | **None.** Skills round-trip only via ZIP upload / download or the chat-install prompt. | `features/agents/skills-tab.tsx` |
| Model management | 170 KB `models-page.tsx`. Grouped by vendor, masked credentials, OAuth supported. **No per-key rotation UI.** | `features/models/models-page.tsx` |
| Trace viewer | Embedded in the chat dock tab. CUDA-style swimlane timeline. **No standalone cross-session trace browser page.** | `features/traces/trace-panel.tsx` |
| Eval | Read-only scoreboard. **No A/B prompt diff, no in-UI scoring edits.** | `features/benchmark/benchmark-page.tsx` |
| Settings | Modal. Language (zh / en / follow), theme (light / dark / follow), font scale, accent, terminal theme, currency. Admin: user management, proxy, uploads, trace import. | `features/settings/*` |
| i18n | Bilingual, **type-system enforced** (`placeholders-parity.test.ts`). Hard-coded JSX literals are not parity-audited. | `lib/strings.ts` (2451 lines) + `strings-en.ts` (2497 lines) |
| State management | Zustand + hand-rolled fetch. **No React Query / SWR** — navigating away and back re-fetches. | — |
| Accessibility | Full keyboard, ARIA, Esc-layer stack, tone system. **No explicit focus trap in modals** (Esc-only dismissal). | `components/ui/modal.tsx` |
| PWA | **None.** No service worker, manifest, `beforeinstallprompt`, or offline mode. | — |
| Voice input | **None.** | — |
| Tests | 118 unit + 31 Playwright e2e. **No visual regression.** | `test/`, `e2e/` |

### CLI — `@prismshadow/linsight-cli`

Twenty-eight subcommands across `auth`, `config`, `run`, `chat`, `ls`, `logs`, `input`, `agent`, `project`, `cost`, `schedule`, `server`, `web`, `update`, `version`. Persistent `node:readline` with bracketed-paste handling and `\` line-continuation; `/exit`, `/clear`, `/compact`, `/goal[:budget]`, `/thinking`, `/verbose`. **`--json` on every read command for scripting; `--background` and `--timeout 0` for non-blocking use.** Connection resolution: explicit `--server` env > live `<root>/server.lock` > auto-spawn detached server. Login backoff re-reads `<root>/api-token` on a 401. **No tab completion, no saved history file, no OAuth/SSO.**

### Plugins (12 packages)

```
@linsight/agent-development   4 skills   LLM/config/orchestration/SDK
@linsight/agent-tuning        4 skills   init/benchmark/eval/optimize
@linsight/continual-learning  1 hook     stop:提炼 30-turn 之后的发现成 skill
@linsight/data-analysis       1 skill
@linsight/goal                2 hooks    user_prompt + stop:`/goal` 后端
@linsight/humanizer           1 skill    3-layer 去 AI 痕迹
@linsight/model-development   3 skills   llamafactory / ollama / vllm
@linsight/skill-porting       1 skill    从外部生态安装 skill
@linsight/software-development 2 skills  SE 工作流 + 设计语言
@linsight/use-bento-slides    1 skill    .bento.html 幻灯片
@linsight/use-claude-code     1 skill    远程 SSH 跑 Claude Code
@linsight/use-firecrawl       1 skill    搜索 / 抓取
```

No plugin ships a new tool. They extend behaviour via Skills (LLM-side) and Hooks (subprocess-side). **No scaffolding / generator** (`pnpm create-plugin` does not exist).

### Desktop — `packages/desktop` (Electron 43)

Three-platform packaging (mac / win / linux). macOS Developer ID + notarization; Windows Authenticode via EVSign with `verifyUpdateCodeSignature`. **Linux AppImage unsigned, no apt channel.** `electron-updater` against GitHub Releases; first check at 20 s, then every 6 h. Server runs in an Electron `utilityProcess`; **no renderer IPC bridge** (the window is a plain browser; everything flows over HTTP). **No tray icon, no system notifications, no crash reporter.**

### Public sites

- **Landing** (`packages/landing`) — eleven sections, bilingual. Playwright captures twelve product shots against a mock LLM.
- **Docs** (`packages/docs`) — 24 slugs × 2 languages = 48 files. Four sidebar sections (start, guides, design, reference). Ctrl/Cmd+K full-text search, copy-Markdown button. **No version switcher, no auto-generated API page, no RSS, no per-post og:image, no analytics.**
- Both deployed to GitHub Pages on the custom apex `linsight.ooo`.

### Repo engineering

CI is multi-shard and multi-platform (`ci.yml`), with separate `desktop-build.yml` for signing and `release.yml` for publishing. `pages.yml` deploys the public sites. **No CODEOWNERS, no Dependabot, no `gitleaks`, no SBOM.** Apache-2.0 LICENSE plus per-package copy at publish. SECURITY.md, CONTRIBUTING.md, ISSUE templates, Discord link.

---

## Gap analysis

### A. User experience (Web + Desktop)

| Gap | Impact | Suggested fix |
|---|---|---|
| No virtual lists | Long chat / long session list / long model catalog grow the DOM unboundedly. | Add `@tanstack/react-virtual` to message, session, model, benchmark case lists. |
| No PWA / offline | The web app cannot be installed as a PWA, no offline cache, no install prompt. | `vite-plugin-pwa` + manifest + selective workbox caching. |
| No voice input | Chat composer lacks a voice modality. | `MediaRecorder` + ASR via a Skill (cheapest path: reuse `use-claude-code` patterns). |
| No SKILL.md editor | Skills can only be edited via ZIP round-trip or a chat-install prompt. | Markdown editor + live frontmatter parser in the Skills tab. |
| No standalone trace browser | Cross-session trace browsing only via import. | Restore the old `/traces` page (most components in `trace-panel` survive). |
| No A/B prompt testing | Eval is read-only. | Eval page: prompt diff + score delta view; underlying primitive is two-trace compare. |
| No customizable shortcuts | Keyboard shortcuts are fixed. | Editable key bindings. |

### B. Security, multi-user, compliance

Ranked by server-side severity:

1. **No rate limiting outside login** — one authenticated member can exhaust LLM spend, CPU, or disk.
2. **No audit log** — vault writes, model-key changes, user creation, platform pushes, project deletes leave no trace.
3. **No CORS or global security-header policy** — safe only because nothing sets `Access-Control-Allow-Origin` today.
4. **CSRF rests entirely on `SameSite=Lax` + Content-Type** — no token, no Origin check.
5. **Secrets plaintext at rest**, and `<root>/api-token` is admin-equivalent — the entire security boundary is the server's OS account.
6. **No request id or structured logging** — incidents cannot be reconstructed from `METHOD path status ms`.
7. **SSRF on owner-supplied model and MCP endpoints** — `isHttpUrl` is a scheme check, not an allowlist; no private-IP / metadata-endpoint block.
8. **Single-node by construction** — instance lock, in-process scheduler, in-memory channels; no horizontal scaling path.
9. **No optimistic concurrency on any config PUT** — concurrent editors clobber silently.
10. **Member role is very broad** — a member can rewrite agent config, install skills, and read/write every session workspace in the project.

| Gap | Suggested fix |
|---|---|
| No SSO / OAuth | `/api/auth/sso/*` + provider registry (OIDC / SAML / Google / Feishu). Vault already manages secrets; scope can reuse. |
| No CODEOWNERS / Dependabot / gitleaks / SBOM | GitHub config files, one day of work. |

### C. SDK / engine

| Gap | Suggested fix |
|---|---|
| No Plan-Execute mode | Add a Plan mode; plan is written to trace, exec reuses ReAct. |
| No multi-level subagents | Add a depth field (`origin` already supports a chain). |
| No built-in web / git / grep tools | Add `web_fetch` / `git_*` / `grep` / `glob` to core. `use-firecrawl` already establishes a generic contract. |
| No structured outputs / `response_format` | Add `responseFormat` to `GenerativeModelParameters`; AgentHub already supports most providers. |
| No audio protocol payload | Add `AudioUrlPayload` / `InlineAudioPayload`, mirroring the image protocol. |
| Trace has no structured query layer | Materialise a `TraceIndex` (SQLite) or use DuckDB over JSONL. |
| Trace has no size / count rotation, no compression | Add zstd + weekly rotation. |
| No plugin marketplace or signing | Signed manifest + install-time SHA-256 verification. |

### D. CLI

| Gap | Suggested fix |
|---|---|
| No tab completion, no history file | `node:readline` completer API + `node:fs` for history. |
| No OAuth / SSO | Sync with the server work. |
| No pipeline / DAG orchestration | `linsight pipeline` (DAG of tasks). |

### E. Data, deploy, docs

| Gap | Suggested fix |
|---|---|
| Docs have no version switcher | Pre-1.0 — defer, but record as a 1.0 blocker. |
| Docs have no auto-generated API page | Vite plugin over the existing server OpenAPI; or migrate to a docs generator. |
| No RSS, no per-post og:image, no analytics | Landing-site additions. |
| No per-session quota or spend alert | Server-side scheduler + webhook / email / IM delivery. |

### F. Engineering (cheap and high-leverage)

1. `CODEOWNERS` — one entry per package.
2. `dependabot.yml` — weekly pnpm-upgrade PRs.
3. `gitleaks` action — block secrets in git history and PRs.
4. SBOM (`cyclonedx-bom` in the release workflow) — enterprise audit.
5. Visual regression — Chromatic or self-hosted screenshot diff.

---

## Priority recommendations

Sizes are T-shirt: **S** = hours, **M** = 1–3 days, **L** = 1–3 weeks, **XL** = 1 month+.

| Priority | Item | Size | Note |
|---|---|---|---|
| P0 | Engineering quartet (CODEOWNERS + Dependabot + gitleaks + SBOM) | S (1 day total) | Security and compliance baseline. |
| P0 | Web virtual lists (`@tanstack/react-virtual`) | M | The single biggest UX gap. |
| P0 | Server global rate limiting + global audit log | M | Multi-user deploy prerequisite; spend risk. |
| P1 | Docs version switcher + auto-gen API page | L | Required before 1.0 ships. |
| P1 | Server CSRF token + Origin check + global security headers | S | A handful of middlewares. |
| P1 | Core: Plan mode + multi-level subagent + generic web/git/grep tools | XL | The "chat → agent" upgrade. |
| P1 | Server SSO / OAuth (provider registry) | L | Enterprise deploy prerequisite. |
| P2 | PWA / offline mode | M | Installability. |
| P2 | Plugin marketplace + signing | L | Ecosystem open. |
| P2 | SKILL.md editor / voice input / standalone trace browser | M | UX polish. |
| P2 | Server optimistic concurrency + member role narrowing | M | Multi-editor / multi-user. |
| P3 | Desktop tray + notifications + crash reporter | M | Desktop UX. |
| P3 | CLI tab completion + history + OAuth | S | Single-PR changes. |
| P3 | Docs auto-gen API + RSS + per-post og:image | M | SEO + community reach. |

---

## Decision log

The table below is the canonical record of which gaps we have agreed to take on. Update it when a decision is made; the changelog entry for the work refers back to this table by row.

| # | Gap | Owner | Target version | Status | Notes |
|---|---|---|---|---|---|
| 1 | | | | pending | |
| 2 | | | | pending | |
| 3 | | | | pending | |
| 4 | | | | pending | |
| 5 | | | | pending | |
| 6 | | | | pending | |
| 7 | | | | pending | |
| 8 | | | | pending | |
| 9 | | | | pending | |
| 10 | | | | pending | |

A row's `Status` moves `pending → accepted → in-progress → shipped` (or `deferred` / `rejected` with a one-line reason). The "Target version" column is the release the work is committed for; release branches refer back to this table.

## Update log

- 2026-09-07 — initial inventory and gap analysis compiled from a fresh source read across all packages.