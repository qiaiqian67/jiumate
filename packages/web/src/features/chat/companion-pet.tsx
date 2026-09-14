/**
 * Shared AI companion visual: the fox SVG + pose-aware status text + idle animation.
 *
 * Three surfaces (banner above the composer, right rail widget, Electron floating
 * window) all mount the same pet; only the placement / drag handle differ, and that
 * is the caller's job, not this component's.
 *
 * ## Pose state machine
 *
 *   idle        — the default, eyes open, tail sway via CSS
 *   thinking    — eyes closed (square lids), head tilt -3°, used while `taskState`
 *                  is anything other than "idle"
 *   listening   — ears perked forward, eyes wide-open — reserved for the ASR phase
 *                  (L.5); surfaced now so banner / widget / floating can switch
 *                  instantly when ASR lands
 *   speaking    — mouth open, body bob — reserved for TTS phase (L.4)
 *   celebrating — squint eyes, mouth wide open, tail fast-wag — fires when the
 *                  bubble mounts in the banner
 *   confused    — head tilt -8°, asymmetric ears — reserved for permission denied /
 *                  error feedback
 *   sleepy      — half-closed eyes, droopy ears — shown after long idle (L.2
 *                  proactive trigger feeds this)
 *
 * The pose can be driven externally via the `pose` prop (used by `CompanionBanner`
 * to flip into "celebrating" when the bubble pops) or computed from `taskState`
 * when no override is supplied.
 *
 * ## Micro-animations
 *
 * - **Eye-tracking**: the eye circles shift ±2 px toward the cursor (parallax,
 *   disabled when `prefers-reduced-motion: reduce`). Reads as "the pet is paying
 *   attention" without being uncanny.
 * - **Blink**: a thin horizontal lid covers the open eyes every 3-7 s, randomised
 *   per cycle so two adjacent pets don't sync. Driven by a recursive `setTimeout`
 *   (not `setInterval`) so a paused tab doesn't fire a backlog of blinks on resume.
 * - **Breathing**: handled by the `companion-breathe` CSS keyframe in `styles.css`
 *   (a 4 s ease-in-out 0.96 → 1.0 scale) — declarative, no JS work per frame.
 * - **Wave**: clicking the pet fires `onClick` (caller decides what to do) and
 *   locally animates the ears for ~1.5 s with a heart bubble popping above the
 *   head. The wave is local-only so a click on the banner's pet doesn't reopen a
 *   chat window or any other global side effect.
 *
 * Bubble behaviour is NOT included — the banner pops a one-word reaction after
 * each turn, but the right-rail and floating window should not steal focus from
 * the conversation. Surfaces that want a bubble add it themselves.
 */
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { SessionStatus } from "@prismshadow/linsight-server/api";
import { useCompanionStore } from "./companion-store";
import { resolvePreset } from "./companion-live2d/manifest";

/** Pixel size of the SVG. The right widget sits at `md` (visual parity with the
 *  dock icons); the banner uses `sm` (one row of micro-copy); the floating window
 *  uses `lg` because the pet is the whole window. */
export type CompanionSize = "sm" | "md" | "lg";

const SIZE_PX: Record<CompanionSize, number> = {
  sm: 36,
  md: 64,
  lg: 96,
};

/** Seven poses. Names are stable strings — the same names travel to the future
 *  VRM avatar (Phase L.6) where they'll index a GLB animation. Keeping them
 *  stable now avoids a churn migration later. */
export type CompanionPose =
  "idle" | "thinking" | "listening" | "speaking" | "celebrating" | "confused" | "sleepy";

/** Canonical ordering — the future VRM avatar's animation list will follow this
 *  same sequence so a UI selector iterating it gets a predictable order. */
export const COMPANION_POSES: readonly CompanionPose[] = [
  "idle",
  "thinking",
  "listening",
  "speaking",
  "celebrating",
  "confused",
  "sleepy",
];

