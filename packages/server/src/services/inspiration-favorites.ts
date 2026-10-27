/**
 * Bounds on the inspiration library's per-user favourites (`ui_prefs.inspirationFavorites`).
 *
 * The value is a list of case ids, so it is a different risk from `draftShortcuts` — there is no
 * user-authored text here, only names — but it is the same *shape* of risk: `ui_prefs` is one
 * free-form JSON column and every other known key in it holds a flag or a single id. An unbounded
 * array of ids would be unbounded storage, and an id is also a string a client could make
 * arbitrarily long, so both the count and each entry are capped.
 *
 * The ids are bounded but never resolved: a built-in case has no directory, and a favourite is a
 * selection rather than a reference — a case deleted on another host must not make the user's
 * prefs fail to save, it just stops matching anything.
 */
import { INSPIRATION_ID_LIMIT, isInspirationSlug } from "@jadelau/inspirations";
import { HttpError } from "../http/errors.js";

/**
 * Most cases one user may favourite.
 *
 * Above the whole built-in catalog with room to spare, and low enough that the list stays a
 * handful of kilobytes: the gallery reads it whole on every load and matches it against the
 * catalog in memory, so this is a display bound rather than a paging one.
 */
export const INSPIRATION_FAVORITE_MAX = 256;

function invalid(message: string): HttpError {
  return new HttpError(400, "invalid_inspiration_favorites", message);
}

/**
 * Validates an incoming `inspirationFavorites` value and returns the normalized array to store.
 *
 * Normalizing rather than passing the input through is part of the bound: entries are trimmed and
 * de-duplicated, so the stored list holds exactly the ids a lookup can match, and repeating one
 * cannot be used to grow the array. Ids must be well-formed slugs — the same rule a case id
 * obeys, which is what keeps a favourite from being a place to park arbitrary text.
 */
export function validateInspirationFavorites(value: unknown): string[] {
  if (!Array.isArray(value)) throw invalid("inspirationFavorites must be an array.");
  if (value.length > INSPIRATION_FAVORITE_MAX) {
    throw invalid(`inspirationFavorites must hold at most ${INSPIRATION_FAVORITE_MAX} entries.`);
  }
  const out: string[] = [];
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== "string") {
      throw invalid(`inspirationFavorites[${index}] must be a string.`);
    }
    const id = entry.trim();
    if (id.length > INSPIRATION_ID_LIMIT || !isInspirationSlug(id)) {
      throw invalid(`inspirationFavorites[${index}] is not a valid case id.`);
    }
    if (!out.includes(id)) out.push(id);
  }
  return out;
}
