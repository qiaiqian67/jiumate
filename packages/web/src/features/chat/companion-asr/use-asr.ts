/**
 * React hook wrapping the ASR provider registry.
 *
 * Returns `{ listening, error, start, stop, available }`. The chat composer
 * renders a mic button when `available && asrProvider !== "off"`, toggles
 * `listening` on tap, and writes the final transcript into the composer text
 * on stop. Errors are surfaced via a toast in chat-page.tsx (the hook itself
 * is presentational — UI concerns stay at the call site).
 *
 * Construction: same model as `use-tts.ts` — recreate the provider on
 * provider id change. Web Speech has global state, paid providers will need
 * cached auth and move to `useRef` later.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCompanionStore } from "../companion-store";
import { createAsrProvider } from "./registry";
import type { AsrError, CompanionAsrOptions, CompanionAsrProvider } from "./provider";

export interface UseAsrResult {
  /** True while a recognition session is active. The mic button's pressed state. */
  listening: boolean;
  /** Last error from the most recent session, cleared on next `start`. */
  error: AsrError | null;
  /** True when the provider's underlying API is exposed AND the page is in a
   *  secure context. The chat composer uses this to hide the mic button when
   *  recognition would always fail. */
  available: boolean;
  /** Begin a session. Resolves once the recognizer reports it has started;
   *  the actual transcript streams through the callbacks. */
  start: (
    callbacks: { onFinal: (text: string) => void },
    opts?: CompanionAsrOptions,
  ) => Promise<void>;
  /** End the session. Idempotent. */
  stop: () => void;
}

export function useAsr(): UseAsrResult {
  const { asrProvider } = useCompanionStore();
  const provider = useMemo<CompanionAsrProvider | null>(
    () => createAsrProvider(asrProvider),
    [asrProvider],
  );
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<AsrError | null>(null);
  // Cancel on provider change: switching from "webspeech" → "off" while a
  // session is live would otherwise leak a recognizer handle until the OS
  // times it out.
  const stopRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    stopRef.current = () => provider?.stop();
  }, [provider]);
  useEffect(() => {
    return () => {
      stopRef.current();
    };
  }, []);

  const start = useCallback<UseAsrResult["start"]>(
    (callbacks, opts) => {
      if (provider === null) {
        const err: AsrError = { kind: "other", message: "ASR provider is off" };
        setError(err);
        callbacks.onFinal("");
        return Promise.resolve();
      }
      setError(null);
      setListening(true);
      return provider
        .start(
          {
            onFinal: (text) => {
              callbacks.onFinal(text);
            },
            onEnd: (err) => {
              setListening(false);
              setError(err);
            },
          },
          opts,
        )
        .catch((e: unknown) => {
          setListening(false);
          const message = e instanceof Error ? e.message : String(e);
          setError({ kind: "other", message });
        });
    },
    [provider],
  );

  const stop = useCallback(() => {
    provider?.stop();
  }, [provider]);

  return {
    listening,
    error,
    available: provider !== null && provider.available(),
    start,
    stop,
  };
}
