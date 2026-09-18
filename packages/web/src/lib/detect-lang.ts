/**
 * Detects the host UI language and reduces it to either "zh" or "en".
 *
 * Lifted out of the former `companion-banner-helpers.ts` after the AI 伴侣
 * feature was removed. Kept simple: anything matching a CN / HK / TW / SG /
 * Hans / Hant language tag counts as Chinese; everything else is English.
 * The composer feeds the result into a speech recognizer's `lang` hint so
 * future mic features can default to the right model.
 */
export function detectLang(): "zh" | "en" {
  if (typeof navigator === "undefined") return "en";
  const raw = navigator.language ?? "en";
  const lowered = raw.toLowerCase();
  if (lowered.startsWith("zh") || lowered.includes("-hans") || lowered.includes("-hant")) {
    return "zh";
  }
  return "en";
}
