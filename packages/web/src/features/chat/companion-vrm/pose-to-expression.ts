/**
 * Pose → VRM expression mapping.
 *
 * Each `CompanionPose` (the same seven-state enum the SVG and Live2D
 * layers have shipped since L.1) maps to a record of VRM expression
 * weights. The helper is the testable bridge between the pose state
 * machine and the VRM runtime — `<CompanionVrm>` calls it on every pose
 * change, then writes the resulting weights to the loaded model's
 * `VRMExpressionManager`.
 *
 * ## Why a separate helper
 *
 * Three reasons to lift this into a pure function rather than inline it
 * in the React component:
 *
 * 1. **Testability.** A unit test can pin every pose → expression pair
 *    without spinning up three.js or stubbing `WebGLRenderingContext`.
 *    The runtime test for `<CompanionVrm>` lives in the manual-smoke
 *    list, not in CI.
 * 2. **Alignment with the SVG + Live2D layers.** The SVG `POSE_GEOMETRY`
 *    table and the Live2D `poseToMotionForTest` helper are the spec for
 *    what each pose "looks like" — the VRM expression map mirrors the
 *    same cues (closed eyes → blink weight, wide mouth → `aa` weight)
 *    so the three renderers stay visually consistent. Keeping the
 *    mapping in one place makes drift visible: a refactor of the SVG
 *    geometry has to think about what the 3D sides are doing.
 * 3. **Reuse from the preview thumbnail.** The Settings-picker
 *    `<PresetPreview>` loads the same model at 48 px and plays the
 *    same expressions — same helper, no duplication.
 *
 * ## VRM expressions
 *
 * The names follow the VRM 1.0 spec (`VRMExpressionPresetName`):
 * `happy`, `angry`, `sad`, `relaxed`, `surprised`, plus the viseme set
 * (`aa`, `ih`, `ou`, `ee`, `oh`), plus the blink pair (`blink`,
 * `blinkLeft`, `blinkRight`). Weights are 0..1; the runtime writes them
 * via `vrm.expressionManager.setValue(name, weight)` and calls
 * `vrm.expressionManager.update()` once per frame.
 */
import type { CompanionPose } from "../companion-pet";

/** What `<CompanionVrm>` needs to do on a pose change: a record of
 *  expression name → weight, applied through the loaded model's
 *  `VRMExpressionManager`. Empty record means "neutral" — the runtime
 *  still applies the update so the model snaps out of any prior pose. */
export type PoseExpression = Record<string, number>;

/** Test-only export — the unit test pins every pose → PoseExpression
 *  pair. */
export function poseToExpressionForTest(pose: CompanionPose): PoseExpression {
  switch (pose) {
    case "idle":
      // Neutral — the model's resting pose. The expression manager
      // clears any prior pose so the pet returns to baseline between
      // phases (no carryover blink between ASR → TTS, etc.).
      return { neutral: 1 };
    case "thinking":
      // Eyes closed (blink), head tilt is a bone animation on the
      // armature, mouth flat — same cues the SVG `POSE_GEOMETRY`
      // table pins. The runtime applies the blink weight on top of
      // the neutral pose; the manager resolves the override.
      return { neutral: 1, blink: 1 };
    case "listening":
      // Eyes wide (surprised), ears are a bone animation. VRM has
      // no explicit "ear perk" expression; the bone animator handles
      // that. We only set the expression here.
      return { neutral: 1, surprised: 1 };
    case "speaking":
      // Mouth open — drives TTS amplitude in a future L.lipsync
      // phase. For now we just hold the `aa` viseme open; a
      // follow-up will modulate the weight from the audio level.
      return { neutral: 1, aa: 1 };
    case "celebrating":
      // Happy + smile — the motion group carries the body bob, the
      // expression holds the smile. The blink weight is zero so the
      // eyes stay open and bright.
      return { neutral: 1, happy: 1 };
    case "confused":
      // Sad eyes + small surprised override — same cue as the SVG
      // layer (asymmetric blink + slight brow). We approximate with
      // a small `sad` weight; an asymmetric expression is a future
      // asset-format extension (VRM 1.0 has no `confused` preset).
      return { neutral: 1, sad: 0.6 };
    case "sleepy":
      // Half-closed eyes — blink at half weight so the lids sit
      // halfway down. Mouth flat (no `aa` weight, the runtime does
      // not hold an open mouth during a long idle).
      return { neutral: 1, blink: 0.5 };
  }
}
