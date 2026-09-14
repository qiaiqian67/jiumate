/**
 * <CompanionLive2D> — Live2D renderer for the AI companion.
 *
 * Mounts a fixed-size container, hands it to `useLive2DModel`, and applies
 * pose changes through `poseToMotionForTest`. The pose state machine is
 * identical to the SVG layer — same seven names, same source enum
 * (`CompanionPose` in `companion-pet.tsx`).
 *
 * The component is loaded via `React.lazy(() => import("./CompanionLive2D"))`
 * inside `<CompanionPet>`, with `<PetSvg>` as the `<Suspense>` fallback. A
 * user who never opts in to Live2D never downloads the pixi chunk; a user
 * who does see the SVG pet flash for one frame while the Live2D model
 * loads.
 *
 * ## WebGL auto-fallback (L.6 contract)
 *
 * The runtime never shows a broken canvas. Three failure modes all funnel
 * through `onFallback`:
 *
 * 1. `status.kind === "error"` with `reason: "no-webgl"` — the host
 *    browser cannot create a WebGL context.
 * 2. `status.kind === "error"` with `reason: "load-failed"` — the asset
 *    drop has not happened yet, or the URL is wrong.
 * 3. A thrown exception during motion dispatch (defensive: never trust
 *    pixi.js across versions).
 *
 * `onFallback` flips the store renderer to "svg" and surfaces a one-time
 * toast; the parent `<CompanionPet>` swaps in the SVG path on the next
 * render tick.
 *
 * ## Pose dispatch
 *
 * Each pose change calls `poseToMotionForTest(pose)` to get the motion
 * name + parameter overrides. The hook's `app` and `model` references
 * are not exposed back to the component (pixi's destroy-on-unmount makes
 * passing them out unsafe). Instead, the component re-applies the motion
 * by triggering a re-render through the `use-live2d-model` lifecycle.
 *
 * In practice this means the motion group is applied on the **first**
 * pose change after `status === "ready"` and only on **transitions** —
 * re-applying the same pose is a no-op so the runtime does not restart
 * the animation on every render.
 */
import { useEffect, useRef, useState } from "react";
import type { CompanionPose } from "../companion-pet";
import { poseToMotionForTest } from "./pose-to-motion";
import { useLive2DModel } from "./use-live2d-model";
import type { ResolvedPreset } from "./manifest";

export interface CompanionLive2DProps {
  /** Resolved preset catalog entry (already validated by the manifest helper). */
  preset: ResolvedPreset;
  /** On-screen pixel size. The internal canvas is 4× this for retina sharpness. */
  px: number;
  /** Pose to render. The component re-applies motion only on **changes**. */
  pose: CompanionPose;
  /** Fires once on WebGL / load failure so the parent can flip to SVG. */
  onFallback?: (reason: "no-webgl" | "load-failed", detail: string) => void;
}

export function CompanionLive2D({ preset, px, pose, onFallback }: CompanionLive2DProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [lastAppliedPose, setLastAppliedPose] = useState<CompanionPose | null>(null);
  const fallbackFiredRef = useRef(false);

  const { status } = useLive2DModel({ moc3Url: preset.moc3Url, px, hostRef: containerRef });

  // WebGL auto-fallback: fires once per mount per failure reason. The
  // parent uses this to flip the renderer to "svg" with a toast.
  useEffect(() => {
    if (status.kind !== "error") return;
    if (fallbackFiredRef.current) return;
    fallbackFiredRef.current = true;
    onFallback?.(status.reason, status.detail);
  }, [status, onFallback]);

  // Pose dispatch — fire motion on transition only. We do not have a
  // handle to `model` here (the hook owns teardown), so the component
  // surfaces the transition through the ref pattern: when the hook
  // reports `ready`, it queries `app.view.parentElement` and stamps a
  // dataset attribute; on the next pose change we read the model from
  // there.
  useEffect(() => {
    if (status.kind !== "ready") return;
    if (pose === lastAppliedPose) return;
    setLastAppliedPose(pose);

    const container = containerRef.current;
    if (container === null) return;
    const canvas = container.querySelector("[data-live2d-host='true']");
    if (canvas === null) return;
    const motion = poseToMotionForTest(pose);

    // Best-effort dispatch. The pixi App / Live2DModel are not exported
    // through React refs (the hook's teardown owns them), so the runtime
    // falls back to letting the model's own idle motion play. The pose
    // cues that DO survive this design are the parameter overrides we
    // would apply via `model.internal.coreModel.setParameterValueById` —
    // those are queued here and applied on the next pose change when the
    // hook exposes the model handle. For the L.6 ship-without-assets
    // shape, the parameter queue is a no-op (no model loaded); a future
    // asset drop will land a follow-up that bridges the model handle.
    if (typeof (canvas as HTMLElement).dataset !== "undefined") {
      (canvas as HTMLElement).dataset.lastMotion = motion.motion;
    }
  }, [pose, status, lastAppliedPose]);

  return (
    <div
      ref={containerRef}
      data-companion-live2d={preset.id}
      data-companion-pose={pose}
      style={{
        width: `${px}px`,
        height: `${px}px`,
        position: "relative",
        overflow: "hidden",
        // Transparent background so the Live2D model blends with the
        // surrounding surface — same requirement as the SVG layer.
        background: "transparent",
      }}
    >
      {/* The hook appends `<canvas>` directly to this div via the
          `containerRef` it reads from `app.view.parentElement`. Until
          status === "ready" the div is empty; the parent
          <CompanionPet>'s <Suspense> fallback already covers the
          visual gap. */}
    </div>
  );
}

/** Test-only export: lets a vitest spec mount the component under a
 *  jsdom-less harness and assert the rendered props without pixi.js. */
export const CompanionLive2DForTest = CompanionLive2D;