/** Map `taskState` → pose when the caller doesn't pass an override. The mapping
 *  lives here rather than in the banner so the floating window and widget pick
 *  up the same convention without each re-implementing it.
 *
 *  Exported under a `_ForTest` suffix so the unit test can pin the mapping
 *  without rendering React. */
function poseFromTaskState(state: SessionStatus): CompanionPose {
  return state === "idle" ? "idle" : "thinking";
}

/** Test-only export. */
export const poseFromTaskStateForTest = poseFromTaskState;

export interface CompanionPetProps {
  taskState: SessionStatus;
  /** Visual scale. Defaults to `md`. */
  size?: CompanionSize;
  /** Force a specific pose (e.g. banner flips to "celebrating" when its bubble
   *  pops). When omitted, the pose is derived from `taskState`. */
  pose?: CompanionPose;
  /** Fires when the user clicks the pet. The local wave animation runs
   *  unconditionally — this callback exists for callers that want to chain a
   *  side effect (open the chat composer, focus a dock panel, …). */
  onClick?: () => void;
}

/** Cheap one-shot language sniff. Duplicated here rather than imported from the
 *  banner-helpers file because the pet file is consumed by the widget and the
 *  floating window too, and the helper would pull `localStorage` semantics it
 *  doesn't need. */
function detectLang(): "zh" | "en" {
  if (typeof navigator === "undefined") return "en";
  const raw = navigator.language.toLowerCase();
  return raw.startsWith("zh") ? "zh" : "en";
}

/** Lazy-loaded Live2D renderer (L.6). Bundled with pixi.js + the Cubism
 *  runtime; the `Suspense` fallback below renders the SVG path while the
 *  chunk downloads, so the user sees the existing 2D fox flash for one
 *  frame instead of an empty box. A user who never opts in to Live2D
 *  never downloads this chunk. */
const CompanionLive2DLazy = lazy(async () => {
  const mod = await import("./companion-live2d/CompanionLive2D");
  return { default: mod.CompanionLive2D };
});

/** Micro-copy used by all surfaces. Inline rather than in the i18n catalog
 *  because each pose needs a short variant — adding 14 keys would be churn for
 *  very little benefit. The two languages are picked once via `navigator.language`
 *  and static across the session. */
function statusCopy(pose: CompanionPose, lang: "zh" | "en"): string {
  if (lang === "zh") {
    switch (pose) {
      case "thinking":
        return "在想…";
      case "listening":
        return "在听你说话…";
      case "speaking":
        return "嗯嗯…";
      case "celebrating":
        return "🎉 收到啦";
      case "confused":
        return "嗯…？";
      case "sleepy":
        return "💤 在打盹";
      case "idle":
      default:
        return "🐾 我在这里陪着你";
    }
  }
  switch (pose) {
    case "thinking":
      return "thinking…";
    case "listening":
      return "listening…";
    case "speaking":
      return "mmm-hm";
    case "celebrating":
      return "🎉 got it";
    case "confused":
      return "huh…?";
    case "sleepy":
      return "💤 dozing";
    case "idle":
    default:
      return "🐾 I'm here with you";
  }
}

/** Test-only export. */
export const statusCopyForTest = statusCopy;

/** Per-pose geometric tweaks. `tilt` rotates the whole head around the centre;
 *  `eyeY` raises/lowers the eye line (sleepy pushes it down so the half-closed
 *  lid sits at the right place); `mouth` swaps the mouth path. Ears are picked
 *  from a small library per pose. */
interface PoseGeometry {
  tilt: number;
  eyeY: number;
  /** "open" = round dots, "closed" = horizontal lids, "half" = half-open lids
   *  used by sleepy; "wide" = bigger dots for listening. */
  eyeShape: "open" | "closed" | "half" | "wide";
  /** "smile" / "open" / "flat" / "oh" — drives the mouth path. */
  mouth: "smile" | "open" | "flat" | "oh";
  /** Tail sway speed multiplier. Celebrating wants the tail wagging fast. */
  tailSpeed: "slow" | "fast";
  /** Ears: "normal" / "perked" (forward) / "droopy" (down) / "asymmetric"
   *  (one perked, one droopy for confused). */
  ears: "normal" | "perked" | "droopy" | "asymmetric";
}

