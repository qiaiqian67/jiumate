/**
 * The page side of the waiting.
 *
 * A wait is one call that ends when the page is ready, instead of a scan every second until
 * it is. That is not a convenience: a scan costs the model thousands of tokens, and a model
 * that polls a loading page spends its budget on the polling.
 *
 * The page watches itself, in its own frame, and reports when the condition holds. So one
 * `Runtime.evaluate` does the whole waiting — no round trip per poll, and the wait ends the
 * instant the condition is true rather than on the next tick.
 *
 * JavaScript SOURCE STRING, for the reason simplify.ts gives.
 */

/** What a wait is waiting for. */
export type WaitFor = "visible" | "hidden" | "stable" | "text" | "load";

/**
 * The page's side of a wait.
 *
 * `visible` — the selector matches an element that is in the page and can be seen.
 * `hidden` — the selector matches nothing, or what it matches cannot be seen.
 * `stable` — the page stopped changing: the same text, the same number of elements, for a
 *   moment. This is the one that matters most, because a page that is still rendering shows
 *   content that is about to change, and a model that reads it now reads it wrong.
 * `text` — the selector's element holds the given text.
 * `load` — the page is done loading and not loading anything more.
 */
export function waitScript(
  selector: string,
  forWhat: WaitFor,
  text: string | null,
  timeoutMs: number,
  settleMs: number,
): string {
  return String.raw`const sel = ${JSON.stringify(selector)};
const what = ${JSON.stringify(forWhat)};
const want = ${JSON.stringify(text)};
const limit = ${JSON.stringify(timeoutMs)};
const settle = ${JSON.stringify(settleMs)};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isVisible = (el) => {
  if (!el) return false;
  const box = el.getBoundingClientRect();
  if (box.width < 1 || box.height < 1) return false;
  const style = window.getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
};

const snapshot = () => ({
  text: (document.body ? document.body.innerText : '').replace(/\s+/g, ' ').trim().slice(0, 4000),
  count: document.querySelectorAll('*').length,
  loading: document.readyState === 'loading',
});

const holds = () => {
  if (what === 'load') return document.readyState === 'complete';
  const el = sel ? document.querySelector(sel) : null;
  if (what === 'visible') return isVisible(el);
  if (what === 'hidden') return !isVisible(el);
  if (what === 'text') {
    if (!el) return false;
    const own = (el.innerText || el.value || el.textContent || '').replace(/\s+/g, ' ').trim();
    return want === null || own.includes(want);
  }
  return true;
};

const started = Date.now();
let last = snapshot();
let unchangedSince = Date.now();

while (Date.now() - started < limit) {
  if (holds()) {
    if (what !== 'stable') {
      return { ok: true, waited: Date.now() - started, what };
    }
    return { ok: true, waited: Date.now() - started, what };
  }
  if (what === 'stable') {
    const now = snapshot();
    if (now.text !== last.text || now.count !== last.count) {
      last = now;
      unchangedSince = Date.now();
    } else if (Date.now() - unchangedSince >= settle) {
      return { ok: true, waited: Date.now() - started, what, settledFor: Date.now() - unchangedSince };
    }
  }
  await sleep(100);
}

return {
  ok: false,
  waited: Date.now() - started,
  what,
  reason: sel ? 'No element matches ' + sel + ' (or it is not visible yet)' : 'The page did not settle',
};`;
}
