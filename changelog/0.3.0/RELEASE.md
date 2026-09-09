Linsight 0.3.0 — the release where the project stops calling itself PenguinHarness. Every literal `penguin` is swept from the workspace end to end: seven npm packages, twelve plugins, two CLI bins, the `~/.linsight/data` data root and its `linsight_session` cookie, the `LINSIGHT_*` env vars, the install URLs, every doc and log and the README; the logo is replaced on the web app, landing, docs and desktop shell, and the version that opens when a fresh install lands is the first one named Linsight. The Files panel's Markdown preview becomes a real editor — CodeMirror 6, Cmd/Ctrl-S save, a server-side ETag round-trip, Mermaid rendering, a draft-preserving view toggle — and beside it an Export menu ships Markdown, HTML, DOCX, EPUB, RTF and TXT through a packaged Pandoc, with PDF through the desktop's headless print. A new Machines page installs this build onto another host from the server's own `~/.ssh/config`, the first-load bundle is **1229 KB → 329 KB** under brotli, and every plugin is now its own npm package under `@linsight/*` — goal mode and continual learning installed as plugins — with `skills`/`--skills` renamed to `plugins`/`--plugins` in Agent creation.

## Install

**Desktop app**: grab your platform's installer from [linsight.ooo/download](https://linsight.ooo/download) — the page measures both sources on every visit and keeps GitHub unless the OSS mirror is measurably faster, with a manual selector beside the result. The macOS builds are Developer ID signed and notarized and the Windows installers are Authenticode-signed, so neither platform needs a first-launch unblock.

CLI / server (Linux, macOS; bundled Node runtime):

```sh
curl -fsSL https://linsight.ooo/install.sh | sh
linsight web
```

Windows (PowerShell):

```powershell
irm https://linsight.ooo/install.ps1 | iex
linsight web
```

Or via npm (needs Node >= 24):

```sh
npm install -g @prismshadow/linsight-cli
```

## Highlights

**An in-place Markdown editor for the Files panel.** The preview toolbar gains an Edit toggle and a CodeMirror 6 surface with `Cmd/Ctrl-S` save, `Esc` cancel, and a save that does not flip the view back — the editor stays mounted, the response's ETag is patched into the next save's `If-Match` round-trip, and a manual switch to **Rendered** (or **Source**) shows the just-saved content as it lands. Toggle preserves the in-flight draft across view changes; rendering routes ``` `mermaid` ``` fences through `MermaidBlock` instead of the Shiki code chrome (streaming replies keep the raw fence, settled ones render the SVG). A new `editable-doc` plugin ships a `format` Skill that keeps generated documents editable afterwards — atomic H2 sections, fenced diagrams and code, GFM tables, no mega paragraphs. See [`2026-09-08-editable-docs`](2026-09-08-editable-docs.md) and the four [`2026-09-09-editable-docs-…`](2026-09-09-editable-docs-ux-fixes.md) follow-ups.

**The same panel gains a multi-format Export menu.** Markdown and HTML are produced in the browser; DOCX, EPUB, RTF and TXT go through Pandoc; PDF is the desktop's hidden BrowserWindow with `printToPDF`. The Pandoc binary is downloaded into `build/pandoc/<arch>/` per platform (the same `.gitkeep` makes local non-CI builds happy) and resolved at runtime by `pandoc-path.ts`. The web request surface is one new `POST /files/export`, the desktop carries the desktop's own copy, and capability flags from `GET /version/capabilities` decide which formats the panel enables. See [`2026-09-08-feat-workspace-export`](2026-09-08-feat-workspace-export.md).

**Server-side conflict detection on workspace file saves.** A save that goes through `If-Match` returns `409 file_conflict` when the ETag no longer matches the server's — the advisory banner becomes a Reload / Save-anyway modal that names both ETags and the user's own bytes. Missing `If-Match` keeps the prior behaviour, so an older client is unaffected. See [`2026-09-09-editable-docs-server-conflict`](2026-09-09-editable-docs-server-conflict.md).

**Install this build onto another host.** A new Machines page, under Models, lists the hosts in the server's own `~/.ssh/config` and installs this build onto the one you pick — replacing the desktop app's menu entry that shipped only inside the Electron shell. One persistent `ssh -T -D` session per machine with framed stdin carries four exchanges on one pipe, an alias target resolves through ssh's own config when the install actually runs, every machine gets a 96-bit base64url id and a status, the same-origin proxy at `/server/<machineId>/api/…` carries its API calls through the held session (admin only), and the machine gets the Project's Model credentials so Agents running there can call models from over there. Updates go over the machine's own update channel with refusals read in full, native assets attached, and `linsight server status` / `linsight server stop` for the operator. Targets come from the config text alone, read once, with no `ssh -G` and no network until you install. See the seven [`2026-09-01-machines-…`](2026-09-01-machines-transport.md) entries.