const POSE_GEOMETRY: Record<CompanionPose, PoseGeometry> = {
  idle: { tilt: 0, eyeY: 17, eyeShape: "open", mouth: "smile", tailSpeed: "slow", ears: "normal" },
  thinking: {
    tilt: -3,
    eyeY: 17,
    eyeShape: "closed",
    mouth: "flat",
    tailSpeed: "slow",
    ears: "normal",
  },
  listening: {
    tilt: 0,
    eyeY: 17,
    eyeShape: "wide",
    mouth: "flat",
    tailSpeed: "slow",
    ears: "perked",
  },
  speaking: {
    tilt: 0,
    eyeY: 17,
    eyeShape: "open",
    mouth: "open",
    tailSpeed: "slow",
    ears: "normal",
  },
  celebrating: {
    tilt: 0,
    eyeY: 17,
    eyeShape: "open",
    mouth: "oh",
    tailSpeed: "fast",
    ears: "normal",
  },
  confused: {
    tilt: -8,
    eyeY: 17,
    eyeShape: "open",
    mouth: "flat",
    tailSpeed: "slow",
    ears: "asymmetric",
  },
  sleepy: { tilt: 4, eyeY: 18, eyeShape: "half", mouth: "flat", tailSpeed: "slow", ears: "droopy" },
};

/** Ear paths. Indexed by pose. Each is a small triangle, the SVG viewBox is 0..36
 *  so the path coordinates stay constant across sizes. */
function earPath(side: "left" | "right", shape: PoseGeometry["ears"]): string {
  // Base triangle points are (12,10) (14,5) (17,10) for the left ear.
  // `perked` rotates the tip forward; `droopy` drops the tip; `asymmetric` mixes
  // (left normal, right droopy) for confused.
  const which = shape === "asymmetric" ? (side === "left" ? "normal" : "droopy") : shape;
  switch (which) {
    case "perked":
      // Tip pulled forward (smaller x)
      return side === "left" ? "M11 10 L13 4 L17 10 Z" : "M25 10 L23 4 L19 10 Z";
    case "droopy":
      // Tip drops down (bigger y)
      return side === "left" ? "M12 10 L14 13 L17 10 Z" : "M24 10 L22 13 L19 10 Z";
    case "normal":
    default:
      return side === "left" ? "M12 10 L14 5 L17 10 Z" : "M24 10 L22 5 L19 10 Z";
  }
}

/** Eye-shape geometry. Returns two `<path>`-friendly rect/circle elements per
 *  side. Coords are in the 0..36 viewBox. The two sides share their y-coordinate
 *  (`eyeY` from the pose geometry) so the blink stays level. */
