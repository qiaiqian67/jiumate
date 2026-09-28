/**
 * Pet bridge — the two windows that make up the desktop pet talk over a real
 * `BroadcastChannel` (matching OpenBitFun's cross-window companion plumbing).
 *
 * Same-origin Electron windows (chat + `/pet`) share the channel; an in-page
 * listener set covers same-document subscribers, which is what makes this
 * testable without a second window.
 *
 * Four messages travel over it:
 *   - `activity`      chat → pet   : the current task list, pet and size.
 *   - `sync-request`  pet → chat   : "I just mounted, send me the state".
 *   - `open-session`  pet → chat   : show this session in the main window.
 *   - `dismiss-task`  pet → chat   : the user acknowledged this bubble.
 *
 * The chat window is the only emitter of `activity` and the only listener for
 * the other three, so a window never has to filter its own traffic.
 */
import type { PetMood } from "./pet-pet";

export const PET_ACTIVITY_CHANNEL = "jiumate-pet-activity";

/** What the tracked session is doing, in the pet's vocabulary. */
export type PetTaskState =
  "running" | "waiting" | "attention" | "completed" | "failed" | "interrupted";

export interface PetTaskStatus {
  sessionId: string;
  /** Bubble heading — the session title. */
  title: string;
  mood: PetMood;
  state: PetTaskState;
  /**
   * Status line, already localized: the emitting window owns the dictionary, so
   * the pet window (which has no locale context of its own to switch on) never
   * has to resolve a key.
   */
  label: string;
  /** Latest assistant output, flattened and truncated by `pet-output.ts`. */
  output: string;
  /** Whether the session accepts a message typed in the bubble. */
  canReply: boolean;
  startedAt: number;
  updatedAt: number;
}

export interface PetActivityPayload {
  mood: PetMood;
  /** Ordered oldest-first; the pet window shows at most `PET_MAX_VISIBLE_BUBBLES`. */
  tasks: PetTaskStatus[];
  /**
   * Appearance the floating window should mirror. The chat window is where the
   * user changes the pet and its size, and a second Electron window has no other
   * way to hear about it: its own prefs fetch runs once, at mount.
   */
  petId: string | null;
  scale: number;
  /**
   * Monotonic per-sender counter plus a wall clock. The pet window drops a
   * payload that is older than what it already has, so a message that overtakes
   * another on the channel cannot rewind the bubbles.
   */
  sequence: number;
  emittedAt: number;
}

export type PetCommand =
  | { kind: "sync-request" }
  | { kind: "open-session"; sessionId: string }
  | { kind: "dismiss-task"; sessionId: string }
  | { kind: "open-pet-settings" }
  | { kind: "disable-pet" };

type ActivityMessage = { kind: "activity" } & PetActivityPayload;
type ChannelMessage = ActivityMessage | PetCommand;

type ActivityListener = (payload: PetActivityPayload) => void;
type CommandListener = (command: PetCommand) => void;

/** Bubbles the pet window draws at once; the rest stay tracked but hidden. */
export const PET_MAX_VISIBLE_BUBBLES = 2;
/** Tasks the chat window reports at all. */
export const PET_MAX_TRACKED_TASKS = 4;

/**
 * The pet's own mood across every tracked task: a blocked task outranks a thinking one,
 * which outranks plain work — the same precedence OpenBitFun's `aggregateMood` uses.
 * Lives here rather than in the chat-side builder because both windows need it.
 */
export function aggregatePetMood(tasks: readonly PetTaskStatus[]): PetMood {
  if (tasks.some((task) => task.mood === "waiting")) return "waiting";
  if (tasks.some((task) => task.mood === "analyzing")) return "analyzing";
  if (tasks.some((task) => task.mood === "working")) return "working";
  return "rest";
}

let activityListeners: Set<ActivityListener> | null = null;
let commandListeners: Set<CommandListener> | null = null;
let channel: BroadcastChannel | null = null;

function getActivityListeners(): Set<ActivityListener> {
  if (activityListeners === null) activityListeners = new Set();
  return activityListeners;
}

function getCommandListeners(): Set<CommandListener> {
  if (commandListeners === null) commandListeners = new Set();
  return commandListeners;
}

function deliverActivity(payload: PetActivityPayload): void {
  for (const listener of getActivityListeners()) {
    try {
      listener(payload);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[pet] activity listener failed", err);
    }
  }
}

function deliverCommand(command: PetCommand): void {
  for (const listener of getCommandListeners()) {
    try {
      listener(command);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[pet] command listener failed", err);
    }
  }
}

