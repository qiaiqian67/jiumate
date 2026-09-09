# MiniMax M3 gains a second preset row for the vendor's Anthropic-protocol surface

- **Date:** 2026-09-07
- **Type:** feature
- **Scope:** `core`, `web`, `server`, `docs`

[中文版](2026-09-07-minimax-anthropic-m3.zh.md)

MiniMax exposes its M3 model behind two protocol surfaces. The existing preset row reaches it through the vendor's Responses API at `https://api.minimax.io/v1`; this release adds a second row that reaches the same model through MiniMax's Anthropic-protocol endpoint at `https://api.minimax.cn/anthropic/v1/messages`, so the Web Models page now lists two side-by-side `MiniMax-M3` entries — one Responses, one Anthropic Messages — billed at MiniMax's single published rate card (cache read 0.06 / input 0.30 / output 1.20 USD per million tokens, standard tier at 512K input or below). Both rows read the same `MINIMAX_API_KEY`; picking one over the other is a protocol choice, not a billing choice.

The new row pins a fresh client type `minimax-ant-messages` so the env-fallback resolves to `MINIMAX_*` (the credential belongs to MiniMax, not Anthropic). The `resolveModelEnv` function learns a new exact-equal branch that fires before the generic `ant-messages` substring match; without it the new row would silently pick up `ANTHROPIC_*`, breaking the catalog invariant `provider.envKey === resolveModelEnv(model_id, client_type).envKey`.

## Details

- New catalog entry, `provider = "minimax"`, `model_id = "MiniMax-M3-Anthropic"`, `client_type = "minimax-ant-messages"`, `base_url = "https://api.minimax.cn/anthropic"`, identical context window (1,000,000) and vision support as the Responses row, identical three-bucket pricing.
- New `MINIMAX_ANT_BASE_URL` constant in `model-catalog.ts` alongside the existing `MINIMAX_BASE_URL`, so both base URLs are named module-level values rather than string literals inlined into the row.
- The `minimax` provider block keeps a single `envKey: "MINIMAX_API_KEY"` and a single `apiKeyUrl`; the group now exposes two protocol surfaces against the same billing, which is noted in the inline comment.
- `resolveModelEnv("MiniMax-M3-Anthropic", "minimax-ant-messages")` returns `MINIMAX_API_KEY` / `MINIMAX_BASE_URL`. The existing `minimax-m3` exact-equal arm is unchanged, and the generic `ant-messages` arm continues to return `ANTHROPIC_*` for any other client type.
- `canonicalClientType` and `fastModeProtocol` need no change. The former passes `minimax-ant-messages` through unchanged; the latter's `t.includes("ant-messages")` substring already classifies the new id as the Anthropic protocol (`fast_mode` would send `speed: "fast"` plus the `fast-mode-2026-02-01` beta header).
- `protocol-path.ts` needs no change. The existing `if (t.includes("ant-messages")) return "/v1/messages";` substring branch matches `minimax-ant-messages` and returns the correct path.
- The new row is automatically picked up by `presetModelEntries`, the server's `GET /api/projects/:id/models` paired-ref list, the catalog-invariant test in `model-catalog.test.ts`, and `modelHomepageUrl` (which falls through to the shared `https://platform.minimax.io/docs/guides/models-intro` link).
- Documentation updates: a new row in the built-in provider groups table of `models.en.md` / `models.zh.md`, a new entry in the unified-llm-api skill's MiniMax M3 id table, and the addition of `MINIMAX` (plus `ZAI` and `MOONSHOT` for parity) to the env-var regex in `plugins/agent-development/skills/linsight-sdk/SKILL.md`.
- No e2e test was run against MiniMax's real Anthropic-protocol endpoint — that needs a real API key and is out of scope for this PR. The harness layer is covered by the catalog / web / server test suites; a real-key smoke test is a follow-up.