function eyeElements(
  shape: PoseGeometry["eyeShape"],
  eyeY: number,
  isBlinking: boolean,
  eyeOffset: { x: number; y: number },
): React.ReactNode {
  // Blinking takes priority — a closed lid renders regardless of pose shape so
  // the pet "blinks" even mid-celebration without changing pose.
  const effective = isBlinking ? "closed" : shape;
  const dx = eyeOffset.x;
  const dy = eyeOffset.y;
  switch (effective) {
    case "open":
      return (
        <>
          <circle
            cx={15 + dx}
            cy={eyeY + dy}
            r={1.4}
            fill="currentColor"
            className="text-gray-800 dark:text-gray-100"
          />
          <circle
            cx={21 + dx}
            cy={eyeY + dy}
            r={1.4}
            fill="currentColor"
            className="text-gray-800 dark:text-gray-100"
          />
        </>
      );
    case "wide":
      return (
        <>
          <circle
            cx={15 + dx}
            cy={eyeY + dy}
            r={1.8}
            fill="currentColor"
            className="text-gray-800 dark:text-gray-100"
          />
          <circle
            cx={21 + dx}
            cy={eyeY + dy}
            r={1.8}
            fill="currentColor"
            className="text-gray-800 dark:text-gray-100"
          />
        </>
      );
    case "closed":
      return (
        <>
          <rect
            x={13.6 + dx}
            y={eyeY + dy - 0.5}
            width={2.8}
            height={1}
            rx={0.5}
            fill="currentColor"
            className="text-gray-800 dark:text-gray-100"
          />
          <rect
            x={19.6 + dx}
            y={eyeY + dy - 0.5}
            width={2.8}
            height={1}
            rx={0.5}
            fill="currentColor"
            className="text-gray-800 dark:text-gray-100"
          />
        </>
      );
    case "half":
      return (
        <>
          {/* Half-lid: a thin rect with rounded edges, sitting lower than the open
              eye — reads as "dozing off". */}
          <rect
            x={13.6 + dx}
            y={eyeY + dy + 0.4}
            width={2.8}
            height={0.6}
            rx={0.3}
            fill="currentColor"
            className="text-gray-800 dark:text-gray-100"
          />
          <rect
            x={19.6 + dx}
            y={eyeY + dy + 0.4}
            width={2.8}
            height={0.6}
            rx={0.3}
            fill="currentColor"
            className="text-gray-800 dark:text-gray-100"
          />
        </>
      );
  }
}

/** Mouth path, keyed off pose geometry. Coords are in the 0..36 viewBox. */
function mouthPath(shape: PoseGeometry["mouth"]): React.ReactNode {
  switch (shape) {
    case "smile":
      return (
        <path
          d="M17 19.5 Q18 20.5 19 19.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          className="text-gray-700 dark:text-gray-200"
        />
      );
    case "open":
      return (
        <ellipse
          cx="18"
          cy="20"
          rx="1.2"
          ry="0.8"
          fill="currentColor"
          className="text-gray-700 dark:text-gray-200"
        />
      );
    case "oh":
      // Celebrating: bigger mouth, more surprised.
      return (
        <ellipse
          cx="18"
          cy="20"
          rx="1.5"
          ry="1.1"
          fill="currentColor"
          className="text-gray-700 dark:text-gray-200"
        />
      );
    case "flat":
      return (
        <path
          d="M17 20 L19 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          className="text-gray-700 dark:text-gray-200"
        />
      );
  }
}

/** The SVG itself. Eyes / ears / tail are all separate elements so the parent
 *  can animate them via class toggles (`companion-tail-sway` and
 *  `companion-breathe` live in `styles.css`). */
