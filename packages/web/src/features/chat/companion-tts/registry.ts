/**
 * TTS provider registry.
 *
 * Maps a `CompanionTtsProvider` id to a concrete `CompanionTtsProvider`
 * implementation. Adding a new provider (ElevenLabs, OpenAI, Kokoro, …) means
 * dropping a class here and extending the closed enum on both server and
 * client — every caller goes through this single file, so the rest of the
 * pet code does not change.
 *
 * Construct on each call (rather than caching a singleton): the Web Speech
 * handle is global, but paid providers carry configuration (API key, fetch
 * instance) and per-instance state (in-flight utterance). Keeping construction
 * local lets a future consumer hold a per-floating-window provider without
 * leaking across mounts.
 */
import type { CompanionTtsProvider as TtsProviderId } from "../companion-store";
import type { CompanionTtsProvider } from "./provider";
import { WebSpeechProvider } from "./webspeech";

export function createTtsProvider(id: TtsProviderId): CompanionTtsProvider | null {
  switch (id) {
    case "webspeech":
      return new WebSpeechProvider();
    case "off":
      return null;
  }
}

/** Provider ids that produce actual audio output. The picker uses this to
 *  decide whether to render a voice-list sub-row. */
export const TTS_PROVIDERS_WITH_VOICES: ReadonlySet<TtsProviderId> = new Set(["webspeech"]);