function isPetTaskState(value: unknown): value is PetTaskState {
  return (
    value === "running" ||
    value === "waiting" ||
    value === "attention" ||
    value === "completed" ||
    value === "failed" ||
    value === "interrupted"
  );
}

/**
 * Accept anything shaped roughly like an activity payload. A stale window (or a
 * half-written message from a previous build) must not blank the pet out, so
 * every field but the mood falls back instead of rejecting the message.
 */
function normalizeTask(raw: unknown): PetTaskStatus | null {
  if (!raw || typeof raw !== "object") return null;
  const task = raw as Record<string, unknown>;
  const sessionId = task["sessionId"];
  if (typeof sessionId !== "string" || sessionId === "") return null;
  const mood = task["mood"];
  const startedAt = task["startedAt"];
  const updatedAt = task["updatedAt"];
  return {
    sessionId,
    title: typeof task["title"] === "string" ? task["title"] : "",
    mood: (typeof mood === "string" ? mood : "rest") as PetMood,
    state: isPetTaskState(task["state"]) ? task["state"] : "running",
    label: typeof task["label"] === "string" ? task["label"] : "",
    output: typeof task["output"] === "string" ? task["output"] : "",
    canReply: task["canReply"] === true,
    startedAt: typeof startedAt === "number" ? startedAt : 0,
    updatedAt: typeof updatedAt === "number" ? updatedAt : 0,
  };
}

function normalizeActivity(payload: unknown): PetActivityPayload | null {
  if (!payload || typeof payload !== "object") return null;
  const raw = payload as Record<string, unknown>;
  if (typeof raw["mood"] !== "string") return null;
  const tasks = Array.isArray(raw["tasks"])
    ? raw["tasks"].map(normalizeTask).filter((task): task is PetTaskStatus => task !== null)
    : [];
  const petId = raw["petId"];
  const scale = raw["scale"];
  const sequence = raw["sequence"];
  const emittedAt = raw["emittedAt"];
  return {
    mood: raw["mood"] as PetMood,
    tasks,
    petId: typeof petId === "string" ? petId : null,
    scale: typeof scale === "number" && Number.isFinite(scale) ? scale : 1,
    sequence: typeof sequence === "number" ? sequence : 0,
    emittedAt: typeof emittedAt === "number" ? emittedAt : Date.now(),
  };
}

function normalizeCommand(payload: unknown): PetCommand | null {
  if (!payload || typeof payload !== "object") return null;
  const raw = payload as Record<string, unknown>;
  const kind = raw["kind"];
  if (kind === "sync-request") return { kind: "sync-request" };
  if (kind === "open-pet-settings") return { kind: "open-pet-settings" };
  if (kind === "disable-pet") return { kind: "disable-pet" };
  const sessionId = raw["sessionId"];
  if (typeof sessionId !== "string" || sessionId === "") return null;
  if (kind === "open-session") return { kind: "open-session", sessionId };
  if (kind === "dismiss-task") return { kind: "dismiss-task", sessionId };
  return null;
}

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  if (channel === null) {
    channel = new BroadcastChannel(PET_ACTIVITY_CHANNEL);
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const message = event.data as ChannelMessage | undefined;
      if (message?.kind === "activity") {
        const payload = normalizeActivity(message);
        if (payload !== null) deliverActivity(payload);
        return;
      }
      const command = normalizeCommand(message);
      if (command !== null) deliverCommand(command);
    };
  }
  return channel;
}

function post(message: ChannelMessage): void {
  try {
    getChannel()?.postMessage(message);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[pet] BroadcastChannel post failed", err);
  }
}

/** Subscribe to activity updates (the pet window). Returns an unsubscribe function. */
export function subscribePetActivity(listener: ActivityListener): () => void {
  getChannel(); // ensure the BroadcastChannel is listening
  const set = getActivityListeners();
  set.add(listener);
  return () => {
    set.delete(listener);
  };
}

/** Push the current task list to every subscriber (local + other windows). */
export function emitPetActivity(payload: PetActivityPayload): void {
  deliverActivity(payload);
  post({ kind: "activity", ...payload });
}

/** Subscribe to commands from the pet window (the chat window). */
export function subscribePetCommands(listener: CommandListener): () => void {
  getChannel();
  const set = getCommandListeners();
  set.add(listener);
  return () => {
    set.delete(listener);
  };
}

/** Send a command to the chat window (the pet window). */
export function sendPetCommand(command: PetCommand): void {
  deliverCommand(command);
  post(command);
}

/**
 * Ask the chat window to re-send the current activity. The pet window calls
 * this on mount: it may be opened while a task is already running, and without
 * the handshake its bubbles would stay empty until the next state change.
 */
export function requestPetSync(): void {
  sendPetCommand({ kind: "sync-request" });
}
