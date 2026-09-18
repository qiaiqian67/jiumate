/**
 * Typewriter reveal for a bubble's output line.
 *
 * Ported from OpenBitFun's `seedTypewriterOutput` / `advanceTypewriterOutput`:
 * a new output starts one character short of complete (so the very first paint
 * is not an instant wall of text), then catches up in steps proportional to how
 * far behind it is. Output that replaces the previous one mid-stream restarts
 * rather than morphing into it.
 */
import { useEffect, useRef, useState } from "react";

/** Milliseconds between reveal ticks — ~36 characters/second. */
export const PET_TYPEWRITER_INTERVAL_MS = 28;

export function seedTypewriterOutput(target: string): string {
  if (target.length <= 1) return "";
  return target.slice(0, -1);
}

export function advanceTypewriterOutput(visible: string, target: string): string {
  if (visible === target) return visible;
  if (!target.startsWith(visible)) return target;
  const gap = target.length - visible.length;
  const step = Math.max(1, Math.floor(gap / 8));
  return target.slice(0, visible.length + step);
}

/**
 * Reveal `target` progressively. Returns the visible prefix and whether it is
 * still catching up (the caller styles the caret with it).
 */
export function useTypewriter(target: string): { text: string; typing: boolean } {
  const [text, setText] = useState(() => seedTypewriterOutput(target));
  const frameRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);

  useEffect(() => {
    setText((visible) => (target.startsWith(visible) ? visible : seedTypewriterOutput(target)));
  }, [target]);

  const typing = text !== target;

  useEffect(() => {
    if (!typing) return;
    let cancelled = false;
    const tick = (now: number) => {
      if (cancelled) return;
      frameRef.current = requestAnimationFrame(tick);
      if (now - lastTickRef.current < PET_TYPEWRITER_INTERVAL_MS) return;
      lastTickRef.current = now;
      setText((visible) => advanceTypewriterOutput(visible, target));
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [typing, target]);

  return { text, typing };
}
