/**
 * "Open System settings at this page" — a same-document request bus.
 *
 * The floating pet window is a separate window: it has no router and no handle on the
 * settings dialog, so its "switch pet" menu item relays through the chat window. The pet
 * window sends an `open-pet-settings` command over the pet bridge, the chat page turns it
 * into a local publish here, and the sidebar (which owns the dialog and its section state)
 * subscribes.
 *
 * A module-level listener set rather than a DOM `CustomEvent`: both ends are app code, so
 * the section keeps its type instead of being cast out of `Event.detail`.
 */
import type { SettingsSectionKey } from "./settings-sections";

type Listener = (section: SettingsSectionKey) => void;

let listeners: Set<Listener> | null = null;

function getListeners(): Set<Listener> {
  if (listeners === null) listeners = new Set();
  return listeners;
}

/** Ask the app to open System settings on `section`. */
export function openSettings(section: SettingsSectionKey): void {
  for (const listener of getListeners()) {
    try {
      listener(section);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[settings] open listener failed", err);
    }
  }
}

/** Subscribe to open requests. Returns an unsubscribe function. */
export function subscribeOpenSettings(listener: Listener): () => void {
  const set = getListeners();
  set.add(listener);
  return () => {
    set.delete(listener);
  };
}
