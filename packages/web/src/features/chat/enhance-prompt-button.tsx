/**
 * 优化提示词 — the composer's rewrite control, and the 撤回 that undoes it.
 *
 * One click sends the current draft to the server, which has a model restate it as a clearer
 * instruction, and puts the result **back into the same text box**. It is deliberately not a
 * send: the whole point is that the user reads what the rewrite says, fixes what it got wrong,
 * and presses Send themselves. A rewrite nobody checks would quietly change what they asked,
 * and a badly-comprehended request is the exact failure this control exists to prevent.
 *
 * Lives **inside ChatInput**, not in the draft page. It is a property of a composer, not of a
 * route: a user hits the same incomprehensible-prompt wall on the fifth turn of a conversation as
 * on the empty box, and the fix is most valuable exactly there — mid-conversation, where the
 * model has already been given half an answer built on their sloppy wording. Hosting it in
 * draft-view gave the draft page a control the session composer did not have, which is the wrong
 * way round.
 *
 * Behaviours worth naming, all of them from that contract:
 *
 * - **The user's words are replaced, never appended.** The result is checked before it lands:
 *   an empty draft does nothing, and a failed call leaves the box exactly as it was. A rewrite
 *   arriving empty would delete what they typed.
 * - **The caret goes to the end.** They are about to read and edit, and leaving the caret
 *   where the old text ended (or at 0) puts their cursor in the wrong place for that.
 * - **The draft is read at click time, from the composer.** An earlier version took the draft
 *   as a prop fed from a ref the parent updates without re-rendering, so the click handler
 *   closed over a snapshot: after the user cleared the box and typed something else, the button
 *   rewrote the *previous* prompt.
 * - **A slow result is dropped, and the guard actually fires.** The old check compared a
 *   captured prop against a copy of that same prop, so it was always equal and never dropped
 *   anything. Both sides come from the live draft now.
 * - **撤回 appears only while it is safe**, i.e. while the text still *is* the rewrite. Once
 *   the user edits it, restoring would throw away their words to bring back a version they have
 *   already moved past — a wrong trade, and one that cannot be undone. A keystroke hides it;
 *   that is the whole invalidation rule.
 * - **One control, two states.** It becomes the undo button in place rather than growing a
 *   sibling, because the two are mutually exclusive by construction — there is nothing to undo
 *   until there has been a rewrite, and nothing to rewrite once there is an undo — and a second
 *   button would spend toolbar width on a control that is disabled most of the time.
 */
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { toastError, toastInfo } from "../../components/ui/toast";
import { S } from "../../lib/strings";
import { enhancePrompt } from "../../api/endpoints";
import { useProject } from "../../state/project";

/**
 * Wand/sparkle glyph, the convention other "do something to my text" affordances use. Drawn
 * as two strokes so it reads at 16px: a four-point sparkle over a small one, which stays
 * legible where a five-point star turns to mush.
 */
const ENHANCE_ICON =
  "M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3zM18.5 14l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z";

/** Undo arrow, matching the app's icon weight. */
const RESTORE_ICON = "M9 14L4 9l5-5M4 9h9a7 7 0 0 1 0 14h-3";

interface EnhancePromptControlProps {
  /** Live accessors into the composer's text body (ComposerControl). */
  readText: () => string;
  subscribeText: (listener: (text: string) => void) => () => void;
  /** Applies a replacement to the text body — the rewrite, and the undo of it. */
  onReplace: (prompt: string) => void;
}

