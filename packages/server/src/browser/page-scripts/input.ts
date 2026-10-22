/**
 * The page side of the trusted-input actions. The input itself is CDP (`Input.*`), which the
 * page cannot tell from a person's; these scripts only find where it goes: the element a click
 * lands on, scrolled into view, and the field typing goes into, focused. JavaScript SOURCE
 * STRINGS, for the reason simplify.ts gives; selectors travel as JSON strings.
 */

/** The text a clicked element is reported by: what a person would read on it, short. */
const LABEL_OF = String.raw`function __jiumateLabelOf(el) {
  if (!el) return '';
  const text = el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('alt') || '';
  return String(text).replace(/\s+/g, ' ').trim().slice(0, 80);
}`;

/**
 * Scrolls the `index`th match of `selector` to the middle of the viewport and resolves the
 * centre of its box, in the CSS pixels CDP's mouse events take. Throws when nothing matches or
 * the element has no size, so a click never lands on a guess.
 */
export function clickTargetScript(selector: string, index: number): string {
  return `${LABEL_OF}
const sel = ${JSON.stringify(selector)};
const index = ${JSON.stringify(index)};
const matches = document.querySelectorAll(sel);
const el = matches[index];
if (!el) throw new Error(matches.length === 0 ? 'No element matches ' + sel : matches.length + ' elements match ' + sel + '; there is no index ' + index);
el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
await new Promise((resolve) => setTimeout(resolve, 60));
const rect = el.getBoundingClientRect();
if (rect.width < 1 || rect.height < 1) throw new Error('The element matching ' + sel + ' has no size on the page (hidden?)');
return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2), tag: el.tagName.toLowerCase(), text: __jiumateLabelOf(el) };`;
}

/** What is at a viewport point, for a click by coordinates. */
export function pointTargetScript(x: number, y: number): string {
  return `${LABEL_OF}
const el = document.elementFromPoint(${JSON.stringify(x)}, ${JSON.stringify(y)});
return el ? { tag: el.tagName.toLowerCase(), text: __jiumateLabelOf(el) } : {};`;
}

/**
 * Focuses the field typing goes into and selects what it holds, so the text replaces it —
 * a form is filled, not appended to. Throws when nothing matches or focus does not land.
 */
export function focusScript(selector: string): string {
  return String.raw`const sel = ${JSON.stringify(selector)};
const el = document.querySelector(sel);
if (!el) throw new Error('No element matches ' + sel);
el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
el.focus();
const active = document.activeElement;
if (active !== el && !el.contains(active)) throw new Error('The element matching ' + sel + ' cannot take focus');
if (typeof el.select === 'function') el.select();
else if (el.isContentEditable) {
  const range = document.createRange();
  range.selectNodeContents(el);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}
return { tag: el.tagName.toLowerCase() };`;
}

/**
 * After inserted text: input and change on the focused element, for controlled components
 * that only take a value from events (the SOP's note on CDP insertText).
 */
export const DISPATCH_INPUT_EVENTS_SCRIPT = String.raw`const el = document.activeElement;
if (!el || el === document.body || el === document.documentElement) return false;
el.dispatchEvent(new Event('input', { bubbles: true }));
el.dispatchEvent(new Event('change', { bubbles: true }));
return true;`;

/**
 * Where the page is scrolled to, after scrolling.
 *
 * The agent needs to know whether the scroll moved anything: a page that is already at the
 * bottom and is asked to scroll down does not move, and a model that is told "scrolled to
 * the bottom" when nothing happened will keep asking.
 */
export function scrollScript(amount: number): string {
  return String.raw`const before = { x: window.scrollX, y: window.scrollY };
const maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
const maxX = Math.max(0, document.documentElement.scrollWidth - window.innerWidth);
const wantY = before.y + ${JSON.stringify(amount)};
const targetY = Math.min(maxY, Math.max(0, wantY));
window.scrollTo({ top: targetY, left: before.x, behavior: 'instant' });
await new Promise((resolve) => setTimeout(resolve, 50));
return {
  moved: window.scrollY !== before.y || window.scrollX !== before.x,
  x: window.scrollX,
  y: window.scrollY,
  atBottom: maxY === 0 || window.scrollY >= maxY - 1,
  atTop: window.scrollY <= 1,
  height: document.documentElement.scrollHeight,
  viewport: window.innerHeight,
};`;
}

/**
 * Chooses an option in a `<select>`, and says what the select holds afterwards.
 *
 * The `change` event is dispatched as well: a select whose handler listens for it — which
 * is most of them — would otherwise keep the old value.
 */
export function selectScript(selector: string, value: string): string {
  return String.raw`const sel = ${JSON.stringify(selector)};
const want = ${JSON.stringify(value)};
const el = document.querySelector(sel);
if (!el) throw new Error('No element matches ' + sel);
if (el.tagName !== 'SELECT') throw new Error('The element matching ' + sel + ' is not a <select>');
const byValue = [...el.options].find((o) => o.value === want);
const byText = [...el.options].find((o) => (o.textContent || '').trim() === want);
const option = byValue ?? byText;
if (!option) throw new Error('The <select> matching ' + sel + ' has no option "' + want + '"');
el.value = option.value;
el.dispatchEvent(new Event('input', { bubbles: true }));
el.dispatchEvent(new Event('change', { bubbles: true }));
return { value: el.value, label: (option.textContent || '').trim() };`;
}
