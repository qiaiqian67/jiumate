/**
 * Web Speech API TTS provider.
 *
 * Wraps `window.speechSynthesis` so the floating pet can speak the bubble text
 * aloud without an external service. Quality is whatever the OS ships: macOS
 * gets premium voices, Windows gets SAPI 5, Linux goes through speech-dispatcher.
 * For an Electron-only surface (the floating pet) that is good enough — and
 * if it is not, a later PR swaps this file out for an ElevenLabs / OpenAI
 * provider behind the same `CompanionTtsProvider` interface.
 *
 * Voice list: `speechSynthesis.getVoices()` is asynchronous on every browser;
 * on Chromium it fires `voiceschanged` once the OS voice list loads. We
 * subscribe to that event exactly once and resolve the cached list. A picker
 * that asks for voices before the first event gets an empty array rather than
 * throwing — the picker is `Segmented` with a single "default" entry as a
 * fallback, and re-renders once voices arrive.
 */
import type {
  CompanionTtsProvider as TtsProvider,
  CompanionTtsVoice,
  CompanionTtsOptions,
} from "./provider";

/** Minimum / maximum the Web Speech API actually clamps to. Outside this
 *  range the browser silently no-ops, which would surprise a user trying to
 *  pick a slow "storyteller" voice — we clamp at the wrapper boundary so
 *  rate / pitch inputs stay predictable across OSes. */
const RATE_MIN = 0.5;
const RATE_MAX = 2.0;
const PITCH_MIN = 0.5;
const PITCH_MAX = 2.0;

function clamp(value: number | undefined, lo: number, hi: number, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}

export class WebSpeechProvider implements TtsProvider {
  readonly id = "webspeech";

  /** Lazily resolved — the first `speechSynthesis.getVoices()` call on a fresh
   *  Chromium returns an empty array until `voiceschanged` fires (≤ a few ms).
   *  Caching the promise (not the array) lets every `listVoices()` caller get
   *  the same voices once they have settled, without spinning on the event. */
  private voicesPromise: Promise<readonly CompanionTtsVoice[]> | null = null;

  listVoices(): readonly CompanionTtsVoice[] {
    // The contract is synchronous (`readonly CompanionTtsVoice[]`), so we return
    // whatever is currently cached. Callers that want a populated list should
    // invoke `readyVoices()` and re-render when it resolves.
    const synth = this.synth;
    if (synth === null) return [];
    return mapVoices(synth.getVoices());
  }

  /** Async version of `listVoices` — resolves once the browser has populated
   *  its voice list. Used by the Settings picker so the voice dropdown does
   *  not flash "default" before the OS voices land. */
  readyVoices(): Promise<readonly CompanionTtsVoice[]> {
    if (this.voicesPromise !== null) return this.voicesPromise;
    const synth = this.synth;
    if (synth === null) {
      this.voicesPromise = Promise.resolve([]);
      return this.voicesPromise;
    }
    // Voices are already populated (rare but possible on second call).
    const initial = mapVoices(synth.getVoices());
    if (initial.length > 0) {
      this.voicesPromise = Promise.resolve(initial);
      return this.voicesPromise;
    }
    this.voicesPromise = new Promise<readonly CompanionTtsVoice[]>((resolve) => {
      const onChanged = () => {
        synth.removeEventListener("voiceschanged", onChanged);
        resolve(mapVoices(synth.getVoices()));
      };
      synth.addEventListener("voiceschanged", onChanged);
      // Hard timeout: if the event never fires (some headless test environments
      // do not have a voice list at all), resolve with whatever is there now so
      // the picker does not stay "loading" forever.
      window.setTimeout(() => {
        synth.removeEventListener("voiceschanged", onChanged);
        resolve(mapVoices(synth.getVoices()));
      }, 1_500);
    });
    return this.voicesPromise;
  }

  speak(text: string, opts: CompanionTtsOptions = {}): Promise<void> {
    const synth = this.synth;
    if (synth === null) return Promise.resolve();
    if (text.trim() === "") return Promise.resolve();
    // Cancel any in-flight utterance first. The contract says "at most one
    // utterance at a time" — starting a second one without cancelling yields
    // an interrupted first one on Chromium and a queue-jump on Firefox, which
    // is exactly the inconsistency we want to avoid.
    synth.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = opts.lang ?? "";
    utterance.rate = clamp(opts.rate, RATE_MIN, RATE_MAX, 1);
    utterance.pitch = clamp(opts.pitch, PITCH_MIN, PITCH_MAX, 1);
    utterance.volume = clamp(opts.volume, 0, 1, 1);
    const voice = pickVoice(synth.getVoices(), opts.voiceId, opts.lang);
    if (voice !== null) utterance.voice = voice;

    return new Promise<void>((resolve) => {
      // The Web Speech API exposes `start`, `end`, `error`, `pause`, `resume`.
      // We resolve on `start` (the contract says "resolves once the utterance
      // starts playing, not when it finishes") and on `error` so a failed
      // utterance does not hang the next caller.
      utterance.onstart = () => resolve();
      utterance.onerror = () => resolve();
      synth.speak(utterance);
    });
  }

  cancel(): void {
    this.synth?.cancel();
  }

  /** `window.speechSynthesis` is the only handle into the Web Speech API and
   *  there is exactly one of it per renderer. Guarded so the wrapper is safe
   *  to instantiate in environments without it (unit tests, headless). */
  private get synth(): SpeechSynthesis | null {
    if (typeof window === "undefined") return null;
    return window.speechSynthesis ?? null;
  }
}

function mapVoices(raw: readonly SpeechSynthesisVoice[]): readonly CompanionTtsVoice[] {
  return raw.map((v) => ({ id: v.voiceURI, label: `${v.name} (${v.lang})`, lang: v.lang }));
}

/** Pick the best voice for a request. Prefers an exact voiceURI match, then a
 *  lang match (the user's BCP-47 tag equals the voice's lang), then the
 *  first non-empty voice. Returning `null` lets the browser pick its own
 *  default — that is the same outcome as no override. */
function pickVoice(
  voices: readonly SpeechSynthesisVoice[],
  voiceId: string | undefined,
  lang: string | undefined,
): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;
  if (voiceId !== undefined && voiceId !== "") {
    const exact = voices.find((v) => v.voiceURI === voiceId);
    if (exact !== undefined) return exact;
  }
  if (lang !== undefined && lang !== "") {
    const matching = voices.find((v) => v.lang === lang);
    if (matching !== undefined) return matching;
  }
  return null;
}

// Export the pure helpers behind `_ForTest` accessors so the unit test under
// `web/test/companion-tts/` can pin voice matching + rate / pitch clamping
// without rendering React or stubbing the SpeechSynthesis API.
export const clampForTest = (
  value: number | undefined,
  lo: number,
  hi: number,
  fallback: number,
): number => clamp(value, lo, hi, fallback);
export const mapVoicesForTest = (
  raw: readonly SpeechSynthesisVoice[],
): readonly CompanionTtsVoice[] => mapVoices(raw);
export const pickVoiceForTest = (
  voices: readonly SpeechSynthesisVoice[],
  voiceId: string | undefined,
  lang: string | undefined,
): SpeechSynthesisVoice | null => pickVoice(voices, voiceId, lang);
