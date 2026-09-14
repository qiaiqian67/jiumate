/**
 * Web Speech API ASR provider.
 *
 * Wraps `window.SpeechRecognition || window.webkitSpeechRecognition` so the
 * chat composer can transcribe the user's voice via the OS speech engine.
 * Quality is OS-dependent: Chromium on macOS uses the same engine as L.4's
 * TTS (so the voice round-trips), Windows uses SAPI 5, Linux usually has no
 * recognizer at all — the `available()` probe is what keeps the mic button
 * hidden in that case.
 *
 * Errors: the Web Speech API's `SpeechRecognitionErrorEvent.error` is a free-
 * form string ("not-allowed", "no-speech", "audio-capture", "network", …).
 * We map each to our `AsrError` union so the caller can render the right
 * message ("mic permission denied" is a different prompt from "we didn't hear
 * anything").
 */
import type {
  AsrError,
  CompanionAsrCallbacks,
  CompanionAsrOptions,
  CompanionAsrProvider,
} from "./provider";

/** Type-only access to the constructor — `window.webkitSpeechRecognition` is
 *  the prefixed Chromium name, while `window.SpeechRecognition` is the
 *  standard one. Either is fine; we cast through `unknown` because TS does
 *  not know about the prefixed variant. */
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((ev: SpeechRecognitionResultEventLike) => void) | null;
  onerror: ((ev: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

interface SpeechRecognitionResultEventLike {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}

interface SpeechRecognitionErrorEventLike {
  error: string;
  message?: string;
}

function resolveConstructor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export class WebSpeechAsrProvider implements CompanionAsrProvider {
  readonly id = "webspeech";

  /** Live session — non-null while `start()` is in flight. `stop()` ends it
   *  synchronously; the recognizer's own `onend` fires afterwards and
   *  resolves the promise + dispatches the caller's `onEnd`. */
  private active: SpeechRecognitionLike | null = null;
  private callbacks: CompanionAsrCallbacks | null = null;

  available(): boolean {
    if (resolveConstructor() === null) return false;
    // `secureContext` is Chromium's gate for the SpeechRecognition API:
    // HTTPS or localhost. The Web Speech TTS provider does not need this
    // gate, but ASR absolutely does — a non-secure page can speak but
    // cannot record. Reporting `false` here hides the mic button rather
    // than offering a button that always fails with "not-allowed".
    if (typeof window === "undefined") return false;
    return (window as unknown as { isSecureContext?: boolean }).isSecureContext !== false;
  }

  start(callbacks: CompanionAsrCallbacks, opts: CompanionAsrOptions = {}): Promise<void> {
    const Ctor = resolveConstructor();
    if (Ctor === null) {
      const err: AsrError = { kind: "other", message: "SpeechRecognition not supported" };
      callbacks.onEnd(err);
      return Promise.resolve();
    }
    if (this.active !== null) {
      // Already listening — the caller is double-tapping. End the prior session
      // and start a new one; this is friendlier than throwing because a user
      // re-clicking the mic usually means "I want to start over".
      this.active.abort();
      this.active = null;
    }
    const recognition = new Ctor();
    recognition.lang = opts.lang ?? "";
    recognition.continuous = opts.continuous ?? false;
    // Interim results fire `onresult` repeatedly with partial transcripts.
    // PR-C does not consume them — only the final one — but turning the flag
    // on costs nothing and lets a future phase render a live preview without
    // a constructor change.
    recognition.interimResults = true;

    this.callbacks = callbacks;
    this.active = recognition;

    return new Promise<void>((resolve) => {
      recognition.onstart = () => {
        resolve();
      };
      recognition.onresult = (event) => {
        let finalText = "";
        let interimText = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          // `event.results[i]` is `ArrayLike<...>` per the spec — under
          // noUncheckedIndexedAccess the lookup yields `T | undefined`, so
          // guard before reading `isFinal` / `[0]`.
          const result = event.results[i];
          if (result === undefined) continue;
          const transcript = result[0]?.transcript ?? "";
          if (result.isFinal) finalText += transcript;
          else interimText += transcript;
        }
        const cb = this.callbacks;
        if (cb === null) return;
        if (interimText !== "") cb.onInterim?.(interimText);
        if (finalText !== "") cb.onFinal(finalText);
      };
      recognition.onerror = (event) => {
        const err = mapError(event);
        const cb = this.callbacks;
        // Tear down the session FIRST so a subsequent `start()` does not see
        // a stale recognizer. The error is dispatched after the cleanup.
        this.active = null;
        this.callbacks = null;
        cb?.onEnd(err);
        resolve();
      };
      recognition.onend = () => {
        // Normal end (no error): dispatch the user's `onEnd` with a clean
        // null error and clear local refs. The next `start()` gets a fresh
        // recognizer instance — the Web Speech API does not allow re-using a
        // closed session.
        const cb = this.callbacks;
        this.active = null;
        this.callbacks = null;
        cb?.onEnd(null);
      };
      try {
        recognition.start();
      } catch (e) {
        // `start()` throws synchronously when the recognizer is already
        // started (race condition) or when the context is not allowed. Treat
        // both as a start failure so the caller sees a single error path.
        const message = e instanceof Error ? e.message : String(e);
        this.active = null;
        this.callbacks = null;
        const err: AsrError = { kind: "other", message };
        callbacks.onEnd(err);
        resolve();
      }
    });
  }

  stop(): void {
    if (this.active === null) return;
    try {
      this.active.stop();
    } catch {
      // Stopping an already-stopped recognizer throws on some Chromium
      // builds — ignore so the caller's "stop" path stays idempotent.
    }
  }
}

function mapError(event: SpeechRecognitionErrorEventLike): AsrError {
  switch (event.error) {
    case "not-allowed":
    case "service-not-allowed":
      return { kind: "permission-denied" };
    case "no-speech":
      return { kind: "no-speech" };
    case "audio-capture":
      return { kind: "audio-capture" };
    case "network":
      return { kind: "network" };
    case "aborted":
      return { kind: "aborted" };
    default:
      return { kind: "other", message: event.message ?? event.error };
  }
}

/** Exposed for unit tests — the `mapError` mapper is the only piece of the
 *  provider worth pinning in a fast, DOM-less test. The recognizer event
 *  lifecycle itself is harder to cover without a stubbed `SpeechRecognition`
 *  constructor, so we leave that to integration coverage. */
export const mapErrorForTest = mapError;
