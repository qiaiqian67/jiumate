<p align="center">
  <img src="packages/landing/public/linsight-logo.svg" alt="Linsight logo" width="88" />
</p>

<h1 align="center">Linsight</h1>

<p align="center"><strong>Open-source, local-first multi-agent app development platform</strong><br />Fully automate <strong>building</strong> · <strong>optimizing</strong> · <strong>deploying</strong> AI applications</p>

<p align="center">
  <a href="https://linsight.ooo/download">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="assets/readme/download-en-dark.svg" />
      <img src="assets/readme/download-en-light.svg" alt="Download App" height="44" />
    </picture>
  </a>
</p>

<p align="center">1000+ Models · Multi-Platform · Apache 2.0 · Agent Self-Evolution</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@prismshadow/linsight-core"><img src="https://img.shields.io/npm/v/@prismshadow/linsight-core" alt="npm version" /></a>
  <a href="https://github.com/Prism-Shadow/linsight/actions/workflows/ci.yml"><img src="https://github.com/Prism-Shadow/linsight/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/Prism-Shadow/linsight/actions/workflows/pages.yml"><img src="https://github.com/Prism-Shadow/linsight/actions/workflows/pages.yml/badge.svg" alt="Deploy Site" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="License: Apache-2.0" /></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A5%2024-brightgreen" alt="Node >= 24" />
</p>

<p align="center">
  <a href="https://linsight.ooo/"><img src="https://img.shields.io/badge/Website-linsight.ooo-1f6feb?logo=googlechrome&logoColor=white" alt="Website" /></a>
  <a href="https://linsight.ooo/docs/"><img src="https://img.shields.io/badge/Docs-linsight.ooo%2Fdocs-1f6feb?logo=readthedocs&logoColor=white" alt="Docs" /></a>
  <a href="https://linsight.ooo/blog"><img src="https://img.shields.io/badge/Blog-linsight.ooo%2Fblog-1f6feb?logo=rss&logoColor=white" alt="Blog" /></a>
</p>

<p align="center">
  <a href="https://discord.gg/eFHKqqcU3D"><img src="https://img.shields.io/badge/Discord-join%20chat-5865F2?logo=discord&logoColor=white" alt="Discord" /></a>
  <a href="https://x.com/code_hiyouga"><img src="https://img.shields.io/badge/X-code%5Fhiyouga-000000?logo=x&logoColor=white" alt="X (Twitter)" /></a>
  <a href="https://github.com/Prism-Shadow/linsight-community/blob/main/wechat/group.jpg"><img src="https://img.shields.io/badge/WeChat-user%20group-07C160?logo=wechat&logoColor=white" alt="WeChat" /></a>
</p>

<p align="center">
  <a href="https://www.producthunt.com/products/linsight?embed=true&amp;utm_source=badge-featured&amp;utm_medium=badge&amp;utm_campaign=badge-linsight" target="_blank" rel="noopener noreferrer"><img alt="Linsight - Let Agents Autonomously Build Better Agents for $0.02 | Product Hunt" width="250" height="54" src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1202577&amp;theme=light&amp;t=1784804711946" /></a>
</p>

<p align="center">English | <a href="README.zh.md">简体中文</a></p>

## Why Linsight

> With LangChain, you build agents by hand — at 1× speed.<br />With Linsight, agents build agents — at 100×.

Linsight runs on your computer or server and automates the agent app lifecycle from creation and evaluation to optimization and deployment. Three reasons define the platform:

### 1. 🏆 Outstanding results at tens of times less cost

A deliberately minimal toolset over clean low-level interfaces: fewer tool calls, fewer tokens — deeply tuned for open models like DeepSeek. Each harness on the model it is normally paired with, same tasks, head-to-head:

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/readme/benchmark-dark.svg" />
    <img src="assets/readme/benchmark-light.svg" alt="Benchmark: Linsight leads the data-analysis suite and ties OpenAI Codex on coding, at a small fraction of both rivals' cost" width="920" />
  </picture>
</p>

**Best accuracy on data analysis — at 1/70 of Claude Code's cost.**

### 2. ⚡ One sentence generates a runnable agent app

Describe what you need in one sentence. Linsight builds the complete agent application — scaffold, code, and run instructions, end to end:

```text
Collect the docs from https://github.com/ericbuess/claude-code-docs and build a RAG app that answers Claude Code questions as a configuration expert, citing its sources.
```

And this is the finished product — a docs expert with retrieval, cited sources that link to the original files, and example questions built in:

