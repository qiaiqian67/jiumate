/**
 * Proactive-chat trigger skeleton (L.2 of the airi roadmap).
 *
 * This phase ships only the **detection** half: a hook that watches user activity
 * (mouse / keyboard / touch / scroll) and returns whether the configured idle
 * threshold has elapsed. It does NOT yet call the LLM — the actual proactive
 * message is left to a later phase, which will subscribe to this hook's `armed`
 * transition and decide what to say.
 *
 * The split is intentional: the trigger is pure local logic (idempotent, no I/O),
 * so its behaviour can be pinned by a unit test without stubbing the API or the
 * session stream. A future L.x phase can swap the "what to say" half without
 * disturbing this skeleton.
 *
 * Activity reset policy:
 * - mousedown / keydown / touchstart / wheel all bump `lastActivityAt` to `now`.
 * - The hook re-evaluates every `tickMs` (default 5 s) — cheap enough that a busy
 *   tab never accumulates lag, far enough apart that an idle user does not see
 *   the timer fire every frame.
 * - `prefers-reduced-motion` does NOT silence this hook; the proactive trigger is
 *   a behavioural feature, not a visual one. The user opting out of proactive
 *   chat is a settings-page decision (slider on 0), not an OS preference.
 */
import { useEffect, useRef, useState } from "react";

/** Snapshot of what the hook currently thinks the pet should do. `armed` flips
 *  `true` exactly once per idle-threshold crossing — consumers should listen to
 *  the transition (use a `useEffect` keyed on `armed`) rather than poll the
 *  boolean, so the trigger fires at most once per quiet spell. */
export interface ProactiveTrigger {
  /** `true` when the configured idle threshold has elapsed without activity. */
  armed: boolean;
  /** Idle time in milliseconds, exposed so the UI can show "inactive 3m" if it
   *  wants to (L.4 / L.5 may want a countdown badge). */
  idleMs: number;
}

/** Pure helper: given an idle window and a threshold, is the trigger armed?
 *  Exported for the unit test under `web/test/` so the threshold semantics are
 *  pinned without rendering React. */
export function isProactiveArmedForTest(idleMs: number, thresholdMs: number): boolean {
  if (thresholdMs <= 0) return false;
  return idleMs >= thresholdMs;
}

/** Activity events that count as "the user is here". `wheel` is added because
 *  passive scrolling is the dominant activity on long reading turns and we do
 *  not want the pet to speak mid-read. `visibilitychange` is NOT here: a user
 *  who switched tabs IS idle from the pet's perspective, and the hook's natural
 *  pause handles that (no new activity events → idle grows). */
const ACTIVITY_EVENTS = ["mousedown", "keydown", "touchstart", "wheel"] as const;

/**
 * Hook: subscribe to user activity, and once the idle gap exceeds `thresholdMs`,
 * flip `armed` to `true` exactly once.
 *
 * @param thresholdMs idle time in ms before the trigger is allowed to fire.
 *                   Pass `0` (or any non-positive number) to disable — the hook
 *                   stays in the "never armed" state and never mounts listeners.
 * @param tickMs how often to re-evaluate. Defaults to 5 s; the prop exists for
 *               tests that need deterministic ticks without fake timers.
 */
export function useProactiveTrigger(thresholdMs: number, tickMs = 5_000): ProactiveTrigger {
  const lastActivityRef = useRef<number>(Date.now());
  const armedRef = useRef<boolean>(false);
  const [snapshot, setSnapshot] = useState<ProactiveTrigger>({ armed: false, idleMs: 0 });

  // Keep a stable ref to the latest threshold so the activity handler does not
  // need to be torn down + remounted on every settings-slider tick.
  const thresholdRef = useRef<number>(thresholdMs);
  useEffect(() => {
    thresholdRef.current = thresholdMs;
  }, [thresholdMs]);

  useEffect(() => {
    // Disabled — drop listeners entirely and force a "not armed" snapshot.
    if (thresholdMs <= 0) {
      armedRef.current = false;
      lastActivityRef.current = Date.now();
      setSnapshot({ armed: false, idleMs: 0 });
      return;
    }
    const bump = () => {
      lastActivityRef.current = Date.now();
      // Any new activity disarms the trigger. The hook only fires once per
      // quiet spell, so we eagerly flip back to `false` and let the next idle
      // window arm it again.
      if (armedRef.current) {
        armedRef.current = false;
        setSnapshot((s) => (s.armed ? { armed: false, idleMs: s.idleMs } : s));
      }
    };
    for (const ev of ACTIVITY_EVENTS) {
      document.addEventListener(ev, bump, { passive: true });
    }
    const id = window.setInterval(() => {
      const idleMs = Date.now() - lastActivityRef.current;
      const armed = isProactiveArmedForTest(idleMs, thresholdRef.current);
      if (armed !== armedRef.current) {
        armedRef.current = armed;
        setSnapshot({ armed, idleMs });
      } else {
        // Keep `idleMs` ticking so consumers that show a countdown badge see
        // live values without subscribing to mousemove themselves.
        setSnapshot((s) => (s.idleMs === idleMs ? s : { armed: s.armed, idleMs }));
      }
    }, tickMs);
    return () => {
      for (const ev of ACTIVITY_EVENTS) {
        document.removeEventListener(ev, bump);
      }
      window.clearInterval(id);
    };
  }, [thresholdMs <= 0, tickMs]);

  return snapshot;
}
