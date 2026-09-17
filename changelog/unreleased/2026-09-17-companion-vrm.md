# Companion VRM renderer

- **Date:** 2026-09-17
- **Type:** feature
- **Scope:** `server`, `web`

[中文版](2026-09-17-companion-vrm.zh.md)

The companion-specific settings page now exposes a third avatar renderer alongside 2D and Live2D: `vrm`. Picking it lazy-loads three.js + `@pixiv/three-vrm` and renders a rigged VRM model through the same `<CompanionPet>` swap point the Live2D renderer already uses. The 36 px banner keeps the SVG path on size grounds (a face at 36 px does not read); the widget and floating window honour the pick.

The `companionAvatarRenderer` closed enum extends from `"svg" | "live2d"` to `"svg" | "live2d" | "vrm"` on both server and web. The VRM preset catalog lives in a new `companionAvatarVrmPreset` field with its own closed list — the Live2D and VRM catalogs have disjoint id spaces and evolve independently, because they are different file formats with different license provenance. A hand-crafted PUT cannot put junk into either preset slot: the server-side validators reject unknown ids.

## What changes

The new module `packages/web/src/features/chat/companion-vrm/` mirrors `companion-live2d/` line for line:

- `manifest.ts` reads a JSON sidecar per preset directory under `public/avatars-vrm/` via `import.meta.glob({ eager: true })`; the runtime never 404-thrashes because the build-time glob walks the directory once. Each sidecar carries an explicit `license` string.
- `use-vrm-model.ts` probes WebGL, instantiates a three.js `Scene` with a camera and ambient light, loads the chosen `.vrm` over `GLTFLoader` + `@pixiv/three-vrm`, and tears the whole graph down on unmount. The `onReady` callback hands the loaded model back to the React side so it can apply expressions synchronously on each pose change.
- `CompanionVrm.tsx` is the React wrapper. It is loaded via `React.lazy(() => import("./CompanionVrm"))` inside `<CompanionPet>`, with `<PetSvg>` as the `<Suspense>` fallback so the user sees the existing 2D fox flash for one frame instead of an empty box.
- `pose-to-expression.ts` maps the same seven `CompanionPose` values the SVG and Live2D layers have shipped since L.1 to VRM expression weights (`neutral`, `happy`, `blink`, `aa`, `sad`, `surprised`). Re-applying the same pose is a no-op so the runtime does not thrash between renders.
- `preset-preview.tsx` is the Settings-picker thumbnail — same `IntersectionObserver` lazy-mount pattern the Live2D preview uses, so each picker tile does not pay the three.js download cost until it scrolls into view.

The pet surface now reads:

```ts
const useLive2D = avatarRenderer === "live2d" && size !== "sm" && resolvedLive2D !== null;
const useVrm    = avatarRenderer === "vrm"    && size !== "sm" && resolvedVrm   !== null;
```

A shared `on3dFallback` callback flips the renderer back to `"svg"` for either renderer when WebGL is unavailable or the asset drops fails to resolve — the existing toast surfaces once per session and the next render swaps in the SVG layer.

The Settings page extends `CompanionAvatarRenderer` from a two-segment picker to a three-segment picker (`2D / Live2D / VRM`) and adds a parallel preset row gated on `avatarRenderer === "vrm"`. The two preset rows are independent: a user who flips the renderer between Live2D and VRM keeps the Live2D or VRM id they last picked, because the Live2D and VRM id spaces are disjoint.

`packages/web/package.json` adds `three` and `@pixiv/three-vrm` to `dependencies`; `packages/web/vite.config.ts` extends `optimizeDeps.include` with both packages so the dev server pre-bundles the chunk boundary the way the Live2D entry pre-bundles pixi.js. An SVG-only user never downloads three.js.

## Compatibility

The `companionAvatarRenderer` enum extension is a wire-format change. A user on an older client (or a hand-edited prefs JSON) that stores `"vrm"` continues to load on the new server: the new closed enum treats `"vrm"` as a legal value. The reverse direction is also handled — the web store's hydration helper still collapses any unknown renderer string to `"svg"`, so a server that ships a `"vr2"` value after this client version lands does not break the running pet.

The `companionAvatarVrmPreset` field is new. A prefs row that lacks it hydrates to `"vrm-sample-a"` on the client (the closed list's first entry); the server does not require the field for any other companion pref write.

The bundled VRM models are placeholders. The `public/avatars-vrm/<id>/index.json` sidecars ship in this PR, but the actual `.vrm` files do not — a follow-up asset drop will land them with explicit `license` strings. The Settings picker currently renders the colored-circle fallback for both presets, identical to the Live2D picker before the Cubism SDK sample-data drop landed.