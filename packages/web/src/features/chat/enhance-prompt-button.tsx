/**
 * 优化提示词 — the composer's rewrite button.
 *
 * One click sends the current draft to the server, which has a model restate it as a clearer
 * instruction, and puts the result **back into the same text box**. It is deliberately not a
 * send: the whole point is that the user reads what the rewrite says, fixes what it got wrong,
 * and presses Send themselves. A rewrite nobody checks would quietly change what they asked,
 * and a badly-comprehended request is the exact failure this button exists to prevent — so
 * replacing their text without asking would reproduce it one step later.
 *
 * Two behaviours worth naming, both from that contract:
 *
 * - **The user's words are replaced, never appended.** The result is checked before it lands:
 *   an empty draft does nothing, and a failed call leaves the box exactly as it was. A rewrite
 *   arriving empty would delete what they typed.
 * - **The caret goes to the end.** They are about to read and edit, and leaving the caret
 *   where the old text ended (or at 0) puts their cursor in the wrong place for that.
 *
 * Rendered as a pill beside the other toolbar controls rather than as a bare icon: it is a
 * named action with a visible label, not one of the icon tools, and an unlabeled button here
 * would not say what it does to a draft.
 */
import { useCallback, useRef, useState } from "react";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { toastError } from "../../components/ui/toast";
import { S } from "../../lib/strings";
import { enhancePrompt } from "../../api/endpoints";

/**
 * Wand/sparkle glyph, the convention other "do something to my text" affordances use. Drawn
 * as two strokes so it reads at 16px: a four-point sparkle over a small one, which stays
 * legible where a five-point star turns to mush.
 */
const ENHANCE_ICON =
  "M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3zM18.5 14l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z";

/** One line, one action. */
interface EnhancePromptButtonProps {
  /** Project whose default model does the rewriting. */
  projectId: string;
  /** Current draft; empty disables the button. */
  text: string;
  /**
   * Receives the rewritten instruction. The caller owns the text body, so it applies the
   * result through the same path a keystroke would (state + the draft cache callback), keeping
   * the auto-save and the undo path consistent.
   */
  onEnhanced: (prompt: string) => void;
  /** Whether the composer is mid-run: rewriting is pointless then, since the box is inert. */
  disabled?: boolean;
}

export function EnhancePromptButton({
  projectId,
  text,
  onEnhanced,
  disabled = false,
}: EnhancePromptButtonProps) {
  const [busy, setBusy] = useState(false);
  /**
   * Drops a result whose user has typed since the request went out. Without this, a slow
   * rewrite lands on top of whatever they wrote while waiting and silently destroys it — the
   * button is usually used on a draft they are actively revising.
   */
  const draftAtRequest = useRef("");
  const hasDraft = text.trim().length > 0;

  const run = useCallback(async () => {
    const draft = text.trim();
    if (busy || !hasDraft) return;
    draftAtRequest.current = text;
    setBusy(true);
    try {
      const res = await enhancePrompt(projectId, draft);
      if (text !== draftAtRequest.current) return;
      if (res.ok) {
        onEnhanced(res.prompt);
        return;
      }
      // `no_model` is the one code that means the user has to go and do something; the rest are
      // "try again", and none of them touch the draft.
      toastError(
        res.code === "no_model"
          ? S.chat.enhancePromptNoModel
          : res.code === "no_result"
            ? S.chat.enhancePromptNoResult
            : S.chat.enhancePromptFailed,
      );
    } catch {
      if (text !== draftAtRequest.current) return;
      toastError(S.chat.enhancePromptFailed);
    } finally {
      setBusy(false);
    }
  }, [busy, hasDraft, projectId, text, onEnhanced]);

  return (
    <button
      type="button"
      title={S.chat.enhancePromptDesc}
      aria-label={S.chat.enhancePrompt}
      aria-busy={busy}
      disabled={disabled || busy || !hasDraft}
      onClick={() => void run()}
      className="flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-gray-100/70 px-2.5 text-xs text-gray-600 transition-colors duration-150 hover:bg-gray-200/70 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gray-800/60 dark:text-gray-300 dark:hover:bg-gray-700/60 dark:hover:text-gray-100"
    >
      <GlyphIcon d={ENHANCE_ICON} size={16} className={busy ? "animate-pulse" : ""} />
      <span className="whitespace-nowrap">
        {busy ? S.chat.enhancePromptBusy : S.chat.enhancePrompt}
      </span>
    </button>
  );
}
