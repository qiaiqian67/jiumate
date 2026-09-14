/**
 * Pure helpers for `companion-banner.tsx`, kept in a sibling module so they can be
 * unit-tested without rendering the React component (the banner depends on
 * `useCompanionStore` + `useSessionStream` + DOM, none of which a fast unit test wants).
 *
 * None of these touch React state — they're imported by the banner component and by
 * the unit test in `test/companion-banner-helpers.test.ts`.
 */

/** A short, neutral reaction pool. Picked deterministically on every turn completion
 *  (the seed flips on each running → idle transition). Stay generic so the banner never
 *  feigns an emotion it can't actually read; the Agent's own reply carries the real one. */
const REACTIONS_ZH = ["嗯嗯", "辛苦了", "继续加油", "收到", "🫶"];
const REACTIONS_EN = ["mm-hm", "you got this", "noted", "✨", "🫶"];

/** Pick a reaction in the current UI language. Stable per call — a re-render with the
 *  same `seed` returns the same pick (the seed flips on every turn boundary). */
export function pickReaction(seed: number, lang: "zh" | "en"): string {
  const pool = lang === "zh" ? REACTIONS_ZH : REACTIONS_EN;
  return pool[seed % pool.length]!;
}

/** Read the current UI locale off the same key the language store writes. Avoids
 *  pulling in another context dep — the catalog only ships two languages and the
 *  shape is fixed at "zh" | "en" everywhere else in the app. */
export function detectLang(): "zh" | "en" {
  const stored = localStorage.getItem("linsight.lang");
  if (stored === "zh" || stored === "en") return stored;
  return navigator.language.startsWith("zh") ? "zh" : "en";
}
