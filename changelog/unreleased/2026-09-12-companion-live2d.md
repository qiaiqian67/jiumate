# AI companion — Stereo avatar (Live2D renderer)

- **Date:** 2026-09-12
- **Type:** feature
- **Scope:** `server`, `web`

[中文版](2026-09-12-companion-live2d.zh.md)

The companion's 2D SVG fox can now be swapped for a pseudo-3D Live2D model. The pose state machine — the same seven names (`idle / thinking / listening / speaking / celebrating / confused / sleepy`) the SVG layer has shipped since L.1 — drives the Cubism model's motion groups and parameter overrides behind the same `<CompanionPet>` swap point. A user who never opens the new picker row sees no behavioural change; the default renderer stays SVG, the default preset is Hiyori.

## What ships

The companion-additional settings page (`packages/web/src/features/settings/companion-section.tsx`) grows two rows below the ASR picker:

- **Stereo avatar** (`companionAvatarRendererLabel`): a 2-segment `Segmented<CompanionAvatarRenderer>` over `2D / Live2D`. The `Info` popover explains the WebGL requirement and the silent fallback to SVG.
- **Model** (`companionAvatarPresetLabel`): a horizontal row of `<PresetPreview>` thumbnails, only visible when the renderer is `Live2D`. Each thumbnail is 48 px and renders the localized display name; the selected one carries an orange ring.

Three built-in presets ship in the closed list — Hiyori, Mark, Mao — all from the official Cubism SDK Sample Data, distributed under the Live2D Cubism SDK Sample Data License. The manifest catalog (`packages/web/src/features/chat/companion-live2d/manifest.ts`) walks `public/avatars/<id>/index.json` via `import.meta.glob` at build time; the runtime fetches the `.moc3` / textures / motions lazily so the browser caches them as immutable static assets. The closed list lives on both server and web — the server-side gate rejects unknown preset ids and the web hydration helper falls back to `hiyori` for unrecognized strings, so the user never sees a broken picker.

## The pose state machine stays the same

The seven-pose `CompanionPose` enum (already pinned by `companion-pet.test.ts`) drives the Live2D layer through `packages/web/src/features/chat/companion-live2d/pose-to-motion.ts`. Each pose maps to a Cubism motion group plus parameter overrides (`ParamEyeLOpen`, `ParamMouthOpenY`, `ParamAngleZ`, etc.) that mirror the SVG `POSE_GEOMETRY` table so the two renderers stay visually aligned — `thinking` closes the eyes and tilts the head -3°, `celebrating` squints and smiles, `confused` tilts -8°. The helper is exported through `poseToMotionForTest` so a unit test pins every pair without spinning up pixi.js. Idle motion plays the model's own clip; the same helper serves the Settings-picker `<PresetPreview>` so the user sees the same animation at 48 px that the live pet plays at 96 px.

## WebGL auto-fallback

The runtime never shows a broken canvas. Three failure modes funnel through the same `<CompanionLive2D onFallback>` callback, which flips the store renderer back to `"svg"` with a one-time toast:

1. **WebGL unavailable** — the host browser cannot create a WebGL context (corporate kiosk, locked-down Electron build, old Android WebView). `use-live2d-model.ts` probes `canvas.getContext("webgl2")` first, then `webgl`; both missing reports `no-webgl`.
2. **Asset missing** — the user enabled Live2D before the asset drop landed. `.moc3` 404s; `Live2DModel.from(url)` rejects; the hook reports `load-failed`.
3. **Live2D model JSON parse error** — a corrupt or partial asset. Surfaces as `load-failed` too.

`prefers-reduced-motion: reduce` is honoured by `motionManager.stopAll()` rather than disabling the renderer — the pet still renders the current pose, it just does not animate.

## Server-side validation

`UiPrefs` grows two optional fields (`packages/server/src/api/types.ts`):

```ts
companionAvatarRenderer?: CompanionAvatarRenderer;  // "svg" | "live2d"
companionAvatarPreset?: CompanionAvatarPreset;      // "hiyori" | "mark" | "mao"
```

