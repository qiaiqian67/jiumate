/**
 * Validation for the per-user theme prefs that ride on `PUT /api/me/prefs`.
 *
 * `ui_prefs` is free-form JSON (see `me.ts`), but a hand-crafted PUT must not be able to
 * plant junk in the prefs row. These normalizers are the single source of truth for the
 * `activeTheme` field.
 *
 * A theme id is bounded (length + non-empty) but deliberately NOT resolved against the
 * installed catalog — the same reasoning as `pet-prefs.ts`: the builtin gallery ships in the
 * web bundle and the server never sees it, so an unknown id is still a legal selection. The
 * client resolves it and falls back to the built-in appearance when the id no longer exists
 * (a user theme deleted on another host, or a preset removed from a later release).
 *
 * One field rather than two: a theme carries its palette *and* its artwork, and `appearance` is
 * what decides whether it pins the shell. Light and dark are not separate selections.
 */
import { HttpError } from "../http/errors.js";

/** Longest a theme id may be. Matches the manifest-side limit in `@prismshadow/jiumate-skins`. */
const SKIN_ID_LIMIT = 64;

const SKIN_PREF_KEYS = ["activeTheme"] as const;

/**
 * The two transparency preferences, validated as plain 0..1 numbers.
 *
 * Unlike the theme id these are not opaque to the server: the range is what keeps a mistyped
 * value from producing a colour the token validator would reject on the way back in, and it is
 * small enough to state here rather than shipping the renderer's bounds over the wire.
 */
const SKIN_OPACITY_KEYS = ["skinSurfaceAlpha", "skinBackgroundDim"] as const;

function invalid(message: string): HttpError {
  return new HttpError(400, "invalid_skin_prefs", message);
}

/**
 * Validate every skin field present on the body. Mutates `body` in place with the normalised
 * values (matching the convention `me.ts` already uses for `draftShortcuts` and the pet prefs).
 */
export async function validateSkinPrefs(body: Record<string, unknown>): Promise<void> {
  for (const key of SKIN_PREF_KEYS) {
    const raw = body[key];
    if (raw === undefined) continue;
    if (raw === null) {
      // Explicit clear — the user went back to the built-in appearance.
      continue;
    }
    if (typeof raw !== "string") {
      throw invalid(`${key} must be a string or null`);
    }
    if (raw.length === 0) throw invalid(`${key} must not be empty`);
    if (raw.length > SKIN_ID_LIMIT) {
      throw invalid(`${key} must be at most ${SKIN_ID_LIMIT} characters`);
    }
    // No catalog lookup: builtin presets are invisible to the server (they live in the web
    // bundle) and are just as valid as an installed slug.
  }

  for (const key of SKIN_OPACITY_KEYS) {
    const raw = body[key];
    if (raw === undefined) continue;
    if (raw === null) continue; // explicit clear — back to the built-in default
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      throw invalid(`${key} must be a number between 0 and 1, or null`);
    }
    if (raw < 0 || raw > 1) {
      throw invalid(`${key} must be between 0 and 1`);
    }
    // 0 is legal and meaningful for both (fully see-through surfaces; no scrim at all), so the
    // bound is inclusive on both ends rather than treating a falsy value as "unset".
  }
}
