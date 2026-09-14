/**
 * AI companion banner — a thin card pinned above the composer that gives the on/off
 * toggle a visible face. Three states, each with its own micro-copy and SVG pose:
 *
 *   idle      "我在陪你" — the pet sits, eyes open, slow tail sway
 *   running   "在想…"   — the pet sits, eyes closed, thinking
 *   just done bubble pops below the pet with a one-word reaction; fades after 4s
 *
 * Rendered only when companion-mode is "banner" (the consumer reads `useCompanionStore`).
 * Off / widget / floating = unmounted: an opt-out user sees no DOM at all, and the
 * layout below doesn't shift because the banner reserves no vertical space when not
 * present.
 *
 * The pet SVG + status line are owned by `<CompanionPet>` (shared with the right-rail
 * widget and the Electron floating window). The bubble below the pet stays here —
 * the other surfaces shouldn't steal focus from the conversation.
 */
import { useEffect, useRef, useState } from "react";
import type { SessionStatus } from "@prismshadow/linsight-server/api";
import { S } from "../../lib/strings";
import { useCompanionStore } from "./companion-store";
import { CompanionPet, type CompanionPose } from "./companion-pet";
import { pickReaction, detectLang } from "./companion-banner-helpers";

export function CompanionBanner({ taskState }: { taskState: SessionStatus }) {
  const { placement } = useCompanionStore();
  const [bubble, setBubble] = useState<{ text: string; seed: number } | null>(null);
  /** Drives the entry animation. The bubble mount starts at 0/offset; we flip this on
   *  the next frame so the `transition-all` runs the visible state. Reset to false on
   *  unmount so the next bubble gets its own pop animation, not a deferred one. */
  const [bubbleVisible, setBubbleVisible] = useState(false);
  const [lang] = useState(() => detectLang());

  /** Track the previous taskState so the bubble only fires on running → idle transitions
   *  — the initial mount with `idle` should be silent. A ref (not state) because the
   *  value is read inside an effect and doesn't drive rendering. */
  const prevTaskState = useRef<SessionStatus | null>(null);

  useEffect(() => {
    const prev = prevTaskState.current;
    prevTaskState.current = taskState;
    if (prev === null) return;
    if (prev === "idle" || taskState !== "idle") return;
    setBubble((p) => {
      // Start the seed counter at 0 so the first turn uses pool[0] rather than
      // skipping it; subsequent turns increment. The `?? -1` lets `next` roll over
      // cleanly once the pool exhausts (5 → 0, 6 → 1, …).
      const next = (p?.seed ?? -1) + 1;
      return { text: pickReaction(next, lang), seed: next };
    });
  }, [taskState, lang]);

  /** Two-frame animation: mount at hidden → next frame at visible. The wrapper holds
   *  the `transition-all` so the keyframe-free CSS handles the rise-and-fade. */
  useEffect(() => {
    if (bubble === null) {
      setBubbleVisible(false);
      return;
    }
    setBubbleVisible(false);
    const raf = requestAnimationFrame(() => setBubbleVisible(true));
    return () => cancelAnimationFrame(raf);
  }, [bubble]);

  /** Auto-dismiss after 4s — long enough to be read, short enough that a busy
   *  conversation never has stacked bubbles piling up. */
  useEffect(() => {
    if (bubble === null) return;
    const id = setTimeout(() => setBubble(null), 4000);
    return () => clearTimeout(id);
  }, [bubble]);

  if (placement !== "banner") return null;

  // While the reaction bubble is up, flip the pet into "celebrating" so the
  // squint + open-mouth + fast tail-wag pose reads as "I noticed the turn
  // ended". Drops back to whatever taskState implies once the bubble fades.
  const displayedPose: CompanionPose | undefined = bubble !== null ? "celebrating" : undefined;

  return (
    <div className="relative mx-2 mb-1.5 flex items-center gap-2 rounded-lg border border-orange-200/70 bg-orange-50/80 px-3 py-1.5 text-xs text-orange-900 shadow-sm transition-colors duration-200 dark:border-orange-900/40 dark:bg-orange-950/30 dark:text-orange-100">
      <CompanionPet taskState={taskState} size="sm" pose={displayedPose} />
      {bubble !== null && (
        <span
          role="status"
          aria-live="polite"
          className={
            "absolute left-12 top-full z-10 mt-1 select-none whitespace-nowrap rounded-full border border-orange-200 bg-white px-2 py-0.5 text-xs text-gray-700 shadow-md transition-all duration-300 dark:border-orange-900/60 dark:bg-gray-800 dark:text-gray-100 " +
            (bubbleVisible ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0")
          }
        >
          {bubble.text}
        </span>
      )}
      {/* Localised strings catalog already exposes the dialog's info; the banner itself
          uses inline micro-copy because each pose needs a short variant and the catalog
          would grow two new keys for very little benefit. The sr-only keeps the row
          discoverable to assistive tech reading the Settings dialog's description. */}
      <span className="sr-only">{S.settings.companionModeInfo}</span>
    </div>
  );
}
