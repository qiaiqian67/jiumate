/**
 * <CompanionVrm> — VRM renderer for the AI companion.
 *
 * Mounts a fixed-size container, hands it to `useVrmModel`, and applies
 * pose changes through `poseToExpressionForTest`. The pose state machine
 * is identical to the SVG and Live2D layers — same seven names, same
 * source enum (`CompanionPose` in `companion-pet.tsx`).
 *
 * The component is loaded via `React.lazy(() => import("./CompanionVrm"))`
 * inside `<CompanionPet>`, with `<PetSvg>` as the `<Suspense>` fallback.
 * A user who never opts in to VRM never downloads the three.js chunk;
 * a user who does see the SVG pet flash for one frame while the VRM
 * model loads.
 *
 * ## WebGL auto-fallback (L.6 contract)
 *
 * The runtime never shows a broken canvas. Three failure modes all
 * funnel through `onFallback`:
 *
 * 1. `status.kind === "error"` with `reason: "no-webgl"` — the host
 *    browser cannot create a WebGL context.
 * 2. `status.kind === "error"` with `reason: "load-failed"` — the asset
 *    drop has not happened yet, or the URL is wrong.
 * 3. A thrown exception during expression dispatch (defensive: never
 *    trust three.js across versions).
 *
 * `onFallback` flips the store renderer to "svg" and surfaces a
 * one-time toast; the parent `<CompanionPet>` swaps in the SVG path on
 * the next render tick.
 *
 * ## Pose dispatch
 *
 * The hook hands the loaded `VrmModel` back via the `onReady` callback
 * — the component stores a local reference (the hook owns teardown,
 * not the React handle) and calls `expressionManager.setValue(name,
 * weight)` for each entry returned by `poseToExpressionForTest(pose)`.
 * Re-applying the same pose is a no-op so the runtime does not thrash
 * between renders.
 */
import { useEffect, useRef, useState } from "react";
import type { CompanionPose } from "../companion-pet";
import { poseToExpressionForTest } from "./pose-to-expression";
import { useVrmModel, type VrmModel } from "./use-vrm-model";
import type { ResolvedPreset } from "./manifest";

export interface CompanionVrmProps {
  /** Resolved preset catalog entry (already validated by the manifest helper). */
  preset: ResolvedPreset;
  /** On-screen pixel size. The internal canvas matches this for retina
   *  sharpness via `setPixelRatio`. */
  px: number;
  /** Pose to render. The component re-applies expressions only on
   *  **changes**. */
  pose: CompanionPose;
  /** Fires once on WebGL / load failure so the parent can flip to SVG. */
  onFallback?: (reason: "no-webgl" | "load-failed", detail: string) => void;
}

export function CompanionVrm({ preset, px, pose, onFallback }: CompanionVrmProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [lastAppliedPose, setLastAppliedPose] = useState<CompanionPose | null>(null);
  const fallbackFiredRef = useRef(false);
  // Local handle kept for the lifetime of the current mount. The hook
  // owns teardown; if the hook tears down before React unmounts, the
  // effect below clears this ref synchronously.
  const vrmRef = useRef<VrmModel | null>(null);

  const { status } = useVrmModel({
    vrmUrl: preset.vrmUrl,
    px,
    hostRef: containerRef,
    onReady: (model) => {
      vrmRef.current = model;
    },
  });

  // WebGL auto-fallback: fires once per mount per failure reason. The
  // parent uses this to flip the renderer to "svg" with a toast.
  useEffect(() => {
    if (status.kind !== "error") return;
    if (fallbackFiredRef.current) return;
    fallbackFiredRef.current = true;
    onFallback?.(status.reason, status.detail);
  }, [status, onFallback]);

  // Pose dispatch — apply expression weights on transition only.
  useEffect(() => {
    if (status.kind !== "ready") return;
    if (pose === lastAppliedPose) return;
    setLastAppliedPose(pose);

    const vrm = vrmRef.current;
    if (vrm === null) return;
    if (vrm.expressionManager === undefined) return;

    const weights = poseToExpressionForTest(pose);
    for (const [name, value] of Object.entries(weights)) {
      vrm.expressionManager.setValue(name, value);
    }
  }, [pose, status, lastAppliedPose]);

  return (
    <div
      ref={containerRef}
      data-companion-vrm={preset.id}
      data-companion-pose={pose}
      style={{
        width: `${px}px`,
        height: `${px}px`,
        position: "relative",
        overflow: "hidden",
        // Transparent background so the VRM model blends with the
        // surrounding surface — same requirement as the SVG and
        // Live2D layers.
        background: "transparent",
      }}
    >
      {/* The hook appends `<canvas>` directly to this div via the
          `containerRef` it reads from `renderer.domElement.parentElement`.
          Until status === "ready" the div is empty; the parent
          <CompanionPet>'s <Suspense> fallback already covers the
          visual gap. */}
    </div>
  );
}

/** Test-only export: lets a vitest spec mount the component under a
 *  jsdom-less harness and assert the rendered props without three.js. */
export const CompanionVrmForTest = CompanionVrm;
