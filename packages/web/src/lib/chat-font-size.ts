/**
 * Reader font size for the chat message stream (pure decisions, unit tested).
 *
 * ## What it scales, and what it deliberately does not
 *
 * It sets ONE custom property, `--chat-font-size`, on the document root. Everything that
 * should grow with the reader's choice then derives from that one number:
 *
 * - `.md-body` (assistant Markdown) declares `font-size: var(--chat-font-size)`. It had NO
 *   font-size of its own before — it inherited from the `text-base` utility on its wrapper —
 *   so pointing it at the variable is the whole change for message bodies.
 * - The user message chip and the composer inherit through the same root, because a reader
 *   who needs bigger type needs it in the question they are answering too.
 *
 * What it does NOT scale: code blocks, tool cards, and the many `text-xs` metadata rows
 * (timestamps, badges, token counters). Those are chrome — a 13px tool badge is chrome
 * whether the prose is 14px or 18px, and scaling them all would mean threading the variable
 * through dozens of components that have no business knowing a reading preference exists.
 * Code blocks keep their own smaller fixed size for a different reason: their content is
 * monospace source that must not reflow into unreadable prose wrapping.
 *
 * ## Why root rather than a context provider
 *
 * A React context would have to be threaded into `MessageStream`, `SubagentsView`, the
 * Workspace preview and anywhere else a Markdown body renders — and every one of them would
 * need to pass it down. A root custom property reaches all of them with no wiring, and it
 * survives `localStorage` restore before the first render (the store writes it in an effect
 * on mount, and the initializer applies it synchronously).
 *
 * ## Storage
 *
 * One global key (`jiumate.…` convention), injectable storage (pinned-sessions.ts convention:
 * vitest runs in Node with no localStorage). Absent / unrecognized / throwing storage all
 * fall back to `medium` — the app's current rendering, so the default is a no-op rather than
 * a visual change on first load.
 */

/** The three reader sizes. `medium` is the app's existing size and the default. */
export const CHAT_FONT_SIZES = ["small", "medium", "large"] as const;
export type ChatFontSize = (typeof CHAT_FONT_SIZES)[number];

/**
 * The px value each size maps to. Spacing is the point of a reader control, so these are
 * chosen for comfortable sustained reading (a chat session is often minutes of prose) rather
 * than to span the Tailwind scale: 14 / 16 / 18, with `medium` pinned to 16 — the exact value
 * `text-base` resolves to — so the default rendering is byte-identical to before.
 */
export const CHAT_FONT_PX: Record<ChatFontSize, number> = {
  small: 14,
  medium: 16,
  large: 18,
};

/** Minimal storage interface (the subset of localStorage used here); tests inject an in-memory implementation. */
export interface ChatFontSizeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The single global key; holds one of the CHAT_FONT_SIZES values. */
export const CHAT_FONT_SIZE_KEY = "jiumate.chatFontSize";

/**
 * Reads the persisted size. Only an exact member of CHAT_FONT_SIZES is accepted — anything
 * else (absent, a stale value from a future build, hand-edited junk) is the default rather
 * than a thrown render. `localStorage` is resolved INSIDE the try, never as a default
 * parameter: merely touching it throws a SecurityError when site data is blocked (or in a
 * partitioned iframe), and this runs from a useState initializer.
 */
export function loadChatFontSize(storage?: ChatFontSizeStorage): ChatFontSize {
  try {
    const raw = (storage ?? localStorage).getItem(CHAT_FONT_SIZE_KEY);
    return (CHAT_FONT_SIZES as readonly string[]).includes(raw ?? "")
      ? (raw as ChatFontSize)
      : "medium";
  } catch {
    return "medium";
  }
}

/** Writes the size (best-effort: quota limits / private browsing fail silently). */
export function storeChatFontSize(size: ChatFontSize, storage?: ChatFontSizeStorage): void {
  try {
    (storage ?? localStorage).setItem(CHAT_FONT_SIZE_KEY, size);
  } catch {
    /* best-effort persistence */
  }
}

/**
 * The CSS custom property's value for a size, e.g. `16px`. Separate from CHAT_FONT_PX so the
 * numeric scale is not welded to its CSS formatting — a future `rem`-based scale changes one
 * function, not every consumer's unit assumptions.
 */
export function chatFontSizeVar(size: ChatFontSize): string {
  return `${CHAT_FONT_PX[size]}px`;
}

/**
 * Writes the custom property onto a document element. Takes the element rather than reaching
 * for `document` so tests can pass a stub and assert the exact declaration.
 */
export function applyChatFontSize(size: ChatFontSize, el: { style: { setProperty(k: string, v: string): void } }): void {
  el.style.setProperty("--chat-font-size", chatFontSizeVar(size));
}
