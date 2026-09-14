/**
 * `CompanionPet` — pose state machine + status copy coverage.
 *
 * The component itself renders SVG with mouse-tracking + a random blink timer,
 * which a fast node-only unit test can't exercise (vitest runs in node, no
 * DOM). What the unit test CAN pin is the two pure helpers that drive the
 * component's behaviour:
 *
 * - `poseFromTaskState` — every `SessionStatus` value maps to a `CompanionPose`,
 *   and the mapping is the inverse of "I'm busy" (any non-idle state = thinking).
 * - `statusCopy` — every pose renders micro-copy in both languages, so no
 *   surface ever sees the default branch (which would surface "I'm here with
 *   you" while the user is asking the pet to think).
 *
 * Together they guarantee the visible surface area never silently falls back
 * to "idle" because a new pose was added without an entry in either helper.
 */
import { describe, expect, it } from "vitest";
import {
  poseFromTaskStateForTest,
  statusCopyForTest,
  COMPANION_POSES,
  type CompanionPose,
} from "../src/features/chat/companion-pet";
import type { SessionStatus } from "@prismshadow/linsight-server/api";

/** Canonical seven-pose list. Hard-coded so a future removal is caught here
 *  before it reaches the rendered pet. */
const ALL_POSES: CompanionPose[] = [
  "idle",
  "thinking",
  "listening",
  "speaking",
  "celebrating",
  "confused",
  "sleepy",
];

describe("pose catalog", () => {
  it("exposes exactly the seven poses the docs and the VRM bridge expect", () => {
    expect(new Set(COMPANION_POSES)).toEqual(new Set(ALL_POSES));
    expect(COMPANION_POSES).toHaveLength(7);
  });
});

describe("poseFromTaskState", () => {
  it("maps idle to idle and every other state to thinking", () => {
    expect(poseFromTaskStateForTest("idle")).toBe("idle");
    const states: SessionStatus[] = ["running", "compacting"];
    for (const s of states) {
      expect(poseFromTaskStateForTest(s)).toBe("thinking");
    }
  });
});

describe("statusCopy", () => {
  it("renders non-empty micro-copy for every pose in both languages", () => {
    for (const pose of ALL_POSES) {
      const zh = statusCopyForTest(pose, "zh");
      const en = statusCopyForTest(pose, "en");
      expect(zh, `zh copy missing for ${pose}`).toBeTruthy();
      expect(en, `en copy missing for ${pose}`).toBeTruthy();
      expect(zh).not.toBe(en);
    }
  });

  it("uses the right tone for thinking vs idle (the most-seen pair)", () => {
    // A user reading the banner while the agent works must see a different line
    // from the one they see at rest — otherwise the pose change is invisible.
    expect(statusCopyForTest("thinking", "en")).not.toBe(statusCopyForTest("idle", "en"));
    expect(statusCopyForTest("thinking", "zh")).not.toBe(statusCopyForTest("idle", "zh"));
  });
});
