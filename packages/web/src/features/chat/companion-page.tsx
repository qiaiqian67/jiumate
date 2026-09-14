/**
 * `/companion` — the floating desktop-pet page.
 *
 * Mounted inside the Electron `companionWin` (frameless, transparent, alwaysOnTop).
 * The page shows the pet at its largest size and listens for the active session's
 * `taskState` over a BroadcastChannel so the pet reacts to chat activity without
 * re-establishing a full SSE stream in this tiny context.
 *
 * The page does NOT render any chat history or chrome — the chat window owns
 * those. The pet here is a passive surface: it shows the same idle / thinking
 * pose as the chat-window pet, and bubbles a reaction on turn completion.
 */
import { useEffect, useRef, useState } from "react";
import type { SessionStatus } from "@prismshadow/linsight-server/api";
import { CompanionPet } from "./companion-pet";
import { pickReaction, detectLang } from "./companion-banner-helpers";
import { useTts } from "./companion-tts/use-tts";

/** BroadcastChannel name shared with `chat-page.tsx`. Same origin (the loopback
 *  server), so the channel reaches the companion window without IPC plumbing.
 *  Hyphenated deliberately — the install-scope test scans every `linsight.*` key
 *  literal in the source and this name is NOT a storage key. */
export const COMPANION_CHANNEL = "linsight-companion";

/** Shape of messages the chat window posts onto the channel. Kept tiny so the
 *  payload doesn't pin memory while the floating window is open for hours. */
export type CompanionChannelMessage =
  { kind: "taskState"; value: SessionStatus } | { kind: "turnCompleted"; seed: number };

/** Typed helper because we post / receive in several places; the `unknown` cast
 *  is the one place we have to be careful about shape drift. */
function isMessage(value: unknown): value is CompanionChannelMessage {
  if (value === null || typeof value !== "object") return false;
  const kind = (value as { kind?: unknown }).kind;
  return kind === "taskState" || kind === "turnCompleted";
}

/** Augment `Window` with the preload bridge so the renderer can call
 *  `window.companion.*` without `any`. The Desktop build injects this; the Vite
 *  dev build does not, so the methods are typed optional on the window object. */
declare global {
  interface Window {
    companion?: {
      open(savedPos?: { x: number; y: number } | null): Promise<void>;
      close(): Promise<void>;
      move(pos: { x: number; y: number }): Promise<void>;
      getPosition(): Promise<{ x: number; y: number } | null>;
      savePosition(): Promise<{ x: number; y: number } | null>;
    };
  }
}

export function CompanionPage() {
  const [taskState, setTaskState] = useState<SessionStatus>("idle");
  const [bubble, setBubble] = useState<{ text: string; seed: number } | null>(null);
  const [lang] = useState(() => detectLang());
  const prevTaskState = useRef<SessionStatus | null>(null);

  // Receive chat-window broadcasts. The first message after mount arrives quickly
  // (the chat page opens the channel before its own first paint) so an idle pet
  // is the correct default until then.
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const bc = new BroadcastChannel(COMPANION_CHANNEL);
    bc.onmessage = (event) => {
      const msg = event.data;
      if (!isMessage(msg)) return;
      if (msg.kind === "taskState") setTaskState(msg.value);
      if (msg.kind === "turnCompleted") {
        setBubble({ text: pickReaction(msg.seed, lang), seed: msg.seed });
      }
    };
    return () => bc.close();
  }, [lang]);

  // Same running → idle bubble rule as the chat-banner, but driven by BroadcastChannel
  // messages instead of a prop. The companion window is a passive consumer: it
  // mirrors the chat window's taskState and reacts to the explicit turn boundary.
  useEffect(() => {
    const prev = prevTaskState.current;
    prevTaskState.current = taskState;
    if (prev === null) return;
    if (prev === "idle" || taskState !== "idle") return;
    // Use Date.now() for the seed so we don't need the chat window to tell us the
    // counter — the chat window's own banner still uses the deterministic pool, so
    // the two bubbles may diverge, and that's fine: the floating window is a
    // different visual surface that doesn't need lock-step reactions.
    const seed = Math.floor(Date.now() / 1000);
    setBubble({ text: pickReaction(seed, lang), seed });
  }, [taskState, lang]);

  // Auto-dismiss after 4s (matches the chat-window banner).
  useEffect(() => {
    if (bubble === null) return;
    const id = setTimeout(() => setBubble(null), 4000);
    return () => clearTimeout(id);
  }, [bubble]);

  // TTS (L.4): speak the bubble text when the floating window surfaces one.
  // `useTts` returns a no-op `speak` when the provider is "off", so this hook is
  // unconditional. Speech and bubble appear together; whichever ends first wins
  // (bubble auto-dismiss is 4 s, utterances on the Web Speech API play until
  // done — long bubbles will be cut by the user manually, short ones by silence).
  const tts = useTts();
  useEffect(() => {
    if (bubble === null) return;
    void tts.speak(bubble.text, { lang: detectLang() });
  }, [bubble, tts]);

  /** Drag-to-move + on-release, persist the final position via the IPC bridge.
   *  The pet has no chrome of its own, so dragging the SVG itself is the only
   *  affordance — we set `WebkitAppRegion: drag` on the wrapper so the whole
   *  canvas behaves like a native draggable region on every OS. */
  useEffect(() => {
    const bridge = window.companion;
    if (bridge === undefined) return;
    let startPos: { x: number; y: number } | null = null;
    let startMouse: { x: number; y: number } | null = null;
    const onMove = (e: MouseEvent) => {
      if (startPos === null || startMouse === null) return;
      void bridge.move({
        x: startPos.x + (e.clientX - startMouse.x),
        y: startPos.y + (e.clientY - startMouse.y),
      });
    };
    const onUp = () => {
      startPos = null;
      startMouse = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      void bridge.savePosition();
    };
    const onDown = (e: MouseEvent) => {
      // Only left-button drags; ignore right-clicks / wheel events.
      if (e.button !== 0) return;
      e.preventDefault();
      void bridge.getPosition().then((pos) => {
        if (pos === null) return;
        startPos = pos;
        startMouse = { x: e.clientX, y: e.clientY };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      });
    };
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, []);

  return (
    <div
      className="flex h-screen w-screen items-center justify-center overflow-hidden bg-transparent text-orange-900 select-none dark:text-orange-100"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      <div className="relative flex flex-col items-center gap-1">
        <CompanionPet taskState={taskState} size="lg" />
        {bubble !== null && (
          <span
            role="status"
            aria-live="polite"
            className="absolute top-full mt-1 whitespace-nowrap rounded-full border border-orange-200 bg-white/95 px-2 py-0.5 text-xs text-gray-700 shadow-md backdrop-blur dark:border-orange-900/60 dark:bg-gray-800/95 dark:text-gray-100"
          >
            {bubble.text}
          </span>
        )}
      </div>
      {/* × close button. Lives outside the draggable region so it can receive a
          click; also calls the preload bridge so the chat window's
          `companion:notifyPrefsChange` flow can sync the placement. */}
      <button
        type="button"
        onClick={() => window.companion?.close()}
        className="absolute right-1 top-1 rounded-full bg-white/70 px-1.5 py-0.5 text-xs text-gray-600 shadow-sm hover:bg-white dark:bg-gray-800/70 dark:text-gray-300"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        aria-label="Close companion"
      >
        ×
      </button>
    </div>
  );
}
