/**
 * Which browser the agent drives.
 *
 * The choice is the user's, and it is stored per user, because the browser is the user's
 * business: it is where their sign-ins live, and one user's choice must not change what
 * another user's agent sees.
 *
 * - `builtin` — the desktop app's own browser. A `<webview>` in the app's window: the user
 *   sees every page the agent opens and can take a tab over. Needs the desktop shell.
 * - `headless` — a Chromium the server starts for itself, with its own profile. Nothing
 *   opens on the user's screen, and the agent works in a browser of its own. Needs only a
 *   Chromium on the machine.
 * - `chrome` — the user's own Chrome, through an extension. Not implemented yet.
 *
 * The default is `builtin` on the desktop and `headless` everywhere else: a server with no
 * shell has no built-in browser, and a browser is better than none.
 */
import type { BrowserBackend } from "@jiumate/core/interfaces";

/** The backends a user may pick. */
export const BROWSER_BACKENDS: readonly BrowserBackend[] = ["builtin", "headless", "chrome"];

/** The backend a user gets when they have not chosen one. */
export function defaultBackend(hasDesktop: boolean): BrowserBackend {
  // A server with no desktop shell has no built-in browser at all, so the headless one is
  // the only thing it can offer.
  return hasDesktop ? "builtin" : "headless";
}

/** Whether the value is a backend a user may pick. */
export function isBrowserBackend(value: unknown): value is BrowserBackend {
  return typeof value === "string" && (BROWSER_BACKENDS as readonly string[]).includes(value);
}

/**
 * The backend a stored preference names, or the default.
 *
 * A stored value that is no longer a backend (an older build's name, a hand-edited file)
 * falls back to the default rather than failing: the preference is a convenience, and the
 * browser working matters more than which one it is.
 */
export function resolveBackend(stored: unknown, hasDesktop: boolean): BrowserBackend {
  if (isBrowserBackend(stored)) return stored;
  return defaultBackend(hasDesktop);
}
