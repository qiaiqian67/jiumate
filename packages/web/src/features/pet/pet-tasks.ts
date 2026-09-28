/**
 * Builds the pet's task list — what the floating window turns into bubbles.
 *
 * Ported from OpenBitFun's `buildAgentCompanionActivity`, adapted to this app's model.
 * The reference reads a per-session state machine that reports a `processingPhase`
 * (thinking / tool calling / tool confirming / streaming / compacting); here the phase is
 * read off the tail of the transcript, which carries the same information as item kinds,
 * and the approval count comes from the session row. Everything is derived from data the
 * chat window already holds, so nothing new has to be plumbed through the server.
 *
 * Which sessions get a bubble:
 *   - any session with approvals waiting      → `attention` (needs a human)
 *   - any session running or compacting       → `running`
 *   - any session with an unread completion   → `completed` (see `session-seen.ts`)
 *   - the session being viewed                → only while it runs; looking at it is what
 *                                               marks it read, so it never shows `completed`
 */
import type { SessionInfo, SessionStatus } from "@prismshadow/jiumate-server/api";
import { isSessionUnread, type SessionSeenState } from "../../lib/session-seen";
import { S } from "../../lib/strings";
import type { ChatItem } from "../../lib/omni/stream-model";
import { PET_MAX_TRACKED_TASKS, type PetTaskState, type PetTaskStatus } from "./pet-activity";
import { latestBubbleOutput } from "./pet-output";
import type { PetMood } from "./pet-pet";

export interface PetTaskInput {
  /** The loaded session list for the current Agent. */
  sessions: readonly SessionInfo[];
  /** Whose read markers apply; null disables the `completed` bubble entirely. */
  projectId: string | null;
  seen: SessionSeenState;
  /** The session the chat window is showing, if any. */
  currentSessionId: string | null;
  /**
   * Its live task state. Taken from the stream rather than the list row: the row lags a
   * push by a round trip, and the pet is meant to react immediately.
   */
  currentTaskState: SessionStatus;
  /** Its transcript, oldest first — the phase and the bubble's output come from the tail. */
  currentItems: readonly ChatItem[];
}

/** Phase, mood and status line for a task that is running. */
export interface PetRunningPhase {
  state: PetTaskState;
  mood: PetMood;
  label: string;
}

/**
 * The in-flight phase, read off the newest transcript item.
 *
 * The tail is what the model is doing right now: a streaming thinking block means it is
 * still reasoning, a tool call with no output yet means it is waiting on the tool (or on
 * the approval that gates it), and a streaming assistant segment means it is writing the
 * reply. Nothing in the tail matches while a step is between messages, which is what the
 * `working` fallback is for.
 */
export function petRunningPhase(
  taskState: SessionStatus,
  items: readonly ChatItem[],
): PetRunningPhase {
  if (taskState === "compacting") {
    return { state: "running", mood: "analyzing", label: S.pet.statusCompacting };
  }
  const last = items[items.length - 1];
  if (last !== undefined) {
    if (last.kind === "thinking" && last.streaming) {
      return { state: "running", mood: "analyzing", label: S.pet.statusThinking };
    }
    if (last.kind === "tool_call" && !last.outputComplete) {
      return { state: "waiting", mood: "waiting", label: S.pet.statusUsingTools };
    }
    if (last.kind === "assistant_text" && last.streaming) {
      return { state: "running", mood: "working", label: S.pet.statusWriting };
    }
  }
  return { state: "running", mood: "working", label: S.pet.statusWorking };
}

/** Newest assistant output, flattened for a bubble. Only the viewed session has a transcript here. */
function currentOutput(items: readonly ChatItem[]): string {
  return latestBubbleOutput(items);
}

function startedAtMs(session: SessionInfo): number {
  const at = Date.parse(session.createdAt);
  return Number.isNaN(at) ? 0 : at;
}

function updatedAtMs(session: SessionInfo): number {
  const at = Date.parse(session.lastActiveAt);
  return Number.isNaN(at) ? startedAtMs(session) : at;
}

/** Subagent rows belong to their parent session, and archived rows are hidden by choice. */
function isTracked(session: SessionInfo): boolean {
  return !session.archived && session.source !== "subagent";
}

function taskFor(session: SessionInfo, input: PetTaskInput, output: string): PetTaskStatus | null {
  const base = {
    sessionId: session.sessionId,
    title: session.title ?? S.chat.defaultSessionTitle,
    startedAt: startedAtMs(session),
    updatedAt: updatedAtMs(session),
    canReply: true,
  };
  // Approvals outrank everything: the run is blocked on a human, and that is the one
  // state the pet exists to surface.
  if (session.pendingApprovalCount > 0) {
    return {
      ...base,
      state: "attention",
      mood: "waiting",
      label: S.pet.statusWaitingApproval,
      output,
    };
  }
  const running =
    session.sessionId === input.currentSessionId ? input.currentTaskState : session.status;
  if (running !== "idle") {
    const phase = petRunningPhase(
      running,
      session.sessionId === input.currentSessionId ? input.currentItems : [],
    );
    return { ...base, ...phase, output };
  }
  // Idle: a bubble only if it finished something the user has not looked at since. The
  // viewed session is excluded outright — looking at it is what marks it read, and
  // waiting for that marker would flash a `completed` bubble at someone who is already
  // watching the reply arrive.
  if (session.sessionId === input.currentSessionId) return null;
  if (isSessionUnread(input.seen, session.sessionId, session.lastActiveAt)) {
    return {
      ...base,
      state: "completed",
      mood: "rest",
      label: S.pet.statusCompleted,
      output,
    };
  }
  return null;
}

/** The pet's task list, oldest first and capped at `PET_MAX_TRACKED_TASKS`. */
export function buildPetTasks(input: PetTaskInput): PetTaskStatus[] {
  const tasks: PetTaskStatus[] = [];
  for (const session of input.sessions) {
    if (!isTracked(session)) continue;
    const output =
      session.sessionId === input.currentSessionId ? currentOutput(input.currentItems) : "";
    const task = taskFor(session, input, output);
    if (task !== null) tasks.push(task);
  }
  tasks.sort((a, b) => a.startedAt - b.startedAt);
  return tasks.slice(0, PET_MAX_TRACKED_TASKS);
}
