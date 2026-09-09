---
title: Gap analysis and priority recommendations
description: The capability gaps we have identified (A–F) and a T-shirt-sized priority list. Items we have committed to flow through to capability-decisions.
---

This page lists the gaps we have identified against the workloads a local-first multi-agent platform is expected to carry, plus a priority list with **T-shirt sizing**:

- **S** = hours
- **M** = 1–3 days
- **L** = 1–3 weeks
- **XL** = 1 month+

Gaps we have committed to flow through to [capability-decisions](/capability-decisions), which is the authoritative record.

## A. User experience (Web + Desktop)

| Gap | Impact | Suggested fix |
|---|---|---|
| No virtual lists | Long chat / long session list / long model catalog grow the DOM unboundedly. | Add `@tanstack/react-virtual` to message, session, model, benchmark case lists. |
| No PWA / offline | The web app cannot be installed as a PWA, no offline cache, no install prompt. | `vite-plugin-pwa` + manifest + selective workbox caching. |
| No voice input | Chat composer lacks a voice modality. | `MediaRecorder` + ASR via a Skill (cheapest path: reuse `use-claude-code` patterns). |
| No SKILL.md editor | Skills can only be edited via ZIP round-trip or a chat-install prompt. | Markdown editor + live frontmatter parser in the Skills tab. |
| No standalone trace browser | Cross-session trace browsing only via import. | Restore the old `/traces` page (most components in `trace-panel` survive). |
| No A/B prompt testing | Eval is read-only. | Eval page: prompt diff + score delta view; underlying primitive is two-trace compare. |
| No customizable shortcuts | Keyboard shortcuts are fixed. | Editable key bindings. |

## B. Security, multi-user, compliance

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

## C. SDK / engine

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

## D. CLI

| Gap | Suggested fix |
|---|---|
| No tab completion, no history file | `node:readline` completer API + `node:fs` for history. |
| No OAuth / SSO | Sync with the server work. |
| No pipeline / DAG orchestration | `linsight pipeline` (DAG of tasks). |

## E. Data, deploy, docs

| Gap | Suggested fix |
|---|---|
| Docs have no version switcher | Pre-1.0 — defer, but record as a 1.0 blocker. |
| Docs have no auto-generated API page | Vite plugin over the existing server OpenAPI; or migrate to a docs generator. |
| No RSS, no per-post og:image, no analytics | Landing-site additions. |
| No per-session quota or spend alert | Server-side scheduler + webhook / email / IM delivery. |

## F. Engineering (cheap and high-leverage)

1. `CODEOWNERS` — one entry per package.
2. `dependabot.yml` — weekly pnpm-upgrade PRs.
3. `gitleaks` action — block secrets in git history and PRs.
4. SBOM (`cyclonedx-bom` in the release workflow) — enterprise audit.
5. Visual regression — Chromatic or self-hosted screenshot diff.

## Priority recommendations

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