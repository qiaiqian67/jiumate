/**
 * Which browser the agent drives: the user's choice, and the state of it.
 *
 * The choice is the user's, and it is stored on the server with the rest of their prefs —
 * the browser is where their sign-ins live, so it is not a local-only preference, and one
 * user's choice must not change what another user's agent sees.
 *
 * The state is read from the server's own answer rather than kept separately, so the panel
 * and the settings page cannot disagree about which browser is in use.
 */
import { useCallback, useEffect, useState } from "react";
import type { BrowserBackend, BrowserStatus } from "@prismshadow/jiumate-core/interfaces";
import { apiFetch } from "../api/client";

/** The backends a user may pick, in the order the settings row lists them. */
export const BROWSER_BACKENDS: readonly BrowserBackend[] = ["builtin", "headless", "chrome"];

export interface BrowserBackendState {
  /** The backend in use, or null before the server has answered. */
  backend: BrowserBackend | null;
  /** Whether the browser can be driven right now. */
  available: boolean;
  /** The user's stored choice, or null when they have not made one. */
  choice: BrowserBackend | null;
  /** Picks one; the change applies at once. */
  set: (backend: BrowserBackend) => Promise<void>;
  /** Re-reads the browser's state. */
  refresh: () => Promise<void>;
}

/** The stored choice, out of the prefs the app already keeps. */
function choiceOf(prefs: { browserBackend?: BrowserBackend } | null): BrowserBackend | null {
  const stored = prefs?.browserBackend;
  return stored !== undefined && (BROWSER_BACKENDS as readonly string[]).includes(stored)
    ? stored
    : null;
}

export function useBrowserBackend(): BrowserBackendState {
  const [backend, setBackend] = useState<BrowserBackend | null>(null);
  const [available, setAvailable] = useState(false);
  const [choice, setChoice] = useState<BrowserBackend | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const status = await apiFetch<BrowserStatus>("/api/browser/status");
      setBackend(status.backend);
      setAvailable(status.available);
    } catch {
      setAvailable(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    void apiFetch<{ prefs: { browserBackend?: BrowserBackend } }>("/api/me/prefs")
      .then((data) => setChoice(choiceOf(data.prefs)))
      .catch(() => undefined);
  }, [refresh]);

  const set = useCallback(
    async (next: BrowserBackend): Promise<void> => {
      // The choice is applied at once: the router reads it on the next call, so the very
      // next action lands in the browser the user just picked.
      setChoice(next);
      try {
        await apiFetch("/api/me/prefs", { method: "PUT", body: { browserBackend: next } });
      } finally {
        await refresh();
      }
    },
    [refresh],
  );

  return { backend, available, choice, set, refresh };
}
