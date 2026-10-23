JiuMate 0.4.0 — the release where the agent gets a browser, and the app stops calling things by the wrong name. Two built-in tools, `browser_read` and `browser_act`, drive a real browser: `browser_read` scans a page and returns its screenshot as image content in the same turn, and `browser_act` does what a person does to a page — click, type, scroll, press a key, choose from a dropdown, navigate, go back, hover, fill in a file, wait for something to appear, and run JavaScript in the page's own origin. The browser starts empty, so the sign-ins of a system browser can be brought over, and a **third backend** means a server with no desktop shell now has a browser of its own: a Chromium the server starts for itself, driven over its own debugger, with the user's sign-ins surviving even a crash. Alongside that: an **Agent API** that lets a program outside the Web App run an Agent over HTTP, a **theme** that is a palette and a picture rather than three unrelated layers, an **inspiration library** an admin can write into, plugins and skills that are local objects you add and turn on per Agent, a desktop pet the agent can inspect and control, and the product's own mark replaced by a vector brand asset.

## Install

**Desktop app**: grab your platform's installer from [jiumate.ooo/download](https://jiumate.ooo/download) — the page measures both sources on every visit and keeps GitHub unless the OSS mirror is measurably faster, with a manual selector beside the result. The macOS builds are Developer ID signed and notarized and the Windows installers are Authenticode-signed, so neither platform needs a first-launch unblock.

CLI / server (Linux, macOS; bundled Node runtime):

```sh
curl -fsSL https://jiumate.ooo/install.sh | sh
jiumate web
```

Windows (PowerShell):

```powershell
irm https://jiumate.ooo/install.ps1 | iex
jiumate web
```

Or via npm (needs Node >= 24):

```sh
npm install -g @prismshadow/jiumate-cli
```

## Highlights

**The agent reads and acts on a real page.** `browser_read` and `browser_act` are two built-in tools, and they are split because the work is split: reading changes nothing on the user's behalf, so it rides the approval flow as a read; clicking, typing and running script can submit an order and can read `document.cookie`, so they ask first. A screenshot comes back through `ToolResult.images`, so the model sees the page in the turn that asked for it rather than a turn later. `browser_act` grew past click and type: a scroll answers with where the page ended up (whether it moved, whether it is at the bottom, how tall it is), a key is dispatched as a person's keyboard would, a `<select>` is chosen by its value or by the text the user reads on it, and `wait` lets the page watch itself — one call does the waiting and ends the instant the condition holds, which is the action that saves a model its budget.

**Three browsers, and the choice falls back rather than fails.** The built-in browser is the desktop app's own: the user sees every page the agent opens and can take a tab over. The new **headless backend** is a Chromium the *server* starts for itself — a real one, so nothing is downloaded and nothing is installed — with its own profile under the data root, so the sign-ins survive a restart. The user's own Chrome is the third. Which one is in use is a per-user setting, and a browser that works beats the one the user asked for not working: a server with no desktop shell falls back to the headless one, a machine with no Chromium falls back to the built-in one.

