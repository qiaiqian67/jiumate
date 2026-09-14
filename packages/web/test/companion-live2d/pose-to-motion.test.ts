/**
 * pose-to-motion: the testable bridge from `CompanionPose` to Live2D motions.
 *
 * The runtime swap is invisible to unit tests — pixi.js + WebGL are not
 * available in vitest's node environment — but the pose → motion + parameter
 * mapping IS. These cases pin the mapping so a future refactor cannot
 * silently drop a pose, swap motion names, or change the closed list.
 */
import { describe, expect, it } from "vitest";
import { COMPANION_POSES } from "../../src/features/chat/companion-pet";
import {
  poseToMotionForTest,
  type PoseMotion,
} from "../../src/features/chat/companion-live2d/pose-to-motion";

describe("poseToMotionForTest", () => {
  it("returns a non-empty motion name for every pose", () => {
    // Every pose must resolve to a motion group — an empty string would
    // mean the runtime had nothing to play and the pet would freeze.
    for (const pose of COMPANION_POSES) {
      const result = poseToMotionForTest(pose);
      expect(result.motion.length, `${pose} has empty motion name`).toBeGreaterThan(0);
    }
  });

  it("maps every pose to a distinct motion name", () => {
    // Two poses sharing the same motion would collapse the visual state
    // machine — clicking the pet while "thinking" would not change the
    // animation, the user would only ever see one loop.
    const motions = new Set<string>();
    for (const pose of COMPANION_POSES) {
      motions.add(poseToMotionForTest(pose).motion);
    }
    expect(motions.size).toBe(COMPANION_POSES.length);
  });

  it("returns a parameters record (possibly empty) for every pose", () => {
    // The shape is `parameters: Record<string, number>`, never undefined —
    // the runtime spread would crash on `undefined`.
    for (const pose of COMPANION_POSES) {
      const result = poseToMotionForTest(pose);
      expect(result.parameters, `${pose} has no parameters object`).toBeDefined();
      // Each parameter value is a finite number; NaN / Infinity would
      // produce undefined behaviour in Cubism.
      for (const [id, value] of Object.entries(result.parameters)) {
        expect(Number.isFinite(value), `${pose} has non-finite ${id}`).toBe(true);
      }
    }
  });

  it("aligns idle / speaking with the SVG POSE_GEOMETRY cues", () => {
    // Spot checks: the Live2D parameter map mirrors the SVG geometry
    // (POSE_GEOMETRY table in companion-pet.tsx) so the two renderers
    // stay visually consistent. Idle has no overrides; speaking drives
    // the mouth open parameter.
    const idle = poseToMotionForTest("idle");
    expect(idle.motion).toBe("idle");
    expect(idle.parameters).toEqual({});

    const speaking = poseToMotionForTest("speaking");
    expect(speaking.motion).toBe("speaking");
    expect(speaking.parameters.ParamMouthOpenY).toBe(1);
  });

  it("overrides the eye-open parameter for thinking / sleepy / celebrating", () => {
    // Three poses that close / squint the eyes; the parameter value is
    // clamped to [0, 1] in Cubism, so 0 (fully closed) and 0.4 (half
    // open) are the meaningful non-default values.
    expect(poseToMotionForTest("thinking").parameters.ParamEyeLOpen).toBe(0);
    expect(poseToMotionForTest("sleepy").parameters.ParamEyeLOpen).toBe(0.4);
    expect(poseToMotionForTest("celebrating").parameters.ParamEyeLOpen).toBe(0.2);
  });

  it("overrides the head-tilt parameter (ParamAngleZ) for thinking / confused", () => {
    // The SVG layer tilts the head -3° for thinking and -8° for confused;
    // Cubism expresses this through `ParamAngleZ` (degrees). Keeping the
    // numbers aligned so the two renderers tilt the same direction.
    expect(poseToMotionForTest("thinking").parameters.ParamAngleZ).toBe(-3);
    expect(poseToMotionForTest("confused").parameters.ParamAngleZ).toBe(-8);
  });

  it("exposes the same 7-pose enum (poses beyond the list are unreachable)", () => {
    // The helper signature is exhaustive over `CompanionPose`. The unit
    // test imports `COMPANION_POSES` from the SVG layer — if a new pose
    // is added there, this test catches it (and the switch statement in
    // pose-to-motion.ts would need a new case).
    expect(COMPANION_POSES).toEqual([
      "idle",
      "thinking",
      "listening",
      "speaking",
      "celebrating",
      "confused",
      "sleepy",
    ]);
  });

  it("returns a stable shape (`{ motion: string, parameters: object }`)", () => {
    // A future refactor that drops `parameters` (returning `{ motion }` only)
    // would break the runtime spread. The contract is explicit.
    const result: PoseMotion = poseToMotionForTest("idle");
    expect(Object.keys(result).sort()).toEqual(["motion", "parameters"]);
  });
});
