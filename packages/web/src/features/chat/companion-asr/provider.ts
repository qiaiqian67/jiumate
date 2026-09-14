/**
 * ASR provider contract.
 *
 * Mirror of the TTS interface (`companion-tts/provider.ts`): every concrete
 * provider implements `start` / `stop` / `available` so the chat composer's mic
 * button works against any engine — Chromium's `SpeechRecognition` today, AWS
 * Transcribe / OpenAI Whisper / local Whisper.cpp in later phases.
 *
 * Lifecycle: `start` opens a session that streams partial transcripts through
 * `onInterim` and ends via `onEnd`. The mic button toggles start/stop; the
 * caller decides what to do with the final transcript (the chat page writes
 * it into the composer and lets the user confirm before sending — voice is
 * not an Enter key).
 *
 * `available` is a sync probe the composer uses to render the mic button only
 * when the OS / browser actually exposes the API. Electron's Chromium does
 * not always enable `SpeechRecognition` on every platform (Firefox lacks it
 * entirely), so the probe is the difference between a working mic and a dead
 * one.
 */

export interface CompanionAsrCallbacks {
  /** Streamed partial transcript. May fire many times during one utterance as
   *  the recognizer refines its hypothesis. The chat composer does not render
   *  these in PR-C — they are reserved for a future "live preview" surface. */
  onInterim?: (text: string) => void;
  /** Final transcript for one utterance. Fires exactly once per `start` →
   *  recognizer-end cycle. */
  onFinal: (text: string) => void;
  /** Fires when the session ends for any reason (user stop, recognizer end,
   *  error). Always called after the final `onFinal` or with an empty
   *  transcript on error. */
  onEnd: (error: AsrError | null) => void;
}

/** Why the session ended. Distinct error code per failure mode so the UI can
 *  surface "mic permission denied" specifically rather than a generic message. */
export type AsrError =
  | { kind: "permission-denied" }
  | { kind: "no-speech" }
  | { kind: "audio-capture" }
  | { kind: "network" }
  | { kind: "aborted" }
  | { kind: "other"; message: string };

export interface CompanionAsrProvider {
  readonly id: string;
  /** True when the underlying API is exposed AND the current page is loaded
   *  over a context that satisfies the API's security requirements (Chromium
   *  requires HTTPS or localhost). Cheap to call. */
  available(): boolean;
  /** Begin a recognition session. Resolves when the session has started
   *  (the user has granted permission); rejects with `AsrError` when the
   *  start fails (permission denied, no mic, …). The actual transcript
   *  streams through the callbacks. */
  start(callbacks: CompanionAsrCallbacks, opts?: CompanionAsrOptions): Promise<void>;
  /** End the in-flight session. No-op when nothing is active. */
  stop(): void;
}

export interface CompanionAsrOptions {
  /** BCP-47 language tag ("zh-CN", "en-US"). Empty string = provider default
   *  (Chromium defaults to the document's lang). */
  lang?: string;
  /** True = continuous mode: the recognizer keeps going until explicitly
   *  stopped. False = single-utterance mode: the recognizer ends on the
   *  first pause. PR-C uses single-utterance; continuous is a future setting. */
  continuous?: boolean;
}
