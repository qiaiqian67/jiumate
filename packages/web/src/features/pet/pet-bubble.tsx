/**
 * One speech bubble in the floating pet window.
 *
 * Sits to the left of the pet (the dock is right-anchored, so bubbles grow into
 * the screen rather than off it) and reports what one session is doing: its
 * title, a status line, and the tail of the assistant's latest output, revealed
 * with a typewriter so a streamed reply reads as arriving rather than blinking.
 *
 * Mirrors OpenBitFun's bubble, including its reply composer: the bubble itself
 * becomes the input, so no extra panel is needed and the window keeps its size.
 */
import type { KeyboardEvent, MouseEvent } from "react";
import { S } from "../../lib/strings";
import { useTypewriter } from "./pet-typewriter";
import type { PetTaskStatus } from "./pet-activity";

export interface PetBubbleComposer {
  value: string;
  /** A send is in flight; the input stays put so a failure can be retried. */
  busy: boolean;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export interface PetBubbleProps {
  task: PetTaskStatus;
  /** The only visible bubble gets the taller single-bubble treatment. */
  single: boolean;
  /** This bubble is the one currently being replied into. */
  composing: boolean;
  composer: PetBubbleComposer;
  onOpenSession: (sessionId: string) => void;
  onOpenComposer: (sessionId: string) => void;
  onContextMenu: (event: MouseEvent<HTMLDivElement>, sessionId: string) => void;
}

export function PetBubble({
  task,
  single,
  composing,
  composer,
  onOpenSession,
  onOpenComposer,
  onContextMenu,
}: PetBubbleProps) {
  const { text, typing } = useTypewriter(task.output);

  const body = (
    <>
      <span className="linsight-pet-bubble__title">{task.title}</span>
      <span className="linsight-pet-bubble__status">{task.label}</span>
      {task.output === "" ? null : (
        <span
          className={`linsight-pet-bubble__output${
            typing ? " linsight-pet-bubble__output--typing" : ""
          }`}
          data-testid="pet-bubble-output"
        >
          {text}
        </span>
      )}
    </>
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (composing) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpenSession(task.sessionId);
    }
  };

  // While composing, the bubble is a form rather than a link: every click and key
  // press belongs to the input, not to "open this session".
  if (composing) {
    return (
      <div
        className={`linsight-pet-bubble linsight-pet-bubble--${task.state}${
          single ? " linsight-pet-bubble--single" : ""
        } linsight-pet-bubble--composing`}
        data-pet-session-id={task.sessionId}
        data-pet-state={task.state}
        onContextMenu={(event) => event.stopPropagation()}
      >
        {body}
        <div className="linsight-pet-bubble__composer">
          <input
            autoFocus
            type="text"
            className="linsight-pet-bubble__composer-input"
            value={composer.value}
            placeholder={S.pet.composerPlaceholder}
            aria-label={S.pet.composerPlaceholder}
            disabled={composer.busy}
            onChange={(event) => composer.onValueChange(event.target.value)}
            onKeyDown={(event) => {
              // IME: Enter commits a candidate, it does not send the message.
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Escape") {
                event.preventDefault();
                composer.onCancel();
                return;
              }
              if (event.key === "Enter") {
                event.preventDefault();
                composer.onSubmit();
              }
            }}
          />
          <button
            type="button"
            className="linsight-pet-bubble__composer-send"
            title={S.pet.composerSend}
            aria-label={S.pet.composerSend}
            disabled={composer.busy || composer.value.trim() === ""}
            onClick={() => composer.onSubmit()}
          >
            ↑
          </button>
          <button
            type="button"
            className="linsight-pet-bubble__composer-cancel"
            title={S.pet.composerCancel}
            aria-label={S.pet.composerCancel}
            onClick={() => composer.onCancel()}
          >
            ✕
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`linsight-pet-bubble linsight-pet-bubble--${task.state}${
        single ? " linsight-pet-bubble--single" : ""
      }`}
      role="button"
      tabIndex={0}
      title={task.title}
      data-pet-session-id={task.sessionId}
      data-pet-state={task.state}
      onClick={() => onOpenSession(task.sessionId)}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => onContextMenu(event, task.sessionId)}
    >
      {body}
      {task.canReply ? (
        <button
          type="button"
          className="linsight-pet-bubble__reply"
          title={S.pet.composerOpen}
          aria-label={S.pet.composerOpen}
          onClick={(event) => {
            event.stopPropagation();
            onOpenComposer(task.sessionId);
          }}
        >
          ✎
        </button>
      ) : null}
    </div>
  );
}
