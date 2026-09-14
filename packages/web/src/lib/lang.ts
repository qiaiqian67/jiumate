/**
 * Cheap one-shot language sniff. Used wherever a component renders
 * bilingual copy (the companion preset picker, the SVG pet's status
 * bubble) without paying the cost of the full i18n catalog.
 *
 * Two letters matter: `zh` for CJK locales, everything else falls back to
 * `en`. We do not try to distinguish `zh-CN` from `zh-TW` here — both
 * locales render the same Simplified-Chinese micro-copy and a future
 * i18n catalog can extend the union without changing this helper.
 *
 * Returns "en" on the server (no `navigator`) so SSR / unit tests get a
 * deterministic value.
 */
export function detectLang(): "zh" | "en" {
  if (typeof navigator === "undefined") return "en";
  const raw = navigator.language.toLowerCase();
  return raw.startsWith("zh") ? "zh" : "en";
}