https://github.com/user-attachments/assets/9b7033e8-f08a-4c3f-bd33-547896664e6e

**And generating this entire RAG app burned just $0.02 (¥0.2) of tokens — on DeepSeek V4 Pro.**

### 3. 🧬 Native agent self-evolution engine

With Linsight Skills, an agent evaluates and optimizes itself: run the benchmark, find the lost points, ship version N+1 — with a snapshot before every round and every request observable in the Trace view.

https://github.com/user-attachments/assets/922d13a6-5ffc-4685-9a39-352f02f9afc0

## Built-in plugins

Three plugin categories ship in the box ([docs](https://linsight.ooo/docs/skills)) — skills, plus the session hooks that drive goal mode and continual learning; agents can also write and optimize their own skills:

| Category             | Plugins                                                                       |
| -------------------- | ----------------------------------------------------------------------------- |
| Office Productivity  | `data-analysis`, `use-firecrawl`, `use-bento-slides`, `humanizer`, `goal`, `continual-learning` |
| Software Development | `software-development`, `use-claude-code`                              |
| AI App Development   | `agent-development`, `model-development`, `skill-porting`, `agent-tuning`     |

## Supported Models

| Model            | Providers                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| DeepSeek V4      | DeepSeek, OpenRouter, Fireworks AI, SiliconFlow, TokenDance, Qwen Token Plan, Qwen Pay-As-You-Go |
| Kimi K3          | Moonshot AI, OpenRouter, Fireworks AI, TokenDance, Qwen Pay-As-You-Go                            |
| GLM 5.3          | Z.AI, OpenRouter, TokenDance                                                                     |
| Hunyuan 3        | OpenRouter                                                                                       |
| Qwen 3.8 Max     | Qwen Token Plan, Qwen Pay-As-You-Go, OpenRouter, TokenDance                                      |
| GPT 5.6          | OpenAI, OpenRouter                                                                               |
| Gemini 3.7 Flash | Google Gemini, OpenRouter                                                                        |
| Claude 5         | Anthropic, OpenRouter                                                                            |
| Inkling          | OpenRouter, Fireworks AI                                                                         |

Each family's latest generation only — the app's **Models** page lists every built-in preset, and any OpenAI-protocol endpoint works too: pick a preset, or point a custom endpoint at any of the 1000+ online and local models.

## Requirements

| Requirement  | Supported                                                                  |
| ------------ | -------------------------------------------------------------------------- |
| OS           | Linux, macOS, Windows 10+                                                  |
| Architecture | x64, arm64                                                                 |
| Runtime      | bundled by the one-line installer (npm installs need Node >= 24)           |
| Model        | an API key for at least one model                                          |

## Installation

Start with the desktop app, or install the command line on a workstation or server. Both use the same `~/.linsight/data` root and can be mixed freely:

- **🖥️ Desktop app** — a double-click install: it embeds the server and opens already signed in, no terminal involved.
- **⌨️ CLI** — a one-line installer (or npm / offline package) puts the `linsight` command on the machine; `linsight web` then serves the full Web experience in your browser at `http://127.0.0.1:7364` (multi-session chat, agent / skill / model management, usage stats, Trace observability, evaluation center). The online installers bundle their own Node runtime — unpack and run; upgrades and reinstalls never touch your data.

> [!NOTE]
> On a CLI install, the server prints a first-login link as a framed notice on every start until a password is set — open it to claim the built-in `admin` account and choose one. Models are configured on the in-app **Models** page.

### 🖥️ Desktop app

The full Web experience as a standalone application: it embeds the server and opens already signed in — no terminal, no login page, no initial password to copy. It works on the same `~/.linsight/data` root as a CLI install, so the two can be used interchangeably (a data root only ever runs one server; if a CLI-started instance is already up, the app attaches to it).

Download the desktop app from the [download page](https://linsight.ooo/download). The page serves the OSS-accelerated mirror when it is reachable, and every installer is also attached to each [GitHub Release](https://github.com/Prism-Shadow/linsight/releases).

| Platform    | Installers                  |
| ----------- | --------------------------- |
| macOS 11+   | dmg (Apple Silicon / Intel) |
| Windows 10+ | installer (.exe, x64)       |
| Linux (x64) | AppImage / deb              |

The macOS builds are Developer ID signed and notarized, and the Windows installers are Authenticode signed, so neither platform needs a first-launch unblock. Linux is the one exception:

<details>
<summary><b>🐧 Linux: double-clicking the AppImage does nothing</b></summary>

Browsers download AppImages without the execute permission. Grant it once and the app starts normally from then on (the deb package installs through the package manager and is not affected):

```bash
chmod +x linsight-desktop-linux-x86_64.AppImage
```

</details>

### 🐧🍎 Linux / macOS (online install)

```bash
curl -fsSL https://linsight.ooo/install.sh | sh
linsight web        # start the service and open http://127.0.0.1:7364
```

### 🪟 Windows (online install, PowerShell)

```powershell
irm https://linsight.ooo/install.ps1 | iex
linsight web        # start the service and open http://127.0.0.1:7364
```

### 📦 npm (any platform, Node >= 24)

```bash
npm install -g @prismshadow/linsight-cli
linsight web        # start the service and open http://127.0.0.1:7364
```

<details>
<summary><b>📴 Offline install (air-gapped machines)</b></summary>

Every <a href="https://github.com/Prism-Shadow/linsight/releases">GitHub Release</a> attaches exactly one package per target — Linux and macOS in x64 / arm64, Windows in x64, plus a runtime-less universal package — and the same file serves online and offline installation. Each package seals the program payload, its SHA256 checksum and the platform's installer: download the one file on a networked machine, copy it to the target, extract once and run the bundled installer — no network, no separate checksum file to carry (the sealed SHA256 is always verified).

**Linux (on arm64, use `linsight-linux-arm64.tar.gz`):**

```bash
mkdir linsight-install
tar -xzf linsight-linux-x64.tar.gz -C linsight-install
./linsight-install/install.sh
```

**macOS (Apple silicon shown; on Intel, use `linsight-darwin-x64.tar.gz`):**

```bash
mkdir linsight-install
tar -xzf linsight-darwin-arm64.tar.gz -C linsight-install
./linsight-install/install.sh
```

**Windows (unzip, then double-click `install.cmd` — or run it in PowerShell):**

```powershell
Expand-Archive linsight-win32-x64.zip -DestinationPath linsight-install
cd linsight-install
.\install.cmd
```

</details>

### 🤖 CLI & SDK — for agents

The same engine, scriptable — made to be driven by agents (and agents building agents):

```bash
linsight config model add --provider deepseek --model-id deepseek-v4-flash-vision-exp --api-key sk-... --set-default
linsight run -m "Create hello.txt containing Hello, Linsight"   # one-shot task
linsight chat       # interactive REPL (/compact, /clear, /exit, Ctrl-C to interrupt)
linsight server     # headless service (same API the Web App uses)
```

```ts
import { createAgent, isCompleteModelMessage, userText } from "@prismshadow/linsight-core";

const agent = await createAgent({ agentId: "default_agent" });
const session = await agent.createSession({ workspaceDir: process.cwd() });

for await (const output of session.run([userText("Create hello.txt containing hi")], {
  approve: async () => "allow", // per-tool-call approval
})) {
  if (isCompleteModelMessage(output) && output.payload.type === "text") {
    console.log(output.payload.text);
  }
}
```

## Roadmap

- [ ] Public release of the benchmark suite
- [x] Desktop app
- [x] Windows support
- [ ] Agent company and templates
- [ ] Company-level self evolving
- [ ] OpenShell integration (permission-governed shell)
- More to come…

## Development

```bash
pnpm install && pnpm build   # build first: core's exports point at dist/
pnpm dev                     # backend + web app together (prefixed logs, deps built once)
```

See [CONTRIBUTING.md](.github/CONTRIBUTING.md) for the full workspace guide: dev commands, quality gates, repo layout, and the changelog rule.

## Contributors

Thanks to everyone who has contributed to Linsight!

<p align="center">
  <a href="https://github.com/Prism-Shadow/linsight/graphs/contributors"><img src="https://contrib.rocks/image?repo=Prism-Shadow/linsight" alt="Linsight contributors" /></a>
</p>

## Citation

If you use Linsight in your research, please cite:

```bibtex
@software{linsight2026,
  author  = {{PrismShadow Team}},
  title   = {Linsight: Efficient Self-Improving Harness for Everyone},
  year    = {2026},
  url     = {https://github.com/Prism-Shadow/linsight},
  license = {Apache-2.0}
}
```

## License

[Apache-2.0](LICENSE) © 2026 Prism Shadow

Built with ❤️ by [Yaowei Zheng](https://github.com/hiyouga) (author of [LlamaFactory](https://github.com/hiyouga/LlamaFactory)), the [PrismShadow AI Team](https://github.com/Prism-Shadow), and [Fable 5](https://www.anthropic.com/news/claude-fable-5-mythos-5).
