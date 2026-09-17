/**
 * Lifecycle hook for the VRM runtime.
 *
 * Probes WebGL, instantiates a three.js `Scene` with a camera + ambient
 * light, loads the chosen VRM over `GLTFLoader` + `@pixiv/three-vrm`,
 * and tears the whole graph down on unmount. Returns a discriminated-
 * union status so the caller (`<CompanionVrm>`) can react to load
 * failures by firing the WebGL auto-fallback path.
 *
 * ## WebGL auto-fallback (the core invariant)
 *
 * A user who explicitly picks VRM in Settings must NEVER see a broken
 * canvas. Three failure modes feed the same fallback:
 *
 * 1. **WebGL unavailable** — the page is rendered by a browser without a
 *    GL context (a corporate kiosk, a locked-down Electron build, an
 *    old Android WebView). The runtime probes `canvas.getContext("webgl2")`
 *    first, then `webgl`; both missing reports `error: "no-webgl"`.
 * 2. **Asset missing** — the user enabled VRM before the asset drop
 *    landed. `.vrm` 404s, `GLTFLoader.loadAsync` rejects. The hook
 *    reports `error: "load-failed"` with the URL for logging.
 * 3. **VRM parse error** — a corrupt or partial asset drop, or the
 *    file is GLTF rather than VRM. Surfaces as
 *    `error: "load-failed"` too.
 *
 * In all three the runtime flips the store's renderer back to `"svg"`
 * and the parent `<CompanionPet>` swaps in the SVG path. The user
 * never sees an empty box.
 *
 * ## prefers-reduced-motion
 *
 * When the OS reports reduced-motion, the hook pauses the render loop
 * (the scene still draws once at the current pose, but `requestAnimationFrame`
 * stops firing). The pet still renders the current expression; it just
 * does not animate the idle sway. A future "subtle blink" feature would
 * hook the same flag.
 */
import { useEffect, useState } from "react";

export type VrmLoadStatus =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "error"; reason: "no-webgl" | "load-failed"; detail: string };

export interface UseVrmModelResult {
  status: VrmLoadStatus;
}

/** Probe whether a WebGL context can be created on the host canvas. Browsers
 *  disable WebGL on insecure contexts (HTTP without localhost) and on
 *  hardware where the GL stack failed to initialize; either case must
 *  short-circuit the runtime before three.js throws. */
function probeWebGL(): boolean {
  if (typeof document === "undefined") return false;
  const canvas = document.createElement("canvas");
  const gl =
    canvas.getContext("webgl2") ??
    canvas.getContext("webgl") ??
    canvas.getContext("experimental-webgl");
  return gl !== null;
}

/** Detect `prefers-reduced-motion: reduce`. The hook honours it by pausing
 *  the idle render loop; the pet still renders the current pose. */
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Test-only export for the two pure helpers above. */
export const probeWebGLForTest = probeWebGL;
export const prefersReducedMotionForTest = prefersReducedMotion;

/** Minimal structural types for the bits of three.js + @pixiv/three-vrm
 *  the hook touches. The real classes come from a lazy import — typing
 *  them here would leak three's TS surface into the rest of the
 *  codebase, which we want to avoid. The structural shape is enough
 *  for the hook to drive teardown and pose dispatch. `add` /
 *  `remove` are typed as `(...args: unknown[]) => void` because the
 *  real three types are more specific than the runtime needs (we
 *  just need the call sites to compile without forcing the consumer
 *  to import three types). */
interface Scene {
  add: (...args: unknown[]) => void;
  remove: (...args: unknown[]) => void;
}

export interface VrmExpressionManager {
  setValue: (name: string, value: number) => void;
  update: () => void;
}

export interface VrmModel {
  scene: unknown;
  expressionManager?: VrmExpressionManager;
}

interface Renderer {
  domElement: HTMLElement;
  setSize: (w: number, h: number) => void;
  setPixelRatio: (ratio: number) => void;
  render: (scene: unknown, camera: unknown) => void;
  dispose: () => void;
}

interface PerspectiveCamera {
  position: { set: (x: number, y: number, z: number) => void };
  lookAt: (x: number, y: number, z: number) => void;
}

export interface UseVrmModelArgs {
  /** Absolute URL of the `.vrm` model. The hook owns the fetch. */
  vrmUrl: string;
  /** On-screen pixel size; the internal canvas matches this for retina
   *  sharpness via `setPixelRatio`. */
  px: number;
  /** Host element that the runtime appends `<canvas>` to. Owned by the
   *  parent component; the hook never replaces it. */
  hostRef: React.RefObject<HTMLElement | null>;
  /** Called once after the VRM model is loaded. The handle is owned by
   *  the hook (it tears down on unmount) but the parent may keep a
   *  local reference for the lifetime of this render so it can apply
   *  expressions synchronously on each pose change. The handle becomes
   *  stale after unmount — the hook invalidates it via teardown, and
   *  any later call is a no-op. */
  onReady?: (model: VrmModel) => void;
}

export interface UseVrmModelResult {
  status: VrmLoadStatus;
}