**First-load bundle, 1229 KB → 329 KB.** The built app was served uncompressed — over a megabyte of JavaScript on a first load, which is the single largest thing that load waits on. The server now negotiates per request: brotli when the client offers it, gzip otherwise, the original bytes when it offers neither. Compressed bodies are cached against the ETag (which already identifies one exact representation, so a file is compressed once per push rather than once per page load); `Accept-Encoding` is parsed rather than substring-matched, `Vary: Accept-Encoding` is sent on every response that could have varied, and the compressed form carries a weak ETag so a re-encoding proxy stays valid. See [`2026-08-24-static-compression`](2026-08-24-static-compression.md).

**Hooks, goal mode and the plugin library release.** Core gains generic hook points (`stop`, `pre_tool_use`, `user_prompt`); goal mode becomes the `goal` plugin's stop hook; continual learning joins as the `continual-learning` plugin; and every plugin becomes its own npm package under `@linsight/*` — the loader resolves them from the host package's dependency list, the desktop app declares the same list so its installer packs them. The plugin library page replaces the skill library, the agents page lists plugins alongside agents, and the `linsight-skills` package is deprecated (its prior release keeps working). See [`2026-08-29-stop-hook-goal-mode`](2026-08-29-stop-hook-goal-mode.md).

**The new `editable-doc` plugin and Skill `format`.** Generated Markdown documents are now produced to be edited afterwards: atomic H2 sections, fenced diagrams and code, GFM tables, no mega paragraphs. Preinstalled for `default_agent`, installable for any other Agent from the library. See [`2026-09-08-editable-docs`](2026-09-08-editable-docs.md).

## Notable in this release

