/**
 * Web Speech TTS provider — pure-helper coverage.
 *
 * The provider itself talks to `window.speechSynthesis`, which is not available
 * in this package's node-only vitest run. The two pieces of logic worth
 * pinning in a unit test — voice matching and rate / pitch clamping — are
 * exposed as `_ForTest` accessors so they can run without a DOM.
 */
import { describe, expect, it } from "vitest";
import {
  clampForTest,
  mapVoicesForTest,
  pickVoiceForTest,
} from "../../src/features/chat/companion-tts/webspeech";

const fakeVoice = (overrides: Partial<SpeechSynthesisVoice>): SpeechSynthesisVoice => ({
  voiceURI: overrides.voiceURI ?? "uri-default",
  name: overrides.name ?? "Default",
  lang: overrides.lang ?? "en-US",
  localService: overrides.localService ?? true,
  default: overrides.default ?? false,
});

describe("clampForTest", () => {
  it("returns the fallback for undefined / non-finite", () => {
    expect(clampForTest(undefined, 0.5, 2, 1)).toBe(1);
    expect(clampForTest(Number.NaN, 0.5, 2, 1)).toBe(1);
    expect(clampForTest(Number.POSITIVE_INFINITY, 0.5, 2, 1)).toBe(1);
  });

  it("clamps below the floor to the floor", () => {
    expect(clampForTest(0.1, 0.5, 2, 1)).toBe(0.5);
    expect(clampForTest(-5, 0.5, 2, 1)).toBe(0.5);
  });

  it("clamps above the ceiling to the ceiling", () => {
    expect(clampForTest(3, 0.5, 2, 1)).toBe(2);
    expect(clampForTest(Number.MAX_SAFE_INTEGER, 0.5, 2, 1)).toBe(2);
  });

  it("passes in-range values through unchanged", () => {
    expect(clampForTest(0.5, 0.5, 2, 1)).toBe(0.5);
    expect(clampForTest(1.5, 0.5, 2, 1)).toBe(1.5);
    expect(clampForTest(2, 0.5, 2, 1)).toBe(2);
  });
});

describe("mapVoicesForTest", () => {
  it("maps every SpeechSynthesisVoice to a CompanionTtsVoice verbatim", () => {
    const list = mapVoicesForTest([
      fakeVoice({ voiceURI: "uri-1", name: "Tingting", lang: "zh-CN" }),
      fakeVoice({ voiceURI: "uri-2", name: "Samantha", lang: "en-US" }),
    ]);
    expect(list).toEqual([
      { id: "uri-1", label: "Tingting (zh-CN)", lang: "zh-CN" },
      { id: "uri-2", label: "Samantha (en-US)", lang: "en-US" },
    ]);
  });

  it("returns an empty array for an empty input", () => {
    expect(mapVoicesForTest([])).toEqual([]);
  });
});

describe("pickVoiceForTest", () => {
  const voices = [
    fakeVoice({ voiceURI: "uri-zh", name: "Tingting", lang: "zh-CN" }),
    fakeVoice({ voiceURI: "uri-en", name: "Samantha", lang: "en-US" }),
  ];

  it("returns null when the list is empty (browser will pick its own default)", () => {
    expect(pickVoiceForTest([], "uri-zh", "zh-CN")).toBeNull();
  });

  it("matches an exact voiceURI when given", () => {
    expect(pickVoiceForTest(voices, "uri-en", "zh-CN")?.voiceURI).toBe("uri-en");
  });

  it("falls back to a lang match when voiceURI is missing or unknown", () => {
    // Unknown voice id: pickVoice must NOT throw; it falls through to the
    // lang lookup. This is what keeps the picker from breaking when a stored
    // voice id points to a voice that the current OS does not ship.
    expect(pickVoiceForTest(voices, "uri-not-installed", "zh-CN")?.voiceURI).toBe("uri-zh");
  });

  it("ignores empty-string voiceId (the 'follow system' setting)", () => {
    expect(pickVoiceForTest(voices, "", "zh-CN")?.voiceURI).toBe("uri-zh");
  });

  it("ignores empty-string lang and returns null (let the browser decide)", () => {
    // With no overrides, the helper deliberately defers to the browser rather
    // than picking "the first voice" — every OS has different defaults and
    // picking the first one would be wrong on macOS / Windows / Linux.
    expect(pickVoiceForTest(voices, "", "")).toBeNull();
  });
});
