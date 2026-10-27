/**
 * The plaza's per-user favourites (`ui_prefs.inspirationFavorites`).
 *
 * **Per account, not per browser**, for the reason `todo-dismissals.ts` states: a star says what
 * one person has picked out, so `localStorage` would be wrong in both directions — a shared
 * workstation would star cases for a colleague who never opened them, and the same user on a second
 * device would lose the list they built. The favourites therefore live in `ui_prefs`, alongside the
 * draft shortcuts and the badge dismissals, and reloading any tab picks up what another one starred.
 *
 * **A star is a selection, not a reference.** The stored list is bounded and validated on the
 * server (`services/inspiration-favorites.ts`) but never resolved against the catalog: a case
 * deleted on another host simply stops matching anything, which is why starring works offline and
 * why the list is safe to hold across a reload that has not seen the catalog yet.
 *
 * **Writes are optimistic and whole-list.** The star flips in this tab first and the write is
 * fire-and-forget, the same direction `dismissTodo` takes: a lost write costs persistence, not the
 * click the user just made. The whole array goes every time because `PUT /me/prefs` merges only at
 * the top level — sending a delta would drop the rest.
 */
import { useEffect } from "react";
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand/react";
import * as api from "../../api/endpoints";
import { INSPIRATION_ID_LIMIT, isInspirationSlug } from "@jadelau/inspirations/schema";

/** The `ui_prefs` key the list is stored under. */
export const FAVORITES_PREFS_KEY = "inspirationFavorites";

/**
 * Most cases one user may star, mirroring the server's cap.
 *
 * Duplicated on purpose, like the draft-shortcut caps: the server is what enforces it (a bound that
 * lives only in this module is not a bound), and the number here drives the point at which the
 * toggle stops adding. `test/inspiration-favorites.test.ts` fails if the two copies drift.
 */
export const FAVORITE_MAX = 256;

/**
 * Reads the stored list back into ids the UI can match.
 *
 * The server validates what it accepts, so in practice this receives what it wrote — but the
 * column is free-form JSON shared with every other preference, and a value that has been through a
 * hand-edited database or a future cap change must still render rather than throw. Unusable entries
 * are dropped, duplicates collapse, and the cap is applied on the way in.
 */
export function normalizeFavorites(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (out.length >= FAVORITE_MAX) break;
    if (typeof entry !== "string") continue;
    const id = entry.trim();
    if (id.length > INSPIRATION_ID_LIMIT || !isInspirationSlug(id)) continue;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * The list after toggling one id (pure; the caller persists it).
 *
 * A new star is appended rather than sorted, because the order is the user's own — the "Favourites"
 * tab reads it back in exactly this order (see `visibleCases`).
 */
export function toggledFavorites(list: readonly string[], id: string): string[] {
  if (list.includes(id)) return list.filter((one) => one !== id);
  if (list.length >= FAVORITE_MAX) return [...list];
  return [...list, id];
}

// —— Module-level store: one read per browser session, every subscriber re-renders on change ——

/** `null` until the stored list arrives; nothing reads as starred while it is. */
const store = createStore<{ favorites: string[] | null }>(() => ({ favorites: null }));

let hydrating = false;

function hydrate(): void {
  if (hydrating || store.getState().favorites !== null) return;
  hydrating = true;
  void api
    .getPrefs()
    .then(({ prefs }) => {
      store.setState({ favorites: normalizeFavorites(prefs[FAVORITES_PREFS_KEY]) });
    })
    .catch(() => {
      // Left unhydrated on purpose so a later mount retries: writing an empty list here would
      // both unstar everything on screen and let the next toggle overwrite the stored list.
      hydrating = false;
    });
}

/** The starred ids, or null while they are unknown. */
export function useInspirationFavorites(): string[] | null {
  useEffect(() => {
    hydrate();
  }, []);
  return useStore(store, (state) => state.favorites);
}

/** Whether one case is starred. False while the list is unknown — the star fills in when it lands. */
export function useIsFavorite(id: string): boolean {
  const favorites = useInspirationFavorites();
  return favorites?.includes(id) ?? false;
}

/** Flip one case's star and persist the whole list (best-effort). */
export function toggleFavorite(id: string): void {
  const { favorites } = store.getState();
  // Nothing read means nothing to write: persisting now would store a list missing every star this
  // session never saw.
  if (favorites === null) return;
  const next = toggledFavorites(favorites, id);
  store.setState({ favorites: next });
  void api.putPrefs({ [FAVORITES_PREFS_KEY]: next }).catch(() => undefined);
}