Validated on write by `packages/server/src/services/companion-prefs.ts`. The renderer is a closed enum (rejects unknown strings); the preset is a closed list (rejects unknown ids). A rejected write stores nothing and returns 400 — the route-level contract mirrored from the existing `validateCompanionAsrProvider`. The two fields are intentionally independent: a user can opt in to `"live2d"` before picking a preset (the hydration helper defaults the preset to `hiyori`) without the server requiring them to be sent together.

## Compatibility

- **No data migration.** Both new fields are optional. An old prefs file hydrates with `renderer = "svg"` + `preset = "hiyori"` — identical to the pre-L.6 default and the same defaults a brand-new user sees.
- **Live2D is opt-in.** A user who never opens the new picker row sees no behavioural change, pays zero bundle cost (the lazy import boundary keeps `pixi.js` out of the user's main chunk), and keeps the existing 2D fox on every surface.
- **Size-gated hybrid.** The 36 px banner (`size === "sm"`) keeps the SVG path even when the user picks `Live2D` — a Cubism model face downscaled to 36 px reads as a blurry smear and would be an honest regression vs. the crisp SVG. The widget (`md`, 64 px) and floating window (`lg`, 96 px) honour the pick. This is the documented honest trade-off; a future "responsive model swap" could revisit it if the model rendering at 36 px improves.
- **Asset attribution.** Each preset's `index.json` records `license: "Live2D Cubism SDK Sample Data License"`. Future Settings → About work or a `THIRD-PARTY-NOTICES.md` registry can read it without a parallel index.
- **Three surfaces swap together.** All three surfaces (`companion-banner`, `companion-widget`, `companion-page`) read the same `useCompanionStore()`, so flipping the renderer updates the banner / widget / floating window on the same render tick.
- **WebGL fallback is silent.** The user explicitly opted in to Live2D and never sees an empty box — the runtime degrades to SVG with a single toast on the same tick that flips the store.

## Asset drop status

The runtime ships the full plumbing (manifest, registry, renderer, fallback path, tests). The Hiyori / Mark / Mao `.moc3` files themselves are not in this repo — they are official Cubism SDK Sample Data distributed under the Live2D Cubism SDK Sample Data License and are downloaded separately, then dropped under `packages/web/public/avatars/<id>/`. Until the asset drop lands, every preset renders the orange-circle placeholder and the runtime's WebGL fallback path engages; a user who picks Live2D before the asset drop sees a toast once and the companion stays on SVG.

## Tests

- `packages/server/test/companion-prefs.test.ts` — 14 new cases in two `describe` blocks: each renderer id round-trips through `PUT /api/me/prefs`, each preset id round-trips, unknown renderer / preset strings are rejected with 400, the failed merge does not clobber seeded unrelated fields (mirroring the L.4 / L.5 blocks).
- `packages/web/test/companion-store.test.ts` — 8 new cases pinning `companionAvatarFromPrefs` (defaults on absence, echo valid values, fall back on unknown renderer / unknown preset, renderer and preset hydrate independently), plus the closed-list ordering for `COMPANION_AVATAR_RENDERERS` (`svg` first, the safe default) and `COMPANION_AVATAR_PRESETS` (`hiyori / mark / mao`, the canonical display order).
- `packages/web/test/companion-live2d/pose-to-motion.test.ts` — 8 cases pinning the seven-pose → Cubism motion mapping: every pose returns a non-empty motion name, all 7 motions are distinct, the parameters record exists for every entry with finite numeric values, and spot checks verify `speaking` drives `ParamMouthOpenY`, `thinking` / `confused` drive `ParamAngleZ` with the SVG-aligned tilt values.
- `packages/web/test/companion-live2d/manifest.test.ts` — 4 cases pinning the catalog shape: 3 preset ids in `COMPANION_AVATAR_PRESETS` order, every preset has both `zh` and `en` display names, every `moc3Url` resolves under `/avatars/<id>/*.moc3`, and every preset records the Live2D license string.