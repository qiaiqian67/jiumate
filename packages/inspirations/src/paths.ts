/**
 * Pure path helpers for the inspiration library.
 *
 * Every IO call takes the library root as an argument so a host can swap it — the same shape the
 * pet and skin catalogs use, and what keeps the IO testable against a temp directory. Forward
 * slashes throughout, so POSIX-form assertions stay stable on Windows.
 */
import { ASSET_FILENAME_LIMIT, CASE_MANIFEST_FILENAME, IMAGE_EXTENSIONS } from "./constants.js";

/** Resolve the inspiration library directory for a given data root. */
export function inspirationsDir(root: string): string {
  return `${trimTrailingSeparators(root)}/inspirations`;
}

/** Resolve the directory holding every case. */
export function casesDir(root: string): string {
  return `${inspirationsDir(root)}/cases`;
}

/** Resolve a single case's directory. */
export function caseDir(root: string, id: string): string {
  return `${casesDir(root)}/${id}`;
}

/** Resolve a case's manifest path. */
export function caseManifestPath(root: string, id: string): string {
  return `${caseDir(root, id)}/${CASE_MANIFEST_FILENAME}`;
}

/**
 * Resolve an asset path inside a case's directory.
 *
 * `filename` must already have passed {@link isAssetFilename}; this helper only joins, and the
 * caller is the one that keeps a separator out of the name.
 */
export function caseAssetPath(root: string, id: string, filename: string): string {
  return `${caseDir(root, id)}/${filename}`;
}

/** Resolve the directory holding admin-defined categories. */
export function categoriesDir(root: string): string {
  return `${inspirationsDir(root)}/categories`;
}

/** Resolve one category's file. One file per category — see constants.ts for why. */
export function categoryPath(root: string, id: string): string {
  return `${categoriesDir(root)}/${id}.json`;
}

function trimTrailingSeparators(root: string): string {
  return root.replace(/[\\/]+$/, "");
}

/**
 * Normalise a raw id into a slug usable as a directory name.
 *
 * Anything outside the allowed alphabet folds to a dash, runs collapse, and the result is
 * trimmed — so an admin typing "My Best Case!" gets `my-best-case` rather than an error. An id
 * that folds to nothing at all becomes `case`, which the caller's uniqueness check then
 * disambiguates.
 */
export function slugifyInspirationId(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return "case";
  const lowered = raw.toLowerCase();
  let out = "";
  for (const ch of lowered) {
    out += /[a-z0-9_-]/.test(ch) ? ch : "-";
  }
  const collapsed = out.replace(/-{2,}/g, "-").replace(/^[-_]+|[-_]+$/g, "");
  return collapsed.length > 0 ? collapsed : "case";
}

/**
 * Whether `name` may be used as an asset filename.
 *
 * A single path segment with a known image extension: no separator (so it cannot climb out of
 * the case directory), no leading dot (so it cannot shadow the manifest), and no Windows-hostile
 * characters. This is the whole of the asset route's path safety, which is why it is a named
 * predicate rather than an inline check.
 */
export function isAssetFilename(name: string): boolean {
  if (name.length === 0 || name.length > ASSET_FILENAME_LIMIT) return false;
  if (name.includes("/") || name.includes("\\")) return false;
  if (name.startsWith(".")) return false;
  if (/[<>:"|?*\u0000-\u001f]/.test(name)) return false;
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return false;
  return IMAGE_EXTENSIONS.has(name.slice(dot).toLowerCase());
}