- **No breaking changes** beyond the ones itemised under [Compatibility](#compatibility) below.
- **A new Project's default model can read a pasted screenshot** via `MiniMax-M3` reached over the vendor's Anthropic-protocol endpoint (`api.minimax.cn/anthropic`); the new `minimax-ant-messages` client type authenticates with `MINIMAX_API_KEY`. See [`2026-09-07-minimax-anthropic-m3`](2026-09-07-minimax-anthropic-m3.md).
- **AgentHub 0.4.9**: GPT-5.6 now reads large screenshots at `detail:"high"` instead of rejecting them, and the AgentHub peer pin bumps accordingly. See [`2026-09-02-agenthub-0.4.9`](2026-09-02-agenthub-0.4.9.md).
- **The LLM idle timeout doubles to 300 s**, with a retry ladder that resets when an attempt produced content, an absolute cap of 20 per turn, and `thinking_summary` requested alongside the existing thinking block. See [`2026-09-01-llm-idle-timeout-and-retry-ladder`](2026-09-01-llm-idle-timeout-and-retry-ladder.md).
- **Every model context is reassembled per rotation.** Compaction opens a new context exactly like a new Session, the thinking level becomes soft-tier (a mid-context change is allowed), and approval mode becomes unrestricted at every rotation. `SessionConfig.createLLM` / `ContextEngineDeps.createLLM` is renamed to `openNextContext`; `RunOptions.thinkingLevel` and the per-round thinking level on the subagent seams are removed; `SessionConfig.commandPolicy` is now a per-context source. HTTP API: `POST /tasks` and the subagent message no longer take `thinkingLevel`; a follow-up recall no longer returns one. See [`2026-08-28-context-assembled-per-rotation`](2026-08-28-context-assembled-per-rotation.md).
- **One update dialog replaces three old flows.** Check → download with progress → restart, all in one place; `POST /api/version/update` answers with the job status instead of blocking until the run is over, the CLI supervises the service and relaunches on the restart exit code. See [`2026-08-28-update-modal`](2026-08-28-update-modal.md).
- **Capability-matrix docs split into eleven documents.** The single page is replaced by an index, an inventory, a gap analysis, a decisions log and DRAFT G–M, each with its own frontmatter and sidebar registration, so a reader can land on the one section a question lives in. See [`2026-09-07-docs-capability-matrix`](2026-09-07-docs-capability-matrix.md) and [`2026-09-08-docs-capability-matrix-split`](2026-09-08-docs-capability-matrix-split.md).
- **A Security Model page joins the docs reference section.** Organised as scenarios in the order a user meets them — feature inventory, first login (web and desktop), the four password-change paths, automation on the local machine, remote machines (where ssh access is stated plainly to equal CLI access on it), taking access away, and the leak-response scenario the design is built around. See [`2026-08-24-security-docs`](2026-08-24-security-docs.md).
- **Schema changes are ordered migrations.** `schema.ts` becomes a list of migrations stamped into `PRAGMA user_version`, each carrying its frozen DDL and a `swapSafe` axis for hot updates; two additive migrations live there so far, and the third (the `goal_state` drop, below) is the first one that isn't hot-safe. See [`2026-08-27-schema-migrations`](2026-08-27-schema-migrations.md).
- **Sidebar glyphs and copy corrections.** A clock-backwards glyph for the last-conversation entry, a robot head for Agents, a brain for Model Library, a Members glyph for project settings, a clearer zh grouping label, and a trailing ellipsis on the Remote control entry. See [`2026-08-28-sidebar-glyphs-and-copy`](2026-08-28-sidebar-glyphs-and-copy.md).
- **Terminal links open their target.** URL clicks open the address (not `about:blank`), OSC 8 program hyperlinks are honoured, click resolution is by position rather than by object identity, OSC 52 writes are accepted, and a tmux 3.4+ tip accompanies the change. See [`2026-08-30-terminal-links`](2026-08-30-terminal-links.md).
- **A Session row's right-click menu gains "Copy id"** for both conversation and folder rows, with the details card's glyph and label.
- **The landing headline alternates** "auto-dev / auto-tuning" in both English and Chinese, and the `BotIcon` on the landing page now draws the same Agent glyph as the web app, with a source-text sync test guarding future drift. See [`2026-08-31-landing-rotating-headline`](2026-08-31-landing-rotating-headline.md) and [`2026-09-01-landing-agent-glyph`](2026-09-01-landing-agent-glyph.md).
- **Memory topic files sort locale-independently.** Case-folded with code-unit ties; the existing `en_US.UTF-8` order is preserved. See [`2026-09-04-memory-file-order-locale`](2026-09-04-memory-file-order-locale.md).
- **The CI runtime artifact now carries web-dist**, and `scripts/preflight.mjs` fails a packed build that lost it; a packaged desktop now pins and checks its own web-dist, and a hot-pushed version that does not contain `index.html` is restored, not accepted. See [`2026-08-30-ci-runtime-web-dist`](2026-08-30-ci-runtime-web-dist.md) and [`2026-08-29-web-dist-diagnostics`](2026-08-29-web-dist-diagnostics.md).
- **`packages/*/.claude/` joins `.gitignore`**, alongside the unchanged root `.claude` pointer. See [`2026-09-07-gitignore-package-claude-state`](2026-09-07-gitignore-package-claude-state.md).
- **The Agents page's "Changes detected" notice** now sits at the same header gap as the Models page.

## Compatibility

There are five breaking changes in this release, each itemised with the migration step in the entry it lives in:

1. **Hot-pushed platforms are refused until restarted** — the `goal_state` table is dropped by the first restart-only schema migration, so a running server is rolled back to its predecessor if the boot fails; a predecessor that found the table gone mid-process would prepare its goal statements against nothing. The push is refused whole, with `RestartRequiredError` naming the migration, before any DDL runs. An installer or a package update restarts anyway — only a hot-pusher is affected. See [`2026-09-02-backward-compatibility`](2026-09-02-backward-compatibility.md).

2. **Goal mode on an existing Agent needs the `goal` plugin installed once** — hook packages are new, an existing Agent has an empty `agent_state/hooks/`, and nothing installs into an existing Agent at boot. Goal mode on such an Agent answers `409 goal_plugin_not_installed` until `goal` is installed from the library, one click per Agent. Every `default_agent` created from this release on has it preinstalled. `continual-learning` is installed the same way (not preinstalled). See [`2026-09-02-backward-compatibility`](2026-09-02-backward-compatibility.md).

3. **SDK + HTTP API rename around the rotation model** — `SessionConfig.createLLM` / `ContextEngineDeps.createLLM` become `openNextContext`; `RunOptions.thinkingLevel` and the per-round thinking level on the subagent seams are removed; `SessionConfig.commandPolicy` is now a per-context source. HTTP: `POST /tasks` and the subagent message no longer accept `thinkingLevel`; a follow-up recall no longer returns one. See [`2026-08-28-context-assembled-per-rotation`](2026-08-28-context-assembled-per-rotation.md).

4. **`POST /api/version/update` is now non-blocking** — it answers with the job status instead of waiting for the run to finish; clients that polled the endpoint until done need to follow the job id instead. See [`2026-08-28-update-modal`](2026-08-28-update-modal.md).

5. **Machines routes moved under a Project, and `machines-installs.json` is no longer read** — the JSON file's history is migrated into `web.db` by migration 4 at the runtime's open, and the routes live at `/api/projects/:projectId/machines/…`. The file is left on disk; nothing writes it any more. See [`2026-09-01-machines-store`](2026-09-01-machines-store.md).

A sixth rename touches Agent creation and the CLI: `skills` / `--skills` becomes `plugins` / `--plugins`. There is no alias — a script still sending `skills` gets an Agent with nothing preinstalled (the field is ignored); `--skills` gets the CLI's unknown-option error. Update the call.

Downgrading to 0.2.9 works on a migrated database: `goal_state` is recreated by 0.2.9's `openDatabase` (`CREATE TABLE IF NOT EXISTS`), the `machines-installs.json` file is read no longer (its history sits in `web.db`), and the `goal_plugin_not_installed` 409 returns on every goal call until you install the plugin (or downgrade). None of the above is a shim with an expiry; there is nothing to remove in a later release.

## Requirements

Linux or macOS (x64 / arm64), or Windows 10+ (x64). The desktop app and the CLI installers bundle their own runtime; installing from npm needs Node >= 24. All data stays under `~/.linsight/data`.

Full detail: [changelog/0.3.0/](https://github.com/Prism-Shadow/linsight/tree/main/changelog/0.3.0).