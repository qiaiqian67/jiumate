/**
 * Validation for the per-user pet prefs that ride on `PUT /api/me/prefs`.
 *
 * `ui_prefs` is free-form JSON (see `me.ts`), but a hand-crafted PUT must
 * not be able to plant junk in the prefs row. These normalizers are the
 * single source of truth for the `enablePet`, `activePetId`,
 * `petWindowPosition` and `petWindowScale` fields.
 *
 * The active pet id is bounded (length + non-empty) but deliberately NOT
 * resolved against the installed catalog: the builtin presets ship in the
 * web bundle and the server never sees them, so an unknown id is still a
 * legal selection. The client resolves it and falls back to its own default
 * when the id no longer exists (e.g. a user pet deleted on another host).
 */
import { HttpError } from "../http/errors.js";

const PET_POSITION_LIMIT = 32767;
const PET_POSITION_MIN = -32768;
const PET_SCALE_MIN = 0.5;
const PET_SCALE_MAX = 2;

function invalid(message: string): HttpError {
  return new HttpError(400, "invalid_pet_prefs", message);
}

/**
 * Validate every pet field present on the body. Mutates `body` in place
 * with the normalised values (matching the convention `me.ts` already uses
 * for `draftShortcuts` and the legacy companion prefs).
 */
export async function validatePetPrefs(body: Record<string, unknown>): Promise<void> {
  if (body["enablePet"] !== undefined) {
    if (typeof body["enablePet"] !== "boolean") {
      throw invalid("enablePet must be a boolean");
    }
  }
  if (body["activePetId"] !== undefined) {
    const raw = body["activePetId"];
    if (raw === null) {
      // Explicit clear — the picker has not chosen a pet yet.
    } else if (typeof raw === "string") {
      if (raw.length === 0) throw invalid("activePetId must not be empty");
      if (raw.length > 64) throw invalid("activePetId must be at most 64 characters");
      // No catalog lookup: builtin presets are invisible to the server (they
      // live in the web bundle) and are just as valid as an installed slug.
    } else {
      throw invalid("activePetId must be a string or null");
    }
  }
  if (body["petWindowPosition"] !== undefined) {
    const raw = body["petWindowPosition"];
    if (raw === null) {
      // Explicit clear.
    } else if (typeof raw === "object" && raw !== null) {
      const obj = raw as Record<string, unknown>;
      const x = obj["x"];
      const y = obj["y"];
      if (typeof x !== "number" || typeof y !== "number") {
        throw invalid("petWindowPosition.{x,y} must be numbers");
      }
      if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        x > PET_POSITION_LIMIT ||
        x < PET_POSITION_MIN ||
        y > PET_POSITION_LIMIT ||
        y < PET_POSITION_MIN
      ) {
        throw invalid(
          `petWindowPosition out of range (${PET_POSITION_MIN}..${PET_POSITION_LIMIT})`,
        );
      }
      body["petWindowPosition"] = { x: Math.round(x), y: Math.round(y) };
    } else {
      throw invalid("petWindowPosition must be an object or null");
    }
  }
  if (body["petWindowScale"] !== undefined) {
    const raw = body["petWindowScale"];
    if (raw === null) {
      // Explicit clear — the client falls back to its default size.
    } else if (typeof raw !== "number" || !Number.isFinite(raw)) {
      throw invalid("petWindowScale must be a number or null");
    } else if (raw < PET_SCALE_MIN || raw > PET_SCALE_MAX) {
      throw invalid(`petWindowScale out of range (${PET_SCALE_MIN}..${PET_SCALE_MAX})`);
    } else {
      body["petWindowScale"] = Math.round(raw * 100) / 100;
    }
  }
}