export function useVrmModel({ vrmUrl, px, hostRef, onReady }: UseVrmModelArgs): UseVrmModelResult {
  const [status, setStatus] = useState<VrmLoadStatus>({ kind: "loading" });

  useEffect(() => {
    if (!probeWebGL()) {
      setStatus({ kind: "error", reason: "no-webgl", detail: "WebGL context unavailable." });
      return;
    }
    const host = hostRef.current;
    if (host === null) {
      setStatus({
        kind: "error",
        reason: "load-failed",
        detail: "CompanionVrm host ref not attached.",
      });
      return;
    }

    let cancelled = false;
    let renderer: Renderer | null = null;
    let scene: Scene | null = null;
    let vrm: VrmModel | null = null;
    let rafId: number | null = null;
    const disposers: Array<() => void> = [];

    void (async () => {
      try {
        // Lazy-import so the VRM chunk only enters the user's bundle
        // when they actually pick the renderer. SVG-path users never
        // download three.js.
        const [three, vrmModule, gltfLoaderModule] = await Promise.all([
          import("three"),
          import("@pixiv/three-vrm"),
          import("three/addons/loaders/GLTFLoader.js"),
        ]);
        const THREE = (three as unknown as { default?: unknown }).default ?? three;
        const { GLTFLoader } = gltfLoaderModule as unknown as {
          GLTFLoader: new () => { loadAsync: (url: string) => Promise<{ userData: object }> };
        };
        const vrmCtor = (
          vrmModule as unknown as { VRM?: { from: (gltf: object) => Promise<VrmModel> } }
        ).VRM;
        if (vrmCtor === undefined) {
          throw new Error("@pixiv/three-vrm did not expose VRM constructor.");
        }

        if (cancelled) return;

        const nextRenderer = new (
          THREE as unknown as { WebGLRenderer: new (opts: object) => Renderer }
        ).WebGLRenderer({
          alpha: true,
          antialias: true,
        });
        nextRenderer.setPixelRatio(
          typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
        );
        nextRenderer.setSize(px, px);
        host.appendChild(nextRenderer.domElement);
        nextRenderer.domElement.dataset.vrmHost = "true";
        renderer = nextRenderer;

        if (cancelled) {
          nextRenderer.dispose();
          host.removeChild(nextRenderer.domElement);
          return;
        }

        const nextScene = new (THREE as unknown as { Scene: new () => Scene }).Scene();
        scene = nextScene;

        const camera = new (
          THREE as unknown as { PerspectiveCamera: new () => PerspectiveCamera }
        ).PerspectiveCamera();
        camera.position.set(0, 1.4, 1.6);
        camera.lookAt(0, 1.4, 0);

        const loader = new GLTFLoader();
        const gltf = await loader.loadAsync(vrmUrl);
        if (cancelled) {
          nextRenderer.dispose();
          host.removeChild(nextRenderer.domElement);
          return;
        }
        const nextVrm = await vrmCtor.from(gltf as unknown as object);
        if (cancelled) {
          // The VRM scene lives inside the three.js graph, not the DOM;
          // the only host child we appended is `renderer.domElement`,
          // which is the canvas. Removing the VRM scene from the host
          // is a category mistake that previous iterations made — it
          // never reached the DOM in the first place.
          nextRenderer.dispose();
          host.removeChild(nextRenderer.domElement);
          return;
        }
        vrm = nextVrm;
        nextScene.add(nextVrm.scene as never);

        // Hand the model out to the parent so it can apply expressions
        // synchronously on each pose change. The hook keeps ownership of
        // teardown; the parent must not retain the handle past unmount.
        onReady?.(nextVrm);

        // Drive the idle render loop. Three.js scenes need a continuous
        // render call (no built-in dirty tracking the way pixi has),
        // so requestAnimationFrame keeps the pet visibly responsive to
        // expression updates. The companion-pet parent already size-
        // gates VRM behind `size !== "sm"` so this only runs on the
        // visible surfaces.
        const tick = (): void => {
          if (cancelled) return;
          if (vrm?.expressionManager !== undefined) {
            vrm.expressionManager.update();
          }
          nextRenderer.render(nextScene as unknown as object, camera as unknown as object);
          rafId = requestAnimationFrame(tick);
        };
        if (!prefersReducedMotion()) {
          rafId = requestAnimationFrame(tick);
        } else {
          // Render once at the current pose so the user can see what
          // they picked even with reduced motion.
          nextRenderer.render(nextScene as unknown as object, camera as unknown as object);
        }
        disposers.push(() => {
          if (rafId !== null) cancelAnimationFrame(rafId);
        });

        setStatus({ kind: "ready" });
      } catch (err) {
        if (cancelled) return;
        const detail = err instanceof Error ? err.message : String(err);
        setStatus({ kind: "error", reason: "load-failed", detail: `${vrmUrl}: ${detail}` });
      }
    })();

    return () => {
      cancelled = true;
      for (const dispose of disposers) {
        try {
          dispose();
        } catch {
          // Best-effort teardown; one failing disposer must not block
          // the rest.
        }
      }
      try {
        if (vrm !== null && scene !== null) {
          scene.remove(vrm.scene);
        }
      } catch {
        // Scene.remove throws if the parent graph was already mutated.
      }
      try {
        renderer?.dispose();
      } catch {
        // Same: idempotent teardown is not guaranteed across versions.
      }
      try {
        if (renderer !== null && host !== null) {
          host.removeChild(renderer.domElement);
        }
      } catch {
        // Host may already be unmounted.
      }
      vrm = null;
      scene = null;
      renderer = null;
    };
  }, [vrmUrl, px, hostRef, onReady]);

  return { status };
}