**The sign-ins come over, and they survive a crash.** The browser starts empty, so a user can bring the sign-ins of a system browser into it — the Chromium family's and Firefox's — which is the difference between an agent that can only read public pages and one that can do the work. The import reads a profile's cookie store and its history and never writes to the system browser; cookies are decrypted with the platform's own key (the macOS Keychain, the Linux keyring, Windows' DPAPI), and Chrome's app-bound encryption is not a key anyone else holds, so those cookies stay behind and the import says how many. Chrome writes its cookie store only when it closes, politely — two minutes of running leave the file untouched, and a browser that is killed writes nothing at all — so the server keeps its own record of the cookies it handed the browser, written the moment they are set. A crash no longer takes the sign-ins with it.

**An Agent can be called from outside the Web App.** An owner opens the Agent's API tab, turns the switch on, mints a key, and a program presents that key to run the Agent over HTTP. The tab carries the exposure settings and the key list; the calling side is four routes under `/amsp/v1`. A key is shown once, and the server keeps only a sha256 of it.

**A theme is a palette and a picture.** The Appearance page had offered three parallel things — "Theme" (really the light/dark look), "Skin" (the palette) and "Wallpaper" (the picture) — so every new picture needed a palette invented to carry it, and the word "theme" named the light/dark switch. The three collapse into one concept, with the format and the model aligned to [Codex Dream Skin](https://github.com/Fei-Away/Codex-Dream-Skin). The Inspiration Library makes the same move: what was eleven hard-coded examples in a TypeScript array is now a library — the built-in cases plus the cases an admin authors, filed into categories an admin defines.

**Plugins and skills are local objects.** JiuMate has no marketplace to download from, and the plugin page treated it as if it had one. A plugin is now something you **add** to this machine — once, from a URL, an archive or a local directory — and then turn on or off per Agent, with a machine-level switch on every card and a real place to type the API key. Skills gained the same three ways to be added and a switch that actually switches.

**The desktop pet is a thing the agent can drive.** `AI 伴侣` becomes Petdex, a floating pet that parks in a corner with transparency, a size setting, animation and a speech bubble, a system-tray entry and a scrollable bubble stack — and a `pet` tool that lets the agent inspect and control it. The pets bundled with the Codex desktop app can be imported.

## Notable in this release

- **A server with no desktop shell now answers 200 where it used to answer 503.** It has the headless browser, so the browser is there: `GET /api/browser/status` reports `backend: "headless"`. A host with no browser at all still answers 503 `browser_unavailable`, and a browser that is there but not answering is reported as `available: false` with a reason. See [`2026-10-20-browser-tools`](2026-10-20-browser-tools.md).
- **The sidebar's page group is now 智能体 / 插件·技能 / 灵感库 / 词元图**, two entries left it for better homes, four surfaces were renamed, and the Token Map gained a year heatmap. Two preference defaults changed. See [`2026-09-20-nav-restructure-and-token-map-heatmap`](2026-09-20-nav-restructure-and-token-map-heatmap.md).
- **The product's mark is now a vector brand asset**, and the Linsight → JiuMate rename reaches the npm packages, the plugins, the CLI bins, the data root, the env vars, the install URLs and every doc. See [`2026-09-28-rebrand-logo`](2026-09-28-rebrand-logo.md) and [`2026-09-28-rebrand-to-jiumate`](2026-09-28-rebrand-to-jiumate.md).
- **The agents list becomes a browsable grid** instead of full-width bands, and quick invoke reaches the composer. See [`2026-10-13-agents-grid`](2026-10-13-agents-grid.md) and [`2026-10-13-quick-invoke-reaches-composer`](2026-10-13-quick-invoke-reaches-composer.md).
- **A locked file write is retried, and a run no longer burns minutes on a browser install.** See [`2026-09-20-fix-agent-write-lock-and-runaway-install`](2026-09-20-fix-agent-write-lock-and-runaway-install.md).
- **A working bash is no longer discarded, and a Windows POSIX shell gets the user's PATH.** See [`2026-09-20-fix-shell-resolution-and-path-inheritance`](2026-09-20-fix-shell-resolution-and-path-inheritance.md).
- **A Petdex package that escapes its directory is rejected**, folder import is repaired, and the catalog cap is fixed. See [`2026-09-18-fix-pet-package-path-escape-and-import`](2026-09-18-fix-pet-package-path-escape-and-import.md).
- **The library card's five buttons fold into one ellipsis menu**, and "No skills were added" now says why. See [`2026-10-14-card-actions-menu`](2026-10-14-card-actions-menu.md) and [`2026-10-14-add-skill-reasons`](2026-10-14-add-skill-reasons.md).
- **The `use-guizang-ppt` plugin is removed**, and the working tree is normalized so CRLF stops looking like an edit. See [`2026-09-23-remove-guizang-ppt-plugin`](2026-09-23-remove-guizang-ppt-plugin.md) and [`2026-10-12-crlf-normalize-working-tree`](2026-10-12-crlf-normalize-working-tree.md).

## Requirements

Linux or macOS (x64 / arm64), or Windows 10+ (x64). The desktop app and the CLI installers bundle their own runtime; installing from npm needs Node >= 24. All data stays under `~/.jiumate/data`.

The headless browser needs a Chromium on the machine — Chrome, Edge or Brave — and the built-in browser needs the desktop app. The browser the agent drives is a per-user setting under Settings → General, and the choice falls back to one that works rather than failing.

Full detail: [changelog/0.4.0/](https://github.com/qiaiqian67/jiumate/tree/main/changelog/0.4.0).
