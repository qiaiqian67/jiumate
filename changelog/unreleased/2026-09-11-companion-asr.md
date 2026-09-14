# AI companion — Microphone input + ASR

- **Date:** 2026-09-11
- **Type:** feature
- **Scope:** `server`, `web`

[中文版](2026-09-11-companion-asr.zh.md)

The chat composer grows a microphone button. Tapping it records the user's voice via the OS speech engine (Web Speech API by default); tapping again stops. The final transcript lands in the composer for the user to confirm before sending — voice is a dictation channel, not an Enter key. The provider is a closed enum (`"off" | "webspeech"`), so the future Whisper-cloud / AWS-Transcribe / local-Whisper.cpp integrations plug in behind the same `CompanionAsrProvider` interface without touching the chat composer. A user who never opens the new picker row sees no microphone button — the default is `"off"`, matching the rest of the companion's opt-in pattern.

## What ships

The companion-additional settings page (`packages/web/src/features/settings/companion-section.tsx`) grows one more row below the TTS voice picker:

- **Voice input** (`companionAsrProviderLabel`): a 2-segment `Segmented<CompanionAsrProvider>` over `Off / System recognition`. The `Info` popover explains the contract (composer-only, OS speech engine, transcript fills the composer for confirmation).

The provider abstraction lives in `packages/web/src/features/chat/companion-asr/`:

- `provider.ts` — `CompanionAsrProvider` interface (`available / start / stop / id`) plus a discriminated `AsrError` union (`permission-denied | no-speech | audio-capture | network | aborted | other`). `start` resolves once the recognizer reports it has started; the transcript streams through `onInterim` (live preview, not consumed in this PR) and `onFinal` (exactly once per utterance).
- `webspeech.ts` — Web Speech implementation. Wraps `window.SpeechRecognition || window.webkitSpeechRecognition`. `available()` returns false when the constructor is missing **or** the page is not in a secure context (Chromium refuses to expose the API on plain HTTP — a non-secure page can speak but cannot record); the chat composer uses this probe to hide the button rather than offering one that always fails with `not-allowed`. Errors are mapped through `mapErrorForTest` from the Web Speech event's free-form `error` string into the `AsrError` union so the UI can show the right prompt ("mic permission denied" is distinct from "we didn't hear anything"). Double-start is handled by aborting the prior recognizer and starting fresh — friendlier than throwing when the user double-taps the mic.
- `registry.ts` — `createAsrProvider(id)` mapping closed enum → instance. `"off"` returns `null`; `useAsr` short-circuits `start` without touching the SpeechRecognition constructor.
- `use-asr.ts` — React hook mirroring `use-tts.ts`. Re-creates the provider on provider-id change, exposes `listening / error / available / start / stop`. The chat composer wires `available` to the button's visibility and `listening` to the press state; the recognizer's own `onend` fires the final-transcript callback so a user-initiated stop still captures the partial text.

## Composer integration

The chat input (`packages/web/src/features/chat/chat-input.tsx`) renders a `<button>` between the model badge and the existing send/stop action button when `asrProvider !== "off" && useAsr().available`. Tapping toggles `start`/`stop`; the final transcript flows through `onTextChange?.(next)` — the same path keyboard input uses — so draft auto-caching, slash-menu caret tracking, history navigation and the recall round-trip keep working unchanged. The mic icon flips to a filled circle plus a Tailwind `animate-ping` halo while listening, and `aria-pressed` reflects the state for screen readers. The `lang` option passed to `recognition.start` is the result of the same `detectLang()` helper the TTS path already uses (`zh-CN` for a `zh` UI, `en-US` otherwise), so bilingual OSes pick the right engine.

ASR errors surface through the existing `toastError` channel, keyed off `AsrError.kind`. The mapping lives in the chat input as a single `asrErrorMessage(err)` helper so the test can pin it without rendering React: `permission-denied → "Microphone access was denied…"`, `no-speech → "Didn't hear anything…"`, `audio-capture → "Microphone is unavailable…"`, `network → "Speech recognition service is unavailable…"`, `aborted → silent` (user-initiated, intentionally not an error), `other → recognizer's own message` or a generic fallback.

