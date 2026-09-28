/**
 * The pre-paint appearance cache.
 *
 * The mounted app applies its appearance from React effects, which run after the first paint —
 * long enough to see the built-in palette and then watch it get replaced. `index.html` carries
 * an inline script that reads this cache before the body is parsed and sets the same attributes
 * and stylesheet the app would have, so a reload's first paint is already correct.
 *
 * The payload is a CACHE, never a source of truth. A stale, foreign or unparsable value must
 * degrade to the built-in appearance rather than to a broken one, so the reader skips anything
 * whose `v` it does not recognise, and the writer always overwrites. `skin-bootstrap.test.ts`
 * pins the shape against the inline script, which cannot import this module and therefore
 * repeats it in plain JS.
 */
export const SKIN_BOOTSTRAP_KEY = "jiumate.skin.bootstrap";

/** Bumped whenever the payload shape changes; an unrecognised version is ignored, not migrated. */
export const SKIN_BOOTSTRAP_VERSION = 1;

export interface SkinBootstrapPayload {
  v: number;
  dark: boolean;
  /** Resolved skin id for the mode in effect, or null for the built-in appearance. */
  skin: string | null;
  accent: string;
  /** True when the skin claims the accent pair, so no `data-accent` is written. */
  ownsAccent: boolean;
  /** Root font-size, as a CSS length. */
  font: string;
  /** The rendered skin stylesheet, exactly as `applySkin` wrote it into the document. */
  css: string;
}

/**
 * Record the appearance this page is showing.
 *
 * Best-effort: site data can be blocked or full, and neither is a reason for a theme change to
 * throw. The cost of a failed write is one flash on the next load.
 */
export function writeSkinBootstrap(payload: SkinBootstrapPayload): void {
  try {
    localStorage.setItem(SKIN_BOOTSTRAP_KEY, JSON.stringify(payload));
  } catch {
    /* best-effort */
  }
}

/** Drop the cache, so the next load paints the built-in appearance. */
export function clearSkinBootstrap(): void {
  try {
    localStorage.removeItem(SKIN_BOOTSTRAP_KEY);
  } catch {
    /* best-effort */
  }
}
