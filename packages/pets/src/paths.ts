/**
 * Pure path helpers for Petdex pet packages. Every IO call takes the pets root as
 * an argument so a host can swap between a workspace-scoped root and a user-
 * global root (see packages/server/src/services/pet-catalog.ts).
 */
import { RECEIPT_FILENAME } from "./constants.js";

/** Resolve the pets directory for a given root. */
export function petsDir(root: string): string {
  return `${root.replace(/[\\/]+$/, "")}/pets`;
}

/** Resolve a single pet's directory. */
export function petDir(root: string, slug: string): string {
  return `${petsDir(root)}/${slug}`;
}

/** Resolve the manifest path inside a pet's directory. */
export function petManifestPath(root: string, slug: string): string {
  return `${petDir(root, slug)}/pet.json`;
}

/** Resolve the spritesheet path inside a pet's directory. */
export function petSpritesheetPath(root: string, slug: string, filename: string): string {
  return `${petDir(root, slug)}/${filename}`;
}

/** Resolve the receipt path next to a pet's manifest. */
export function petReceiptPath(root: string, slug: string): string {
  return `${petDir(root, slug)}/${RECEIPT_FILENAME}`;
}

/** True when the candidate is a plausible pet slug: ASCII letters, digits, dash, underscore. */
export const PET_SLUG_REGEX = /^[a-z0-9_-]+$/;

/**
 * Normalise an `id` field from a manifest into a slug. Mirrors the Rust
 * `metadata` helper: non-alphanumeric characters become `-`, then trim
 * trailing dashes, falling back to "custom-pet" when the result is empty.
 */
export function slugifyPetId(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return "custom-pet";
  const lowered = raw
    .toLowerCase()
    .split("")
    .map((c) =>
      (c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c === "-" || c === "_" ? c : "-",
    )
    .join("");
  const trimmed = lowered.replace(/^-+|-+$/g, "");
  return trimmed.length > 0 ? trimmed : "custom-pet";
}