function PetSvg({
  pose,
  px,
  isBlinking,
  eyeOffset,
  isWaving,
}: {
  pose: CompanionPose;
  px: number;
  isBlinking: boolean;
  eyeOffset: { x: number; y: number };
  isWaving: boolean;
}) {
  const geo = POSE_GEOMETRY[pose];
  // Wrap the head in a <g transform="rotate(...)"> for tilt — tail stays outside
  // the tilt group so the sway reads as a tail swing, not a whole-body spin.
  return (
    <svg width={px} height={px} viewBox="0 0 36 36" fill="none" aria-hidden className="shrink-0">
      {/* Tail — separate path so it can sway via the CSS keyframes. The
          `tail-sway-fast` class replaces `tail-sway` for the celebrating pose. */}
      <path
        d="M28 22 Q33 18 30 12 Q27 16 25 18 Z"
        fill="currentColor"
        className={`text-orange-400/80 ${
          geo.tailSpeed === "fast" ? "companion-tail-sway-fast" : "companion-tail-sway"
        }`}
      />
      {/* Head group with tilt. `transform-origin` is set to the centre of the
          viewBox so a few degrees look like a natural head turn, not a slide. */}
      <g transform={`rotate(${geo.tilt} 18 18)`}>
        {/* Body / head — one path. `currentColor` lets the parent class pick a
            tone that reads well on either light or dark surfaces. */}
        <path
          d="M8 22 Q6 14 14 10 Q18 8 22 10 Q30 14 28 22 Q24 26 18 26 Q12 26 8 22 Z"
          fill="currentColor"
          className="text-orange-300 dark:text-orange-400/90"
        />
        {/* Ears — each pose chooses its own path. `isWaving` triggers an
            additional CSS class that wiggles the left ear for ~1.5 s. */}
        <path
          d={earPath("left", geo.ears)}
          fill="currentColor"
          className={`text-orange-400 ${isWaving ? "companion-ear-wave" : ""}`}
        />
        <path d={earPath("right", geo.ears)} fill="currentColor" className="text-orange-400" />
        {/* Eyes */}
        {eyeElements(geo.eyeShape, geo.eyeY, isBlinking, eyeOffset)}
        {/* Blush dots — kept in the tilt group so they follow the head. */}
        <circle cx="13" cy="20" r="1" fill="currentColor" className="text-pink-300/80" />
        <circle cx="23" cy="20" r="1" fill="currentColor" className="text-pink-300/80" />
        {/* Mouth */}
        {mouthPath(geo.mouth)}
      </g>
    </svg>
  );
}

/** Heart bubble that pops above the pet during the wave reaction. Local state,
 *  not in the i18n catalog — every locale gets the same ♥ glyph. */
function HeartBubble({ visible }: { visible: boolean }) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={
        "pointer-events-none absolute -top-2 left-1/2 -translate-x-1/2 select-none whitespace-nowrap text-sm " +
        "transition-all duration-300 " +
        (visible ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0")
      }
    >
      ♥
    </span>
  );
}

/** Detect `prefers-reduced-motion: reduce` once at module level. Cheap because
 *  it doesn't subscribe to changes — a reduced-motion user gets the static pose
 *  for the whole session, which is what they asked for. */