## Server-side validation

`UiPrefs` grows one optional field (`packages/server/src/api/types.ts`):

```ts
companionAsrProvider?: CompanionAsrProvider;  // "off" | "webspeech"
```

Validated on write by `packages/server/src/services/companion-prefs.ts`: `validateCompanionAsrProvider` rejects unknown strings (the same closed-enum pattern as `validateCompanionTtsProvider` and `validateCompanionPronoun`). A rejected write stores nothing and returns 400 — the route-level contract mirrored from the existing `draftShortcuts` and `companionName` validators. The shallow-merge `PUT /api/me/prefs` semantics are unchanged.

The web `useCompanionStore` exposes `asrProvider / setAsrProvider` alongside the existing identity and TTS fields, hydrates from `GET /api/me/prefs` through `companionAsrFromPrefs` (default `"off"` for an old prefs file), and writes through `PUT /api/me/prefs` fire-and-forget.

## Compatibility

- **No data migration.** `companionAsrProvider` is optional. An old prefs file hydrates with `asrProvider = "off"` — the same default a brand-new user sees, identical to the pre-L.5 "no microphone button" behaviour.
- **Mic button is opt-in.** A user with `companionAsrProvider === "off"` (the default) sees no button. A user with `companionAsrProvider === "webspeech"` but no `SpeechRecognition` in the page (Firefox / older Electron renderer) also sees no button — the `available()` probe is the gate.
- **No audio capture without explicit user action.** A `not-allowed` Web Speech error is rendered as a toast telling the user to allow microphone access in the browser / OS settings; the composer never falls back to silently using an older recording.
- **The closed provider enum** is the same expansion surface as L.4's TTS provider list — adding Whisper / AWS Transcribe / local-Whisper.cpp is a one-place enum extension on both server (`packages/server/src/api/types.ts`) and web (`packages/web/src/features/chat/companion-store.tsx`), plus a new entry in `registry.ts`. Every call site goes through the registry indirection and does not need to be touched.
- **The chat composer is unchanged for keyboard users.** All existing flows (paste, drag-drop, slash commands, history navigation, recall) work exactly as before — the mic button is an additional input, not a replacement.

## Tests

- `packages/server/test/companion-prefs.test.ts` — 3 new cases in a `ui_prefs companionAsrProvider` block: each provider id round-trips through `PUT /api/me/prefs`, and an unknown provider is rejected with a 400 (the rejected merge does not clobber a seeded unrelated field, mirroring the L.4 TTS provider block).
- `packages/web/test/companion-store.test.ts` — 5 new cases pinning `companionAsrFromPrefs` and the `COMPANION_ASR_PROVIDERS` ordering (`off` first, the safe default). Unknown provider strings hydrate as `"off"` rather than throwing or echoing the unknown value back.
- `packages/web/test/companion-asr/webspeech.test.ts` — 8 cases pinning the `mapError` mapper: every Web Speech error code (including the two permission variants `not-allowed` / `service-not-allowed`) maps to the right `AsrError` kind, and the fallback case routes through `other` carrying the recognizer's own message.
- `packages/web/test/companion-asr/registry.test.ts` — 2 cases pinning the closed-enum → instance mapping: `"off"` → `null`, `"webspeech"` → a `WebSpeechAsrProvider` instance with `id === "webspeech"`.
- `packages/web/test/companion-asr/webspeech-lifecycle.test.ts` — 8 cases exercising the recognizer lifecycle through a stubbed constructor: `available()` branches on the constructor + secure-context probe, `start()` resolves on `onstart`, finals stream through `onFinal`, inters stream through `onInterim`, errors map to `AsrError` and clear the active session so a follow-up `start()` works, double-start aborts the prior session, and `stop()` is a no-op when idle and delegates to the underlying recognizer while active.
