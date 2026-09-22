/**
 * Pure path helpers for Linsight skin packages. Every IO call takes the skins root as an
 * argument so a host can swap between a workspace-scoped root and a user-global root (see
 * packages/server/src/services/skin-catalog.ts).
 */
import { RECEIPT_FILENAME } from "./constants.js";

/** Resolve the skins directory for a given root. */
export function skinsDir(root: string): string {
  return `${root.replace(/[\\/]+$/, "")}/skins`;
}

/** Resolve a single skin's directory. */
export function skinDir(root: string, slug: string): string {
  return `${skinsDir(root)}/${slug}`;
}

/** Resolve the manifest path inside a skin's directory. */
export function skinManifestPath(root: string, slug: string): string {
  return `${skinDir(root, slug)}/skin.json`;
}

/** Resolve an asset path inside a skin's directory. */
export function skinAssetPath(root: string, slug: string, filename: string): string {
  return `${skinDir(root, slug)}/${filename}`;
}

/** Resolve the receipt path next to a skin's manifest. */
export function skinReceiptPath(root: string, slug: string): string {
  return `${skinDir(root, slug)}/${RECEIPT_FILENAME}`;
}

/**
 * Normalise an `id` field from a manifest into a slug.
 *
 * Same rule as `slugifyPetId`, and for the same reason: the slug is the directory name, so
 * the manifest id and the directory must agree or the catalog lists one thing and the asset
 * route serves another. Dots are folded to dashes rather than preserved — both OpenBitFun
 * and Codex-Dream-Skin allow `a.b` as a theme id, but a dotted directory name is one more
 * shape to reason about on Windows, and nothing downstream needs the distinction.
 */
export function slugifySkinId(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return "custom-skin";
  const lowered = raw
    .toLowerCase()
    .split("")
    .map((c) =>
      (c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c === "-" || c === "_" ? c : "-",
    )
    .join("");
  const trimmed = lowered.replace(/^-+|-+$/g, "");
  return trimmed.length > 0 ? trimmed : "custom-skin";
}
