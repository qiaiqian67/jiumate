# Replace AI 伴侣 with Petdex desktop pet

- **Date:** 2026-09-18
- **Type:** refactor
- **Scope:** `core`, `server`, `web`, `desktop`
- **Breaking:** yes — OmniMessage no longer carries `[companion_persona]` blocks; `UiPrefs.companion*` fields are silently stripped on `PUT /api/me/prefs`.

[中文版](2026-09-18-replace-ai-companion-with-petdex.zh.md)

The AI 伴侣 feature (SVG fox / Live2D / VRM, persona injection, ASR mic, TTS reaction bubbles) is removed and replaced with a Petdex desktop pet window. The floating pet is now a sprite-atlas `BrowserWindow` driven by session activity, configurable from a new Application settings page.

## What ships

- **`@prismshadow/jiumate-pets`** — new workspace package. Arktype-validated `PetPackage` schema, manifest + spritesheet IO with strict bounds (64 KiB / 32 MiB / 64 MiB / 128 pets), SHA-256 fingerprinting, and a `.jiumate-pet-receipt.json` round-trip so a re-install is idempotent. Mirrors OpenBitFun's `pet_packages.rs` byte-for-byte so Petdex downloads round-trip between hosts.
- **`/api/pets`** — new REST surface on the server. `GET` lists installed pets + diagnostics; `GET /api/pets/:slug/spritesheet` serves installed atlas bytes; `POST /api/pets/import` accepts `{ path, expectedFingerprint? }` and validates before publishing; `DELETE /api/pets/:slug` removes an installed pet.
- **`PUT /api/me/prefs`** — accepts the new `enablePet` / `activePetId` / `petWindowPosition` keys; legacy `companion*` keys are stripped silently.
- **`/pet` route + frameless pet window** — replaces the former `/companion` route and the old `companion-window.ts`. Loads `${appOrigin}/pet`, transparent always-on-top, position persisted in prefs, IPC bridge `window.pet` (including `pickPackage` for folder import).
- **Builtin Petdex assets** — ships OpenBitFun's 13 preset packs under `packages/web/public/pets/` (`blue-golden`, `openbitfun-girl`, `deepseek-goldwhale`, …) so the settings picker and floating window render real spritesheets.
- **`Settings → Application → Desktop pet`** — enable switch, full preset + imported pet grid, import + delete. Mirrors OpenBitFun's `page === 'pet'` block.
- **Session → pet activity bridge** — chat page pushes the current task-state mood (`rest / working / analyzing / compacting / idle`) over a real `BroadcastChannel`; the floating pet window subscribes across windows.

## What goes away

- `companion-persona` OmniMessage marker and `[companion_persona]` block. The `MARKER_TAGS.companionPersona` entry, its builders, parsers and predicate branches are removed.
- All `companion*` UI prefs (`companionPlacement`, `companionFloatingPosition`, `companionName`, `companionPronoun`, `companionProactiveTimeoutMs`, `companionTtsProvider/Voice`, `companionAsrProvider`, `companionAvatar{Renderer,Preset,VrmPreset}`).
- Live2D renderer (`pixi.js`, `pixi-live2d-display`), VRM renderer (`three`, `@pixiv/three-vrm`), SVG fox, ASR Web Speech hook, TTS Web Speech hook, proactive trigger.
- 16 unreleased changelog entries for the AI 伴侣 feature (`companion-mode / -placement / -banner / -asr / -expression-and-proactive / -tts / -live2d / -vrm`).
- `packages/docs/content/draft-k-companion.{en,zh}.md` and its row in `capability-matrix`.

## Migration

- A stored `companionPlacement: "floating"` row keeps the floating window open on the user's next visit (the pet window replaces the companion window at the same URI); banner/widget placements are silently dropped. There is no opt-out for the pet itself — set `enablePet: false` to hide it.
- A future major release can re-add a persona-mode toggle on top of the pet; nothing in this change is irreversible beyond the OmniMessage marker removal.

## Compatibility

- The drop of `[companion_persona]` from `OmniMessage` is the only breaking protocol change. Older Traces that carried the block still parse — `stripLeadingMarkerBlocks` no longer recognises the tag, so a legacy `[companion_persona]…[/companion_persona]` block would render verbatim in user-visible surfaces. The marker was never released (it only lived in `unreleased/`), so no shipped Trace carries it.
- Pet packages authored against OpenBitFun's `PetPackage` format import without changes. Server-side, the catalog under `<data-root>/pets/<slug>/` is forward-compatible with future v2-vN versions — the host only reads `spriteVersionNumber` to pick frame geometry.