/**
 * TTS provider registry — id → instance mapping.
 *
 * The registry is the single point of contact between settings (closed enum
 * on the server) and the provider implementations. Every future TTS engine
 * (ElevenLabs, OpenAI, Kokoro, …) plugs in here; the rest of the pet code goes
 * through this indirection and does not need to know which engine is active.
 *
 * Only the mapping itself is tested here — the provider classes carry their
 * own coverage (`webspeech.test.ts` for the Web Speech pure helpers, manual
 * integration for the live audio). What this file pins is "off" really means
 * off (the floating window must never accidentally speak when the user opted
 * out), and every other id resolves to a non-null provider.
 */
import { describe, expect, it } from "vitest";
import {
  createTtsProvider,
  TTS_PROVIDERS_WITH_VOICES,
} from "../../src/features/chat/companion-tts/registry";

describe("createTtsProvider", () => {
  it("returns null for 'off' — the explicit opt-out must produce no provider", () => {
    // A user who picks "Off" in the picker must hear silence. Returning null
    // rather than a no-op provider means `useTts().speak` short-circuits to
    // `Promise.resolve()` without ever touching `speechSynthesis`.
    expect(createTtsProvider("off")).toBeNull();
  });

  it("returns a Web Speech instance for 'webspeech'", () => {
    const provider = createTtsProvider("webspeech");
    expect(provider).not.toBeNull();
    expect(provider?.id).toBe("webspeech");
  });
});

describe("TTS_PROVIDERS_WITH_VOICES", () => {
  it("contains webspeech and excludes off", () => {
    // The Settings page uses this set to decide whether to render the voice
    // picker row — "off" has no voice to choose, so the row stays hidden.
    expect(TTS_PROVIDERS_WITH_VOICES.has("webspeech")).toBe(true);
    expect(TTS_PROVIDERS_WITH_VOICES.has("off")).toBe(false);
  });
});
