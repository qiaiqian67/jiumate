/**
 * Lifecycle hook for the Live2D runtime.
 *
 * Probes WebGL, instantiates a transparent `PIXI.Application`, loads the
 * chosen Cubism `.moc3` over `pixi-live2d-display/cubism4`, and tears the
 * whole graph down on unmount. Returns a discriminated-union status so the
 * caller (`<CompanionLive2D>`) can react to load failures by firing the
 * WebGL auto-fallback path.
 *
 * ## WebGL auto-fallback (the core invariant)
 *
 * A user who explicitly picks Live2D in Settings must NEVER see a broken
 * canvas. Three failure modes feed the same fallback:
 *
 * 1. **WebGL unavailable** — the page is rendered by a browser without a
 *    GL context (a corporate kiosk, a locked-down Electron build, an old
 *    Android WebView). The runtime probes `canvas.getContext("webgl2")`
 *    first, then `webgl`; both missing reports `error: "no-webgl"`.
 * 2. **Asset missing** — the user enabled Live2D before the asset drop
 *    landed. `.moc3` 404s, `Live2DModel.from(url)` rejects. The hook
 *    reports `error: "load-failed"` with the URL for logging.
 * 3. **Live2D model JSON parse error** — a corrupt or partial asset drop.
 *    Surfaces as `error: "load-failed"` too.
 *
 * In all three the runtime flips the store's renderer back to `"svg"` and
 * the parent `<CompanionPet>` swaps in the SVG path. The user never sees
 * an empty box.
 *
 * ## prefers-reduced-motion
 *
 * When the OS reports reduced-motion, the hook pauses the idle motion
 * loop. The pet still renders the current pose (so the user can see what
 * they picked), it just does not animate. The pause is implemented via
 * `motionManager.stopAll()` rather than disabling the renderer — a future
 * "subtle blink" feature would hook the same flag.
 */
import { useEffect, useState } from "react";

export type Live2DLoadStatus =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "error"; reason: "no-webgl" | "load-failed"; detail: string };

export interface UseLive2DModelArgs {
  /** Absolute URL of the `.moc3` model. The hook owns the fetch. */
  moc3Url: string;
  /** On-screen pixel size; the internal canvas is 4× for retina sharpness. */
  px: number;
  /** Host element that the runtime appends `<canvas>` to. Owned by the
   *  parent component; the hook never replaces it. */
  hostRef: React.RefObject<HTMLElement | null>;
}

export interface UseLive2DModelResult {
  status: Live2DLoadStatus;
}

/** Probe whether a WebGL context can be created on the host canvas. Browsers
 *  disable WebGL on insecure contexts (HTTP without localhost) and on
 *  hardware where the GL stack failed to initialize; either case must
 *  short-circuit the runtime before pixi.js throws. */
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
 *  the idle motion loop; the pet still renders the current pose. */
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Test-only export for the two pure helpers above. */
export const probeWebGLForTest = probeWebGL;
export const prefersReducedMotionForTest = prefersReducedMotion;

/** Minimal structural type for the bits of pixi.js the hook touches. The
 *  real `PIXI.Application` and `Live2DModel` come from a lazy import —
 *  typing them here would leak pixi's TS surface into the rest of the
 *  codebase, which we want to avoid. */
interface PixiApp {
  view: HTMLElement;
  stage: { addChild: (child: unknown) => void };
  destroy: (removeView?: boolean, stageOpts?: object) => void;
}

interface Live2DModelHandle {
  destroy: () => void;
  motion?: { stopAll: () => void };
}

export function useLive2DModel({ moc3Url, px, hostRef }: UseLive2DModelArgs): UseLive2DModelResult {
  const [status, setStatus] = useState<Live2DLoadStatus>({ kind: "loading" });

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
        detail: "CompanionLive2D host ref not attached.",
      });
      return;
    }

    let cancelled = false;
    let app: PixiApp | null = null;
    let model: Live2DModelHandle | null = null;

    void (async () => {
      try {
        // Lazy-import so the Live2D chunk only enters the user's bundle
        // when they actually pick the renderer. SVG-path users never
        // download pixi.js.
        const [{ Application }, live2dModule, cubism4Module] = await Promise.all([
          import("pixi.js"),
          import("pixi-live2d-display"),
          import("pixi-live2d-display/cubism4"),
        ]);
        const { Live2DModel } = live2dModule as unknown as {
          Live2DModel: { from: (url: string) => Promise<Live2DModelHandle> };
        };
        // Side-effect import: registers the Cubism 4 runtime factory.
        void (cubism4Module as unknown);

        if (cancelled) return;

        const AppCtor = (Application as unknown as { default?: unknown }).default ?? Application;
        const nextApp = new (AppCtor as new (opts: object) => PixiApp)({
          width: px * 4,
          height: px * 4,
          alpha: true,
          backgroundAlpha: 0,
          antialias: true,
          resolution: typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
          autoDensity: true,
        });
        app = nextApp;

        if (cancelled) {
          nextApp.destroy(true, { children: true, texture: true });
          return;
        }

        host.appendChild(nextApp.view);
        nextApp.view.dataset.live2dHost = "true";

        const nextModel = await Live2DModel.from(moc3Url);
        if (cancelled) {
          nextModel.destroy();
          nextApp.destroy(true, { children: true, texture: true });
          return;
        }
        model = nextModel;
        nextApp.stage.addChild(nextModel as unknown);

        if (prefersReducedMotion()) {
          model.motion?.stopAll();
        }

        setStatus({ kind: "ready" });
      } catch (err) {
        if (cancelled) return;
        const detail = err instanceof Error ? err.message : String(err);
        setStatus({ kind: "error", reason: "load-failed", detail: `${moc3Url}: ${detail}` });
      }
    })();

    return () => {
      cancelled = true;
      try {
        model?.destroy();
      } catch {
        // Pixi's destroy throws when called twice — swallow.
      }
      try {
        app?.destroy(true, { children: true, texture: true });
      } catch {
        // Same: idempotent teardown is not guaranteed across versions.
      }
      model = null;
      app = null;
    };
  }, [moc3Url, px, hostRef]);

  return { status };
}
