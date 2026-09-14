/**
 * Web Speech ASR provider — `mapError` coverage.
 *
 * The recognizer event lifecycle itself is harder to cover without stubbing
 * the `SpeechRecognition` constructor (the provider only runs in a real
 * browser / Electron renderer). The `mapError` mapper, however, is the most
 * error-prone piece — every Web Speech error code maps to a distinct UI
 * prompt, and a wrong mapping would surface "mic permission denied" to a
 * user whose only problem is a slow network. This test pins that mapping.
 */
import { describe, expect, it } from "vitest";
import { mapErrorForTest } from "../../src/features/chat/companion-asr/webspeech";

describe("mapErrorForTest", () => {
  it("maps 'not-allowed' to permission-denied", () => {
    expect(mapErrorForTest({ error: "not-allowed" })).toEqual({ kind: "permission-denied" });
  });

  it("maps 'service-not-allowed' to permission-denied too", () => {
    // Chromium emits service-not-allowed on some platforms when the OS-level
    // speech service is disabled — same UI prompt as the mic-level denial.
    expect(mapErrorForTest({ error: "service-not-allowed" })).toEqual({
      kind: "permission-denied",
    });
  });

  it("maps 'no-speech' verbatim", () => {
    expect(mapErrorForTest({ error: "no-speech" })).toEqual({ kind: "no-speech" });
  });

  it("maps 'audio-capture' verbatim", () => {
    expect(mapErrorForTest({ error: "audio-capture" })).toEqual({ kind: "audio-capture" });
  });

  it("maps 'network' verbatim", () => {
    expect(mapErrorForTest({ error: "network" })).toEqual({ kind: "network" });
  });

  it("maps 'aborted' verbatim (user-initiated, intentionally silent in the toast)", () => {
    expect(mapErrorForTest({ error: "aborted" })).toEqual({ kind: "aborted" });
  });

  it("routes unknown error codes through the 'other' bucket", () => {
    // Web Speech occasionally emits vendor-specific codes. We do not pretend
    // to know what they mean; the toast shows the recognizer's own message.
    expect(mapErrorForTest({ error: "weird-vendor-code", message: "splat" })).toEqual({
      kind: "other",
      message: "splat",
    });
  });

  it("falls back to the error code string when the message is missing", () => {
    expect(mapErrorForTest({ error: "weird-vendor-code" })).toEqual({
      kind: "other",
      message: "weird-vendor-code",
    });
  });
});
