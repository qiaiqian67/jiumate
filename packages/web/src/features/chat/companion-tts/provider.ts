/**
 * TTS provider contract — the surface every concrete provider implements so the
 * pet can swap between Web Speech, ElevenLabs, OpenAI, local Kokoro, … without
 * the calling site caring which one is active.
 *
 * Why an interface (and not a function library): a TTS call has lifecycle —
 * `speak` returns before the audio finishes, and `cancel` must interrupt a
 * long-running utterance before the next one starts. A web of free functions
 * cannot model that without sharing globals, and we want the floating-window
 * page to be able to instantiate one provider per render and drop it on
 * unmount without leaking background utterances.
 *
 * Browser vs Node: this module is renderer-only. It imports `window` /
 * `speechSynthesis` lazily inside the Web Speech implementation so a node-only
 * vitest run does not pull in a DOM.
 */

/** One voice the user can pick from. Provider-specific: Web Speech supplies
 *  `voiceURI` + `lang` + `name`; paid providers supply their own id strings. */
export interface CompanionTtsVoice {
  /** Provider-specific opaque id. Persisted as `companionTtsVoice`. */
  readonly id: string;
  /** Human-readable label for the picker ("Microsoft Huihui — zh-CN"). */
  readonly label: string;
  /** BCP-47 language tag, when the provider exposes one. Empty string otherwise. */
  readonly lang: string;
}

/** Options the caller passes to `speak`. The provider is free to ignore fields
 *  it does not understand; this matches the Web Speech API surface where
 *  `lang`, `voice`, `rate` and `pitch` are all optional. */
export interface CompanionTtsOptions {
  /** BCP-47 language tag ("zh-CN", "en-US"). Empty string = let the provider
   *  pick. The provider maps it to the matching voice if possible. */
  lang?: string;
  /** Override the provider's default voice. Empty string = provider default. */
  voiceId?: string;
  /** 0.5..2.0; default 1.0. Out-of-range values are clamped, not rejected. */
  rate?: number;
  /** 0.5..2.0; default 1.0. Same clamping. */
  pitch?: number;
  /** 0..1; default 1.0. The Web Speech API exposes this on `volume`. */
  volume?: number;
}

export interface CompanionTtsProvider {
  /** Provider id, mirrored from the user setting so logs can show which one fired. */
  readonly id: string;
  /** Voices the user can pick from. May be empty (e.g. some paid providers
   *  surface voices lazily on first call). Order is the picker's order. */
  listVoices(): readonly CompanionTtsVoice[];
  /** Speak `text`. Resolves once the utterance starts playing (not when it
   *  finishes), so callers can chain `speak(...)` → `speak(...)` without
   *  racing the prior one. The provider is responsible for cancelling any
   *  prior utterance first; the contract is "at most one utterance at a time". */
  speak(text: string, opts?: CompanionTtsOptions): Promise<void>;
  /** Cancel the in-flight utterance, if any. No-op when nothing is playing. */
  cancel(): void;
}
