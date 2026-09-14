/**
 * Pose → Live2D motion mapping.
 *
 * Each `CompanionPose` (the same seven-state enum the SVG layer has shipped since
 * L.1) maps to one Cubism motion name + a record of Live2D parameter overrides.
 * The helper is the testable bridge between the pose state machine and the
 * runtime — `<CompanionLive2D>` calls it on every pose change, then either plays
 * the named motion group or sets parameters manually.
 *
 * ## Why a separate helper
 *
 * Three reasons to lift this into a pure function rather than inline it in the
 * React component:
 *
 * 1. **Testability.** A unit test can pin every pose → motion + parameter pair
 *    without spinning up pixi.js or stubbing `WebGLRenderingContext`. The runtime
 *    test for `<CompanionLive2D>` lives in the manual-smoke list, not in CI.
 * 2. **Alignment with the SVG layer.** The SVG `POSE_GEOMETRY` table is the
 *    spec for what each pose "looks like" — the Live2D parameter map mirrors
 *    the same cues (closed eyes → `ParamEyeLOpen = 0`, wide mouth →
 *    `ParamMouthOpenY = 1`, …) so the two renderers stay visually consistent.
 *    Keeping the mapping in one place makes drift visible: a refactor of the
 *    SVG geometry has to think about what the Live2D side is doing.
 * 3. **Reuse from the preview thumbnail.** The Settings-picker `<PresetPreview>`
 *    loads the same model at 48 px and plays the same idle motion — same
 *    helper, no duplication.
 *
 * ## Cubism parameter names
 *
 * The names follow the Cubism SDK convention: `ParamEyeLOpen`, `ParamMouthOpenY`,
 * `ParamMouthForm`, `ParamBodyAngleX`, `ParamAngleZ` (head tilt), etc. They
 * match the official Cubism sample-model parameter ids; a custom model with a
 * different naming scheme would extend this table.
 */
import type { CompanionPose } from "../companion-pet";

/** What `<CompanionLive2D>` needs to do on a pose change: pick the motion group
 *  to play (file name under `public/avatars/<preset>/motions/`), and override
 *  any Cubism parameter the motion does not already set. */
export interface PoseMotion {
  /** File name of the `.motion3.json` to play. Empty string means "no motion,
   *  parameter overrides only" — the component still applies `parameters`
   *  even when the motion name is empty. */
  motion: string;
  /** Cubism parameter overrides (e.g. `ParamEyeLOpen = 0` for closed eyes).
   *  Set before the motion starts so the first frame already matches the pose. */
  parameters: Record<string, number>;
}

/** Test-only export — the unit test pins every pose → PoseMotion pair. */
export function poseToMotionForTest(pose: CompanionPose): PoseMotion {
  switch (pose) {
    case "idle":
      // Slow tail sway, eyes open, head level. The default loop.
      return { motion: "idle", parameters: {} };
    case "thinking":
      // Eyes closed (square lids), head tilt -3°, mouth flat — same cues the
      // SVG `POSE_GEOMETRY` table pins. The motion is the model's own
      // thinking clip; the parameter overrides hold between motion frames.
      return {
        motion: "thinking",
        parameters: {
          ParamEyeLOpen: 0,
          ParamEyeROpen: 0,
          ParamMouthOpenY: 0,
          ParamAngleZ: -3,
        },
      };
    case "listening":
      // Ears perked, eyes wide — the ASR phase pose (L.5). Cubism has no
      // explicit "ear perk" parameter; the motion group carries the ear
      // animator; we only override eyes here.
      return {
        motion: "listening",
        parameters: {
          ParamEyeLOpen: 1.2,
          ParamEyeROpen: 1.2,
        },
      };
    case "speaking":
      // Mouth open — drives TTS amplitude in a future L.lipsync phase. For
      // now we just hold the mouth open; the speaking motion group itself
      // plays whatever the model author recorded.
      return {
        motion: "speaking",
        parameters: {
          ParamMouthOpenY: 1,
        },
      };
    case "celebrating":
      // Squint eyes, mouth wide (smile form = 1), tail wagging fast. The
      // motion group carries the body bob; parameters hold the squint.
      return {
        motion: "celebrating",
        parameters: {
          ParamEyeLOpen: 0.2,
          ParamEyeROpen: 0.2,
          ParamMouthForm: 1,
        },
      };
    case "confused":
      // Head tilt -8°, asymmetric ears — same cue as the SVG layer.
      return {
        motion: "confused",
        parameters: {
          ParamAngleZ: -8,
          ParamEyeLOpen: 0.5,
          ParamEyeROpen: 0.7,
        },
      };
    case "sleepy":
      // Half-closed eyes, droopy ears — the L.2 proactive trigger feeds
      // this after long idle.
      return {
        motion: "sleepy",
        parameters: {
          ParamEyeLOpen: 0.4,
          ParamEyeROpen: 0.4,
          ParamMouthOpenY: 0,
        },
      };
  }
}
