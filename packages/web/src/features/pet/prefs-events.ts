/**
 * "The server changed this user's prefs" — a same-document request bus.
 *
 * The `pet` tool changes the pet prefs server-side (acting on the local admin's row), and
 * the browser has no way to notice: it fetched prefs once at mount. The server announces it
 * on the user event stream, but that stream has exactly one subscriber by design (the
 * sessions store owns the single `EventSource`), so the announcement is fanned out from
 * there through this bus instead of opening a second connection.
 *
 * A module-level listener set rather than a DOM `CustomEvent`, matching `open-settings.ts`.
 */
type Listener = () => void;

let listeners: Set<Listener> | null = null;

function getListeners(): Set<Listener> {
  if (listeners === null) listeners = new Set();
  return listeners;
}

/** Announce that the user's prefs changed elsewhere; subscribers should re-read them. */
export function emitPrefsChanged(): void {
  for (const listener of getListeners()) {
    try {
      listener();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[prefs] listener failed", err);
    }
  }
}

/** Subscribe to prefs-change announcements. Returns an unsubscribe function. */
export function subscribePrefsChanged(listener: Listener): () => void {
  const set = getListeners();
  set.add(listener);
  return () => {
    set.delete(listener);
  };
}
