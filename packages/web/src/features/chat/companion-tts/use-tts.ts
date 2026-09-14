/**
 * React hook wrapping the TTS provider registry.
 *
 * Returns a stable object whose methods (`speak`, `cancel`) read the current
 * provider / voice from the companion store on every call. The provider
 * instance is created on first use and dropped on provider change — that is
 * safe because Web Speech's handle is global and paid providers are cheap to
 * re-instantiate, and we never want a stale provider (e.g. an ElevenLabs
 * client built before the user swapped keys) to outlive the setting that
 * produced it.
 *
 * Voice list: the picker calls `readyVoices()` on mount and stores the
 * resolved list in local state, so the Segmented control re-renders once the
 * OS voice list arrives instead of flashing a single "default" entry.
 */
import { useEffect, useMemo, useState } from "react";
import { useCompanionStore } from "../companion-store";
import { createTtsProvider } from "./registry";
import type {
  CompanionTtsOptions,
  CompanionTtsProvider as TtsProvider,
  CompanionTtsVoice,
} from "./provider";

export interface UseTtsResult {
  /** Speak the text aloud. No-op when the provider is "off". */
  speak: (text: string, opts?: CompanionTtsOptions) => Promise<void>;
  /** Cancel the in-flight utterance, if any. */
  cancel: () => void;
  /** Voices the picker can render. Empty when the provider is "off" or the
   *  OS has not yet populated its voice list. */
  voices: readonly CompanionTtsVoice[];
}

export function useTts(): UseTtsResult {
  const { ttsProvider, ttsVoice } = useCompanionStore();
  const [voices, setVoices] = useState<readonly CompanionTtsVoice[]>([]);

  // Construct on every render where the provider id changes; otherwise reuse
  // the existing instance. Web Speech is a singleton in practice; paid
  // providers will move construction into a `useRef` once they need cached
  // auth, but the registry indirection keeps that swap contained.
  const provider = useMemo<TtsProvider | null>(() => createTtsProvider(ttsProvider), [ttsProvider]);

  useEffect(() => {
    if (provider === null) {
      setVoices([]);
      return;
    }
    // WebSpeechProvider extends the public interface with `readyVoices()` —
    // an async variant that resolves once Chromium's `voiceschanged` event has
    // fired. The hook checks via `in` so a future provider without that method
    // (e.g. ElevenLabs) silently falls through to whatever `listVoices()`
    // returns synchronously. The cast goes through `unknown` because TS
    // otherwise rejects widening a defined interface to a richer one.
    const ready = (
      provider as unknown as { readyVoices?: () => Promise<readonly CompanionTtsVoice[]> }
    ).readyVoices;
    if (typeof ready !== "function") {
      setVoices(provider.listVoices());
      return;
    }
    let cancelled = false;
    void ready().then((list) => {
      if (!cancelled) setVoices(list);
    });
    return () => {
      cancelled = true;
    };
  }, [provider]);

  // Cancel on unmount so a long utterance does not outlive the floating
  // window it belonged to.
  useEffect(() => {
    return () => {
      provider?.cancel();
    };
  }, [provider]);

  return {
    speak: (text, opts) => {
      if (provider === null) return Promise.resolve();
      const merged: CompanionTtsOptions = { ...opts, voiceId: opts?.voiceId ?? ttsVoice };
      return provider.speak(text, merged);
    },
    cancel: () => {
      provider?.cancel();
    },
    voices,
  };
}
