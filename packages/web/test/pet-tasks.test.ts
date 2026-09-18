/**
 * Unit tests for the chat-side task builder (`pet-tasks.ts`): which sessions earn a
 * bubble, and what state/mood/label each one gets.
 */
import { describe, expect, it } from "vitest";
import { PET_MAX_TRACKED_TASKS } from "../src/features/pet/pet-activity";
import { buildPetTasks, petRunningPhase } from "../src/features/pet/pet-tasks";
import { S } from "../src/lib/strings";
import type { SessionSeenState } from "../src/lib/session-seen";
import type { ChatItem } from "../src/lib/omni/stream-model";
import type { SessionInfo } from "@prismshadow/linsight-server/api";

const LAST_ACTIVE = "2026-09-18T10:05:00.000Z";

function session(overrides: Partial<SessionInfo> & { sessionId: string }): SessionInfo {
  return {
    projectId: "proj",
    agentId: "agent",
    provider: "prov",
    modelId: "model",
    workspace: "/workspace",
    createdAt: "2026-09-18T10:00:00.000Z",
    lastActiveAt: LAST_ACTIVE,
    status: "idle",
    pendingApprovalCount: 0,
    pendingFollowUpCount: 0,
    hasTrace: true,
    archived: false,
    ...overrides,
  } as unknown as SessionInfo;
}

/** Nothing remembered: every session counts as unread. */
const NOTHING_SEEN: SessionSeenState = { seededAt: 0, seen: new Map() };

function build(
  sessions: readonly SessionInfo[],
  extra: Partial<Parameters<typeof buildPetTasks>[0]> = {},
) {
  return buildPetTasks({
    sessions,
    projectId: "proj",
    seen: NOTHING_SEEN,
    currentSessionId: null,
    currentTaskState: "idle",
    currentItems: [],
    ...extra,
  });
}

function assistant(text: string, streaming = false): ChatItem {
  return { kind: "assistant_text", id: 1, text, streaming };
}

describe("petRunningPhase", () => {
  it("reads a streaming thinking block as analyzing", () => {
    const items = [{ kind: "thinking", id: 1, thinking: "…", streaming: true }] as ChatItem[];
    expect(petRunningPhase("running", items)).toEqual({
      state: "running",
      mood: "analyzing",
      label: S.pet.statusThinking,
    });
  });

  it("reads an unfinished tool call as waiting on the tool", () => {
    const items = [{ kind: "tool_call", id: 1, outputComplete: false }] as unknown as ChatItem[];
    expect(petRunningPhase("running", items).mood).toBe("waiting");
    expect(petRunningPhase("running", items).label).toBe(S.pet.statusUsingTools);
  });

  it("reads a streaming reply as writing", () => {
    expect(petRunningPhase("running", [assistant("partial", true)])).toEqual({
      state: "running",
      mood: "working",
      label: S.pet.statusWriting,
    });
  });

  it("falls back to plain working between steps, and to compacting when asked", () => {
    expect(petRunningPhase("running", []).label).toBe(S.pet.statusWorking);
    expect(petRunningPhase("compacting", [assistant("x", true)])).toEqual({
      state: "running",
      mood: "analyzing",
      label: S.pet.statusCompacting,
    });
  });
});

describe("buildPetTasks", () => {
  it("is empty when nothing is running and nothing is unread", () => {
    const seen: SessionSeenState = {
      seededAt: 0,
      seen: new Map([["s1", Date.parse(LAST_ACTIVE)]]),
    };
    expect(build([session({ sessionId: "s1" })], { seen })).toEqual([]);
  });

  it("gives a running session a working bubble", () => {
    const [task] = build([session({ sessionId: "s1", title: "重构浮窗", status: "running" })]);
    expect(task).toMatchObject({
      sessionId: "s1",
      title: "重构浮窗",
      state: "running",
      mood: "working",
      label: S.pet.statusWorking,
    });
  });

  it("gives a compacting session an analyzing bubble", () => {
    const [task] = build([session({ sessionId: "s1", status: "compacting" })]);
    expect(task?.mood).toBe("analyzing");
    expect(task?.label).toBe(S.pet.statusCompacting);
  });

  it("lets a pending approval outrank a run: attention, waiting", () => {
    const [task] = build([
      session({ sessionId: "s1", status: "running", pendingApprovalCount: 1 }),
    ]);
    expect(task).toMatchObject({
      state: "attention",
      mood: "waiting",
      label: S.pet.statusWaitingApproval,
    });
  });

  it("surfaces an idle session that ran since the user last looked at it", () => {
    const [task] = build([session({ sessionId: "s1", title: "旧会话" })]);
    expect(task).toMatchObject({
      sessionId: "s1",
      state: "completed",
      mood: "rest",
      label: S.pet.statusCompleted,
    });
  });

  it("takes the viewed session's state from the stream, not the lagging list row", () => {
    const [task] = build([session({ sessionId: "s1", status: "idle" })], {
      currentSessionId: "s1",
      currentTaskState: "running",
    });
    expect(task?.state).toBe("running");
    // Looking at a session is what marks it read, so it never shows `completed`.
    expect(
      build([session({ sessionId: "s1", status: "idle" })], { currentSessionId: "s1" }),
    ).toEqual([]);
  });

  it("gives only the viewed session an output line", () => {
    const tasks = build(
      [
        session({ sessionId: "s1", status: "running" }),
        session({ sessionId: "s2", status: "running", createdAt: "2026-09-18T10:01:00.000Z" }),
      ],
      { currentSessionId: "s1", currentTaskState: "running", currentItems: [assistant("**hi**")] },
    );
    expect(tasks.find((task) => task.sessionId === "s1")?.output).toBe("hi");
    expect(tasks.find((task) => task.sessionId === "s2")?.output).toBe("");
  });

  it("skips archived rows and subagent rows (they belong to their parent)", () => {
    const tasks = build([
      session({ sessionId: "archived", archived: true }),
      session({ sessionId: "sub", source: "subagent" }),
      session({ sessionId: "live", status: "running" }),
    ]);
    expect(tasks.map((task) => task.sessionId)).toEqual(["live"]);
  });

  it("sorts oldest first and caps the list", () => {
    const many = Array.from({ length: PET_MAX_TRACKED_TASKS + 3 }, (_, index) =>
      session({
        sessionId: `s${index}`,
        status: "running",
        createdAt: `2026-09-18T10:0${index}:00.000Z`,
      }),
    );
    const tasks = build(many);
    expect(tasks).toHaveLength(PET_MAX_TRACKED_TASKS);
    expect(tasks.map((task) => task.sessionId)).toEqual(["s0", "s1", "s2", "s3"]);
  });

  it("falls back to the default session title when the model has not named it yet", () => {
    const [task] = build([session({ sessionId: "s1", status: "running" })]);
    expect(task?.title).toBe(S.chat.defaultSessionTitle);
  });
});
