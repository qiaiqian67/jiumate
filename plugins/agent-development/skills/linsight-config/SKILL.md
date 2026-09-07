---
name: linsight-config
description: Manage model API keys, default models and per-agent vault secrets with the linsight CLI.
---

# Linsight Config (CLI)

The `linsight` CLI manages model credentials, default models and per-agent vault secrets. Its primary job is model configuration: `linsight config model add` registers a model and `linsight config model list` shows the models currently available. Configuration goes through the CLI only — never read or hand-edit the underlying hidden files.

## Before you start

If the user's message only invokes this skill (e.g. "use linsight-cli skill") without a concrete request, ask the user what they want to configure. Do not run any command until the goal is clear.

## Models

Add or update a model (upsert by the `(provider, model_id)` pair; re-run with more options to amend an entry):

```bash
linsight config model add --provider <group> --model-id <upstream_id> [--api-key <key>] [--base-url <url>] \
  [--client-type <type>] [--context-window <n>] [--max-tokens <n>] [--vision | --no-vision] \
  [--price-cache-read <n>] [--price-cache-write <n>] [--price-output <n>] \
  [--project-id <id>] [--root <dir>] [--set-default]
```

- A model is identified by the `(provider, model_id)` pair, so `--provider` and `--model-id` are **both required** — the group is never inferred from the model id, because gateways resell vendor models under their upstream ids and a wrong guess would send the key to another vendor's endpoint. `--model-id` takes the provider's upstream model id (what the API expects) and is persisted as the entry's request id, so it reaches the API unchanged; `--provider` names the group (`deepseek`, `openai`, `anthropic`, `google`, `openrouter`, `siliconflow`, … — `custom` for any other endpoint).
- For any OpenAI chat-completion compatible endpoint use `--client-type openai --base-url <endpoint>`; omit `--client-type` to auto-route by model id.
- Prices are USD per million tokens (cache read / cache write / output).
- `--vision` / `--no-vision` mark whether the model accepts images; omitting both keeps the current value (default is vision-capable).
- `--max-tokens <n>` pins a per-model output cap (positive integer), overriding the Agent's `model.max_tokens`; omit to inherit. Lower it for small-context models — the per-Agent default (32000) cannot fit into e.g. a 32k context window together with any prompt.
- All `linsight config model ...` and `linsight config vault ...` commands accept `--root <dir>` to target another data root (default `LINSIGHT_HOME`, then `~/.linsight/data`). Two configuration targets — treat the difference as a hard rule:
  - **Linsight's own model** (self-configuration: the model Linsight itself runs on): the default root without `--root` is correct.
  - **An AI app you are building**: `--root` **must** point at the app's own data directory inside the project (e.g. `--root ./linsight_data`, the same path the app gives `createAgent({ root })`) unless the user explicitly chose another location — never write an app's models or keys into the global `~/.linsight/data`, which belongs to the person running Linsight, not to the app.
  - While developing an app, review regularly: `linsight config model list --root <app root>` should show the app's entries, and the global list (no `--root`) should stay clean.

Other model commands:

```bash
linsight config model default --model-id <upstream_id> --provider <group> [--root <dir>]   # set the project default model
linsight config model vision --model-id <upstream_id> --provider <group> [--root <dir>]    # set the project vision model (reads images for text-only sessions)
linsight config model list [--root <dir>]                      # list models; api_key is shown masked
```

## Vault (per-agent secrets)

The vault holds an agent's environment-variable secrets (third-party API keys etc.); values are injected into that agent's shell subprocesses:

```bash
linsight config vault set --key <NAME> --value <value> [--project-id <id>] [--agent-id <id>] [--root <dir>]
linsight config vault list [--project-id <id>] [--agent-id <id>] [--root <dir>]      # values are shown masked
linsight config vault remove --key <NAME> [--project-id <id>] [--agent-id <id>] [--root <dir>]
```

- `--project-id` defaults to `default_project`, `--agent-id` to `default_agent`.
- Key names follow shell variable rules (letter or underscore first, then letters, digits and underscores); values are limited to 8192 characters.

## Language

```bash
linsight config lang <en|zh>   # persist the CLI language via LINSIGHT_LANG in your shell rc
```

## Running agents

`linsight run -m "<task>" [--provider <group> --model-id <id>] [--agent-id <id>] [--workspace <path>] [--approve <mode>]` runs one task; `linsight chat [--resume [session_id]]` starts or resumes an interactive chat with the same options. The model reference stays a pair here too: pass `--provider` and `--model-id` together, or neither to run on the project's default model — one without the other is rejected.

## Storage

Paths use `<app_data_dir>`, the App Data Dir value from your Environment section.

- `<app_data_dir>/.project_config.toml` — the project's single hidden config file: model list, settings and per-model credentials (`api_key` etc. inlined in each model entry). Configuration is CLI-only — never read, print or hand-edit this file.
- `<app_data_dir>/agents/<agent_id>/agent_state/.vault.toml` — that agent's vault entries, hidden file; same rule, manage it with `linsight config vault`.