const PREFERS_REDUCED_MOTION =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function CompanionPet({ taskState, size = "md", pose, onClick }: CompanionPetProps) {
  const effectivePose = pose ?? poseFromTaskState(taskState);
  const px = SIZE_PX[size];
  // Renderer swap (L.6): the renderer comes from the companion store; the
  // preset resolves through the manifest helper (which falls back to
  // `null` until assets are present). `useLive2D` reads both — it must
  // stay in the component body so React hooks rules are satisfied, and
  // `resolvePreset` is pure so calling it inside render is cheap.
  const { avatarRenderer, avatarPreset, setAvatarRenderer } = useCompanionStore();
  const resolvedPreset = avatarRenderer === "live2d" ? resolvePreset(avatarPreset) : null;
  // Size gate: the 36 px banner is too small for a Cubism model face to
  // read clearly, so even when the user picks Live2D the banner keeps
  // the SVG path. The widget (md) and floating window (lg) honour the
  // pick. This is the documented honest trade-off from the L.6 plan.
  const useLive2D = avatarRenderer === "live2d" && size !== "sm" && resolvedPreset !== null;
  // WebGL auto-fallback. The lazy chunk reports `no-webgl` or `load-failed`
  // through `<CompanionLive2D onFallback>`; we flip the renderer back to
  // "svg" and let the existing SVG path take over on the next render.
  const onLive2DFallback = (): void => {
    setAvatarRenderer("svg");
  };

  // Eye-tracking offset, in viewBox units (the SVG itself is 0..36, eyes move by
  // ±2px at most). Capped to ±2 so a very off-screen cursor can't catapult the
  // eyes past the head.
  const [eyeOffset, setEyeOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (PREFERS_REDUCED_MOTION) return;
    const onMove = (e: MouseEvent) => {
      const el = containerRef.current;
      if (el === null) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      // Normalise the cursor's distance from the centre. A pointer 200 px away
      // is "very far" — clamp the offset to ±2 px in viewBox units (which scales
      // proportionally with the SVG, so a 96-px pet moves more than a 36-px one).
      const dx = (e.clientX - cx) / Math.max(rect.width, 1);
      const dy = (e.clientY - cy) / Math.max(rect.height, 1);
      setEyeOffset({
        x: Math.max(-2, Math.min(2, dx * 4)),
        y: Math.max(-2, Math.min(2, dy * 4)),
      });
    };
    document.addEventListener("mousemove", onMove);
    return () => document.removeEventListener("mousemove", onMove);
  }, []);

  // Random blink — recursive `setTimeout` so a backgrounded tab doesn't fire a
  // backlog of blinks on resume (which an interval would). Each cycle is 3-7 s,
  // then a 150 ms "closed" frame.
  const [isBlinking, setIsBlinking] = useState(false);
  useEffect(() => {
    if (PREFERS_REDUCED_MOTION) return;
    let timeoutId: number | null = null;
    let closedId: number | null = null;
    const tick = () => {
      setIsBlinking(true);
      closedId = window.setTimeout(() => {
        setIsBlinking(false);
        const next = 3000 + Math.random() * 4000;
        timeoutId = window.setTimeout(tick, next);
      }, 150);
    };
    timeoutId = window.setTimeout(tick, 3000 + Math.random() * 4000);
    return () => {
      if (timeoutId !== null) clearTimeout(timeoutId);
      if (closedId !== null) clearTimeout(closedId);
    };
  }, []);

  // Click → wave: animate the ears and pop a heart bubble above the head. The
  // local animation runs unconditionally; the optional `onClick` callback fires
  // for callers that want to chain a side effect.
  const [isWaving, setIsWaving] = useState(false);
  const handleClick = (e: ReactMouseEvent) => {
    e.stopPropagation();
    setIsWaving(true);
    window.setTimeout(() => setIsWaving(false), 1500);
    onClick?.();
  };

  const copy = statusCopy(effectivePose, detectLang());
  const layoutClass = size === "lg" ? "flex-col gap-1 text-center" : "flex-row gap-2";

  return (
    <div
      ref={containerRef}
      onClick={handleClick}
      // `companion-breathe` is the CSS keyframe for the gentle 4 s scale; applied
      // to the inner span so it doesn't fight the outer flex layout.
      className={`flex items-center text-orange-900 dark:text-orange-100 ${layoutClass}`}
    >
      <div className="relative companion-breathe" style={{ width: px, height: px }}>
        {useLive2D && resolvedPreset !== null ? (
          // Lazy Live2D renderer (L.6). The `<Suspense>` fallback is the
          // existing `<PetSvg>` so a user who just enabled Live2D sees
          // the SVG for one frame while the chunk downloads; the heart
          // bubble lives outside the renderer so it works in both paths.
          <Suspense
            fallback={
              <PetSvg
                pose={effectivePose}
                px={px}
                isBlinking={isBlinking}
                eyeOffset={eyeOffset}
                isWaving={isWaving}
              />
            }
          >
            <CompanionLive2DLazy
              preset={resolvedPreset}
              px={px}
              pose={effectivePose}
              onFallback={onLive2DFallback}
            />
          </Suspense>
        ) : (
          <PetSvg
            pose={effectivePose}
            px={px}
            isBlinking={isBlinking}
            eyeOffset={eyeOffset}
            isWaving={isWaving}
          />
        )}
        <HeartBubble visible={isWaving} />
      </div>
      <span
        className={
          size === "sm"
            ? "min-w-0 flex-1 truncate text-xs"
            : size === "md"
              ? "text-sm font-medium"
              : "text-xs"
        }
      >
        {copy}
      </span>
    </div>
  );
}
