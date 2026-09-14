/**
 * ASR provider registry — closed-enum → instance mapping.
 *
 * Mirrors `companion-tts/registry.test.ts`: the registry is the only place
 * that needs to be aware of every concrete provider, and the chat composer
 * consumes it via the `useAsr` hook. The closed enum (`off | webspeech`) is
 * what makes the hook safe to call unconditionally — adding a new provider
 * is a one-place change in the registry plus an enum extension.
 */
import { describe, expect, it } from "vitest";
import { createAsrProvider } from "../../src/features/chat/companion-asr/registry";
import { WebSpeechAsrProvider } from "../../src/features/chat/companion-asr/webspeech";

describe("createAsrProvider", () => {
  it("returns null for 'off' (the composer's mic button hides itself)", () => {
    expect(createAsrProvider("off")).toBeNull();
  });

  it("returns a WebSpeechAsrProvider instance for 'webspeech'", () => {
    const provider = createAsrProvider("webspeech");
    expect(provider).not.toBeNull();
    expect(provider).toBeInstanceOf(WebSpeechAsrProvider);
    expect(provider?.id).toBe("webspeech");
  });
});
