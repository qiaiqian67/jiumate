/**
 * Bounds, schema version and the filename/extension rules for the inspiration library.
 *
 * A case is a directory under `<root>/inspirations/cases/<id>/`, holding one `case.json` plus
 * the two optional assets the case may carry: a cover image and a preview document. That is the
 * same shape the pet and skin catalogs use, and for the same reason — a case is content the
 * user (an admin, here) authors, and content belongs next to the other state the user shares
 * between the web, server and CLI rather than in SQLite, which this repo reserves for indexes
 * and aggregates.
 *
 * Categories are files too, but one per file rather than a single list: `<root>/inspirations/
 * categories/<id>.json`. A list in one file would make every reorder a rewrite of the whole set,
 * and the catalog is small enough that per-file reads cost nothing.
 */

/** The `schema` discriminator every case manifest carries. */
export const INSPIRATION_SCHEMA = "linsight.inspiration";

/** Schema version written into `case.json`. Bump when the on-disk shape changes incompatibly. */
export const INSPIRATION_SCHEMA_VERSION = 1;

/** The manifest's filename inside a case directory. */
export const CASE_MANIFEST_FILENAME = "case.json";

/** The fixed filename a case's preview document takes inside its directory. */
export const PREVIEW_FILENAME = "preview.html";

/** Manifest-side guard: one `case.json` must not exceed this many bytes (256 KiB). */
export const MANIFEST_LIMIT = 256 * 1024;

/** Cover-image guard: 8 MiB, the same order as an uploaded avatar and well under the API's body cap. */
export const COVER_LIMIT = 8 * 1024 * 1024;

/**
 * Preview-document guard: 1 MiB.
 *
 * A preview is a self-contained HTML page rendered in a sandboxed iframe, so it has to carry its
 * own styles and scripts inline — which is exactly why it needs a ceiling of its own rather than
 * riding the manifest's.
 */
export const PREVIEW_LIMIT = 1024 * 1024;

/** Hard cap on cases under one catalog. */
export const MAX_CASES = 512;

/** Hard cap on admin-defined categories. */
export const MAX_CATEGORIES = 64;

/** Longest a case or category id may be. The id is also the directory / file name. */
export const INSPIRATION_ID_LIMIT = 64;

/** Ids: ASCII lowercase, digits, dash, underscore; must start with a letter or digit. */
export const INSPIRATION_SLUG_REGEX = /^[a-z0-9][a-z0-9_-]*$/;

/** Longest a title may be, per language. */
export const TITLE_LIMIT = 120;

/** Longest a description may be, per language. */
export const DESCRIPTION_LIMIT = 600;

/**
 * Longest a prompt may be, per language.
 *
 * Far above the built-in examples (the longest is around 2 000 characters) because a case may
 * legitimately carry a full brief; bounded at all because the prompt is the one field an admin
 * can paste arbitrary text into, and every list request ships it.
 */
export const PROMPT_LIMIT = 20000;

/** Most skills one case may preselect. */
export const MAX_SKILLS = 16;

/** Most tools one case may name. */
export const MAX_TOOLS = 16;

/** Longest a referenced skill / tool / agent name may be. */
export const REF_NAME_LIMIT = 80;

/** Longest a glyph cover may be. Generous for an emoji with a variation selector. */
export const GLYPH_LIMIT = 8;

/** Longest a category's display name may be, per language. */
export const CATEGORY_NAME_LIMIT = 40;

/** The five things a case can be *about*, which is what its card badge says. */
export const CASE_KINDS = ["app", "agent", "skill", "tool", "prompt"] as const;

/** How a case draws itself when it has no cover image. */
export const COVER_KINDS = ["glyph", "image"] as const;

/**
 * Image extensions a cover may use, with the MIME each one implies.
 *
 * The extension is validated rather than the whole filename, and a cover name is required to be
 * a single path segment — which is also what makes the asset route safe to expose, since a name
 * with no separator in it cannot climb anywhere. SVG is included: the built-in glyph covers are
 * characters, but an admin's own artwork is as likely to be vector as raster.
 */
export const IMAGE_EXTENSIONS: ReadonlyMap<string, string> = new Map<string, string>([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
  [".svg", "image/svg+xml"],
]);

/** Longest a cover filename may be. */
export const ASSET_FILENAME_LIMIT = 128;