export function EnhancePromptControl({
  readText,
  subscribeText,
  onReplace,
}: EnhancePromptControlProps) {
  /**
   * The Project whose default model does the rewriting. Read here rather than passed in: the
   * control is part of the composer, so requiring every composer host (draft page, session page)
   * to thread a project id down for it would be a prop that exists only to serve this button.
   * Absent (no project loaded, or rendering outside one) the control simply does not render.
   */
  const { currentProject } = useProject();
  const projectId = currentProject?.projectId;

  /**
   * The live draft, via a subscription rather than a prop. `useSyncExternalStore` is what
   * makes the read side consistent with React: it re-reads on every render, so a value read
   * during a click is never a torn or stale one the way a captured prop was.
   */
  const text = useSyncExternalStore(subscribeText, readText, readText);
  const [busy, setBusy] = useState(false);
  /**
   * The rewrite and the draft it replaced, kept as a pair so 撤回 can put the original back.
   * `null` = nothing to undo.
   *
   * A **pair, not just the original**, because the undo is only offered while the text still
   * *is* the rewrite (see `canRestore`). Keeping the rewritten text alongside is what makes that
   * check possible without an effect: an earlier version cleared the undo from a `[text]`
   * effect, which fired on the very render that landed the rewrite and so hid the button
   * immediately — the undo was unclickable, not merely unused.
   */
  const [restorePoint, setRestore] = useState<{ original: string; rewritten: string } | null>(null);
  /**
   * The draft at request time, compared against the live text when the response lands. The
   * bug this replaces compared a captured `text` against a copy of that same `text`, so it
   * was always equal and a slow rewrite would land on top of whatever the user typed while
   * waiting. Both sides now come from the live draft.
   */
  const draftAtRequest = useRef("");
  const hasDraft = text.trim().length > 0;
  /**
   * Undo is offered only while the box still holds the rewrite untouched. The moment the user
   * edits it, restoring would throw away their words to bring back a version they have already
   * moved past — a trade that cannot be undone, so the control simply withdraws.
   */
  const canRestore = restorePoint !== null && text === restorePoint.rewritten && !busy;

  const run = useCallback(async () => {
    const draft = readText().trim();
    if (busy || !draft) return;
    draftAtRequest.current = draft;
    setBusy(true);
    try {
      const res = await enhancePrompt(projectId!, draft);
      // Dropped if the draft changed while the request was in flight.
      if (readText().trim() !== draftAtRequest.current) return;
      if (res.ok) {
        onReplace(res.prompt);
        // Only an actual change is undoable: if the model echoed the draft back, the two are
        // equal and an undo that "restores" identical text would be a dead control.
        if (res.prompt !== draft) setRestore({ original: draft, rewritten: res.prompt });
        toastInfo(S.chat.enhancePromptDone);
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
      if (readText().trim() !== draftAtRequest.current) return;
      toastError(S.chat.enhancePromptFailed);
    } finally {
      setBusy(false);
    }
  }, [busy, projectId, readText, onReplace]);

  const restoreOriginal = useCallback(() => {
    if (restorePoint === null) return;
    onReplace(restorePoint.original);
    // Clearing on use keeps the stored draft from lingering behind a later rewrite, and the
    // control returns to its rewrite state anyway.
    setRestore(null);
  }, [restorePoint, onReplace]);

  if (!projectId) return null;

  const isUndo = canRestore;
  const label = busy
    ? S.chat.enhancePromptBusy
    : isUndo
      ? S.chat.enhancePromptRestore
      : S.chat.enhancePrompt;
  const hint = busy
    ? S.chat.enhancePromptBusy
    : isUndo
      ? S.chat.enhancePromptRestoreDesc
      : S.chat.enhancePromptDesc;

  return (
    <button
      type="button"
      // No visible text: this is an icon control in a toolbar that already has labelled pills,
      // and a permanent label would spend width on a button whose meaning is carried by its
      // glyph. The native tooltip appears on hover, and aria-label keeps it announced.
      title={hint}
      aria-label={label}
      aria-busy={busy}
      disabled={busy || (!isUndo && !hasDraft)}
      onClick={() => (isUndo ? restoreOriginal() : void run())}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-500 transition-colors duration-150 hover:bg-gray-200/70 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-400 dark:hover:bg-gray-700/60 dark:hover:text-gray-100"
    >
      <GlyphIcon
        d={isUndo ? RESTORE_ICON : ENHANCE_ICON}
        size={16}
        className={busy ? "animate-pulse" : ""}
      />
    </button>
  );
}
