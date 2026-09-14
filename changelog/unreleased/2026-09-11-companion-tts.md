# AI companion — TTS + voice reactions on the floating pet

- **Date:** 2026-09-11
- **Type:** feature
- **Scope:** `server`, `web`

[中文版](2026-09-11-companion-tts.zh.md)

The floating Electron pet can now speak its reaction bubbles aloud, using the OS TTS engine (Web Speech API) by default. The provider is a closed enum (`"off" | "webspeech"`), so the future ElevenLabs / OpenAI / local-Kokoro integrations plug in behind the same `CompanionTtsProvider` interface without touching the call sites. A user who never opens the new picker row hears nothing — the default is `"off"`, matching the rest of the companion's opt-in row pattern.

## What ships

The companion-additional settings page (`packages/web/src/features/settings/companion-section.tsx`) grows two more rows below the proactive-interval slider:

- **Voice output** (`companionTtsProviderLabel`): a 2-segment `Segmented<CompanionTtsProvider>` over `Off / System voices`. The `Info` popover explains the contract (floating-window only, OS TTS engine).
- **Voice** (`companionTtsVoiceLabel`): a native `<select>` populated from `speechSynthesis.getVoices()` once the browser fires `voiceschanged`. The first entry is `Follow system` (empty-string override); a long list (macOS premium: hundreds; headless test: zero) is the reason this is a `<select>` rather than a `Segmented`.

The provider abstraction lives in `packages/web/src/features/chat/companion-tts/`:

- `provider.ts` — `CompanionTtsProvider` interface (`listVoices / speak / cancel / id`). `speak` returns once the utterance starts, not when it finishes, so callers can chain without racing.
- `webspeech.ts` — the Web Speech implementation. Wraps `window.speechSynthesis`, exposes `readyVoices()` as an async helper for the picker (Chromium's `getVoices()` returns an empty array until `voiceschanged` fires; the hook waits up to 1.5 s before giving up with whatever is there, so the picker never stays in a "loading" state in headless environments). Rate / pitch / volume inputs are clamped to the API's effective range at the wrapper boundary so a settings slider cannot produce a silent no-op.
- `registry.ts` — `createTtsProvider(id)` mapping closed enum → instance. `"off"` returns `null` (the `useTts` hook's `speak` short-circuits without ever touching `speechSynthesis`).
- `use-tts.ts` — React hook. Constructs a provider on first use and drops it on provider change (safe because Web Speech is global and paid providers will move into `useRef` once they need cached auth).

The floating window (`packages/web/src/features/chat/companion-page.tsx`) calls `tts.speak(bubble.text, { lang })` whenever its bubble appears. `lang` is the result of `detectLang()` (the same locale-sniff helper the banner already uses), and the provider does the lang → voice mapping internally. Banner / widget stay visual-only — the chat tab is the main interactive surface, where browser autoplay policy would silently block the audio anyway, and where an unsolicited voice would surprise a user typing into the composer.

## Server-side validation

`UiPrefs` grows two optional fields (`packages/server/src/api/types.ts`):

```ts
companionTtsProvider?: CompanionTtsProvider;  // "off" | "webspeech"
companionTtsVoice?: string;                    // trimmed, ≤ 64 chars
```

Both are validated on write by `packages/server/src/services/companion-prefs.ts`: `validateCompanionTtsProvider` rejects unknown strings (the same closed-enum pattern as `validateCompanionPronoun`), `validateCompanionTtsVoice` trims and length-caps. A rejected write stores nothing and returns 400 — the route-level contract mirrored from the existing `draftShortcuts` and `companionName` validators. The shallow-merge `PUT /api/me/prefs` semantics are unchanged.

The web `useCompanionStore` exposes `ttsProvider / ttsVoice / setTtsProvider / setTtsVoice` alongside the existing identity fields, hydrates from `GET /api/me/prefs` through `companionTtsFromPrefs` (defaults: `"off"` + empty string for an old prefs file), and writes through `PUT /api/me/prefs` fire-and-forget.

## Compatibility

- **No data migration.** `companionTtsProvider` and `companionTtsVoice` are optional. An old prefs file hydrates with `ttsProvider = "off"`, `ttsVoice = ""` — the same default a brand-new user sees, identical to the pre-L.4 silent behaviour.
- **The chat tab is silent by design.** The bubble continues to render in the banner / widget, but those surfaces never call `useTts`. The audio path runs only inside the Electron floating window, which already has its own (autoplay-unrestricted) audio context.
- **The provider enum is closed.** Adding ElevenLabs / OpenAI / Kokoro is an enum extension on both server (`packages/server/src/api/types.ts`) and web (`packages/web/src/features/chat/companion-store.tsx`), plus a new entry in `registry.ts`. Every call site goes through the registry indirection and does not need to be touched.
- **`prefers-reduced-motion` does not silence audio.** Reduced-motion is a visual preference; an opted-in TTS user has explicitly asked for the pet to speak. A future accessibility setting ("mute pet on focus loss") is the right place to add an opt-out, not the OS preference.
- **The reactive trigger skeleton (L.2) is unaffected.** `useProactiveTrigger` still gates on idle; L.4 only adds the audio path for the bubble reactions that already exist. A later phase wires TTS into the proactive message as well, behind the same `companionTtsFromPrefs` hydration.

## Tests

- `packages/server/test/companion-prefs.test.ts` — 7 new cases across two describe blocks: each provider id round-trips, an unknown provider is rejected with a 400 (and the rejected merge does not clobber a seeded unrelated field), each voice path round-trips, whitespace is trimmed, the empty string is accepted, and an over-cap voice is rejected with the seeded-field-preserved claim.
- `packages/web/test/companion-store.test.ts` — 6 new cases pinning `companionTtsFromPrefs` (default `off`, echo of `webspeech`, fallback on unknown provider, non-string voice) and the closed enum order.
- `packages/web/test/companion-tts/webspeech.test.ts` — 11 cases: `clampForTest` (NaN / out-of-range / in-range), `mapVoicesForTest` (round-trip + empty), `pickVoiceForTest` (empty list, exact voiceURI, fallback to lang match, empty-string voiceId, empty-string lang → defer to browser default).
- `packages/web/test/companion-tts/registry.test.ts` — 3 cases: `createTtsProvider("off")` is `null`, `createTtsProvider("webspeech")` returns a Web Speech instance with `id === "webspeech"`, and the `TTS_PROVIDERS_WITH_VOICES` set contains `webspeech` but not `off` (so the voice picker row only renders when a real provider is active).