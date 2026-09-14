/**
 * AI companion widget — the right-rail placement.
 *
 * Renders only when `placement === "widget"`. The dock (Agents / Files / …) is the
 * "official" right-rail surface, so the widget yields when a dock view is mounted
 * there (decided by `chat-page.tsx` via the parent condition). It also yields on a
 * narrow viewport — adding 280px next to a stacked layout would only crowd it.
 *
 * Width is fixed at 280px, matching the dock's default. The right rail's resize
 * drag (`usePanelWidthValue`) is intentionally not hooked up here — that helper is
 * shared with the dock and would couple the companion width to the dock width. A
 * future iteration can add a per-widget drag if users ask.
 */
import type { SessionStatus } from "@prismshadow/linsight-server/api";
import { S } from "../../lib/strings";
import { CompanionPet } from "./companion-pet";
import { useCompanionStore } from "./companion-store";

export function CompanionWidget({ taskState }: { taskState: SessionStatus }) {
  const { placement } = useCompanionStore();
  if (placement !== "widget") return null;

  return (
    <aside
      // `shrink-0` so the chat column doesn't shrink below its `max-w-3xl` composer
      // when the widget appears. The left border echoes the dock's visual separation
      // so the two surfaces feel like siblings without being confused.
      className="hidden shrink-0 flex-col items-center justify-start gap-3 border-l border-gray-200 bg-gray-50/60 px-4 py-6 lg:flex lg:w-[280px] dark:border-gray-800 dark:bg-gray-900/40"
      aria-label="AI companion"
    >
      <CompanionPet taskState={taskState} size="md" />
      {/* Tracked status line — useful for the user's mental model ("is the agent
          working or stuck?"). Reads as a subtitle, not a button, so it stays
          pointer-events-none. */}
      <p className="max-w-[220px] text-center text-xs leading-relaxed text-gray-500 dark:text-gray-400">
        {taskState === "idle"
          ? S.settings.companionWidgetIdleHint
          : S.settings.companionWidgetThinkingHint}
      </p>
    </aside>
  );
}
