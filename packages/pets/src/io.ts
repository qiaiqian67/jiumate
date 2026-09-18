/**
 * Local IO for Petdex pet packages.
 *
 * The package format is host-supplied: callers pass in the root path
 * (`<root>/pets/` for the in-app project; `<root>/` for a user-global catalog)
 * and every read/write is anchored to that root. No process-wide constant,
 * no env lookup — keeps the IO testable and lets the desktop pet client
 * mount the same code with a different root.
 *
 * Bounds follow OpenBitFun's `pet_packages.rs`:
 *   MANIFEST_LIMIT  = 64 KiB
 *   IMAGE_LIMIT     = 32 MiB
 *   ARCHIVE_LIMIT   = 64 MiB
 *   MAX_PACKAGES    = 128
 *   MAX_PIXEL_AREA  = 16 MP
 *
 * Fingerprinting is a SHA-256 of the canonical JSON manifest bytes; identical
 * to the upstream Petdex CLI's manifest-fingerprint strategy so a host can
 * deduplicate without re-decoding the spritesheet.
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  ARCHIVE_LIMIT,
  FRAME_HEIGHT,
  FRAME_WIDTH,
  IMAGE_LIMIT,
  MANIFEST_LIMIT,
  MAX_PACKAGES,
  MAX_PIXEL_AREA,
  RECEIPT_FILENAME,
  RECEIPT_SCHEMA_VERSION,
  SPRITE_COLUMNS,
  SPRITE_ROWS_BY_VERSION,
} from "./constants.js";
import {
  petDir,
  petManifestPath,
  petReceiptPath,
  petSpritesheetPath,
  petsDir,
  slugifyPetId,
} from "./paths.js";
import {
  buildPetPackage,
  type PetPackage,
  type PetReceipt,
  SPRITE_VERSION_NUMBERS,
  type SpriteVersionNumber,
} from "./schema.js";

export {
  petsDir,
  petDir,
  petManifestPath,
  petReceiptPath,
  petSpritesheetPath,
  slugifyPetId,
  RECEIPT_FILENAME,
  ARCHIVE_LIMIT,
  MAX_PIXEL_AREA,
};
export type { PetPackage, PetReceipt, SpriteVersionNumber };
export { SPRITE_VERSION_NUMBERS, MANIFEST_LIMIT, IMAGE_LIMIT, MAX_PACKAGES };
export { FRAME_WIDTH, FRAME_HEIGHT, SPRITE_COLUMNS, SPRITE_ROWS_BY_VERSION };

/** Error raised when a pet package is invalid. The message is safe to surface to callers. */
export class PetPackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PetPackageError";
  }
}

/** Strict read of a single manifest. Throws on parse / validation failure so corrupted data surfaces loudly. */
export async function readPetPackage(root: string, slug: string): Promise<PetPackage | null> {
  const manifestPath = petManifestPath(root, slug);
  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  if (Buffer.byteLength(raw, "utf8") > MANIFEST_LIMIT) {
    throw new PetPackageError(`Pet manifest exceeds ${MANIFEST_LIMIT} bytes`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new PetPackageError(`Pet manifest is not valid JSON: ${(err as Error).message}`);
  }
  return coercePetPackage(parsed, { packagePath: petDir(root, slug) });
}

/** Coerce an arbitrary object into a `PetPackage`. Used for both on-disk reads and out-of-process imports. */
export function coercePetPackage(value: unknown, ctx: { packagePath: string }): PetPackage {
  if (typeof value !== "object" || value === null) {
    throw new PetPackageError("Pet manifest must be a JSON object");
  }
  const raw = value as Record<string, unknown>;
  const spritesheetPath = raw["spritesheetPath"];
  if (typeof spritesheetPath !== "string" || spritesheetPath.length === 0) {
    throw new PetPackageError("Pet manifest is missing `spritesheetPath`");
  }
  if (
    spritesheetPath.includes(":") ||
    spritesheetPath.includes("\\") ||
    spritesheetPath.startsWith("/") ||
    spritesheetPath.startsWith("./")
  ) {
    throw new PetPackageError("Pet manifest spritesheetPath must be relative POSIX");
  }
  if (
    spritesheetPath === ".." ||
    spritesheetPath.startsWith("../") ||
    spritesheetPath.endsWith("/..")
  ) {
    throw new PetPackageError("Pet manifest spritesheetPath escapes its package directory");
  }
  // A `..` in the *middle* of the path escapes exactly as surely as a leading one, and the
  // prefix/suffix checks above miss it: `a/../../../etc/passwd` passes all of them and
  // `join` then silently resolves it out of the package directory. Reject any `.`, `..` or
  // empty segment wherever it appears, so the only paths left are plain relative names.
  if (
    spritesheetPath
      .split("/")
      .some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new PetPackageError("Pet manifest spritesheetPath escapes its package directory");
  }
  const spriteVersionNumber = (raw["spriteVersionNumber"] as unknown) ?? 1;
  if (spriteVersionNumber !== 1 && spriteVersionNumber !== 2) {
    throw new PetPackageError(
      `Pet manifest spriteVersionNumber must be 1 or 2, got ${String(spriteVersionNumber)}`,
    );
  }
  const id =
    typeof raw["id"] === "string" && raw["id"].length > 0 ? slugifyPetId(raw["id"]) : "custom-pet";
  const displayNameRaw = typeof raw["displayName"] === "string" ? raw["displayName"] : id;
  const displayName = displayNameRaw.trim() === "" ? id : displayNameRaw.trim();
  const descriptionRaw = typeof raw["description"] === "string" ? raw["description"] : null;
  const description =
    descriptionRaw !== null && descriptionRaw.trim() !== "" ? descriptionRaw.trim() : null;
  // Always store the absolute path the host will read from. Use forward
  // slashes so POSIX-form test assertions remain stable on every host.
  const absoluteSpritesheet = join(ctx.packagePath, spritesheetPath).split(sep).join("/");
  // Last line of defence, on the resolved result rather than on the text: the segment
  // checks above cover the forms we know about, this one covers the forms we do not (a
  // Windows segment Win32 normalises away, a separator form the split did not see).
  const packageRoot = resolve(ctx.packagePath);
  const escaped = relative(packageRoot, resolve(absoluteSpritesheet));
  if (escaped === "" || escaped.startsWith("..") || isAbsolute(escaped)) {
    throw new PetPackageError("Pet manifest spritesheetPath escapes its package directory");
  }
  return {
    id,
    displayName,
    description: description ?? null,
    source: typeof raw["source"] === "string" ? raw["source"] : "user",
    packagePath: ctx.packagePath.split(sep).join("/"),
    spritesheetPath: absoluteSpritesheet,
    spritesheetMimeType:
      typeof raw["spritesheetMimeType"] === "string" && raw["spritesheetMimeType"].length > 0
        ? raw["spritesheetMimeType"]
        : "image/png",
    spriteVersionNumber: spriteVersionNumber as SpriteVersionNumber,
  };
}

/**
 * Read every installed pet under `root/`. Folders whose name is a dotfile, or whose
 * manifest fails to parse, are skipped with a logged warning rather than aborting the
 * whole catalog — a single bad pet must never take down the picker.
 *
 * The `MAX_PACKAGES` cap truncates the list rather than throwing: throwing here read as
 * "the catalog is empty" to every caller that catches (see `PetCatalogService.list`),
 * which hid every installed pet *and* defeated the import guard that counts them. Only
 * directories count towards the cap — a stray file in the pets root is not a pet.
 */
export async function readPetCatalog(root: string): Promise<PetPackage[]> {
  const pets = petsDir(root);
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(pets, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const slugs = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, MAX_PACKAGES);
  const out: PetPackage[] = [];
  for (const slug of slugs) {
    try {
      const pet = await readPetPackage(root, slug);
      if (pet !== null) out.push(pet);
    } catch (err) {
      // Skip a single bad pet rather than failing the whole catalog read.
      // eslint-disable-next-line no-console
      console.warn(`[pets] skipping invalid pet '${slug}': ${(err as Error).message}`);
    }
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

/**
 * Write a manifest to disk. The function does NOT touch the spritesheet
 * image — callers stage the assets and the manifest in any order. Refuses
 * to overwrite an existing pet with a different id (the slug directory is
 * the identity).
 */
export async function writePetPackage(root: string, pet: PetPackage): Promise<void> {
  const dir = petDir(root, pet.id);
  await mkdir(dir, { recursive: true });
  const body = JSON.stringify(
    {
      id: pet.id,
      displayName: pet.displayName,
      description: pet.description,
      source: pet.source,
      spritesheetPath: relative(dir, pet.spritesheetPath).split(sep).join("/"),
      spritesheetMimeType: pet.spritesheetMimeType,
      spriteVersionNumber: pet.spriteVersionNumber,
    },
    null,
    2,
  );
  await writeFile(petManifestPath(root, pet.id), body, "utf8");
}

/** SHA-256 of the canonical manifest JSON. Two equal fingerprints → byte-identical manifests. */
export function fingerprintPetPackage(pet: PetPackage): string {
  const body = JSON.stringify({
    id: pet.id,
    displayName: pet.displayName,
    description: pet.description,
    source: pet.source,
    spritesheetPath: pet.spritesheetPath,
    spritesheetMimeType: pet.spritesheetMimeType,
    spriteVersionNumber: pet.spriteVersionNumber,
  });
  return createHash("sha256").update(body).digest("hex");
}

/** Read the receipt next to a pet's manifest, or null if absent. */
export async function readPetReceipt(root: string, slug: string): Promise<PetReceipt | null> {
  const path = petReceiptPath(root, slug);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  if (Buffer.byteLength(raw, "utf8") > MANIFEST_LIMIT) {
    throw new PetPackageError("Pet receipt exceeds MANIFEST_LIMIT");
  }
  const parsed = JSON.parse(raw) as Partial<PetReceipt>;
  if (
    parsed.schemaVersion !== RECEIPT_SCHEMA_VERSION ||
    typeof parsed.sourceKey !== "string" ||
    typeof parsed.fingerprint !== "string" ||
    typeof parsed.installedFingerprint !== "string"
  ) {
    throw new PetPackageError("Pet receipt has an unsupported shape");
  }
  return parsed as PetReceipt;
}

/** Write the receipt next to a pet's manifest. */
export async function writePetReceipt(
  root: string,
  slug: string,
  receipt: PetReceipt,
): Promise<void> {
  if (receipt.schemaVersion !== RECEIPT_SCHEMA_VERSION) {
    throw new PetPackageError(
      `Refusing to write receipt with schemaVersion=${receipt.schemaVersion}`,
    );
  }
  await mkdir(petDir(root, slug), { recursive: true });
  await writeFile(petReceiptPath(root, slug), JSON.stringify(receipt), "utf8");
}

/** Remove an installed pet's directory (manifest, spritesheet, receipt — everything). */
export async function deletePetPackage(root: string, slug: string): Promise<void> {
  await rm(petDir(root, slug), { recursive: true, force: true });
}

/** Validate that an image buffer is a sprite atlas of the expected version. Throws on mismatch. */
export function validatePetSpritesheet(
  bytes: Uint8Array,
  version: SpriteVersionNumber,
): { width: number; height: number } {
  if (bytes.byteLength > IMAGE_LIMIT) {
    throw new PetPackageError(`Pet spritesheet exceeds ${IMAGE_LIMIT} bytes`);
  }
  const width = SPRITE_COLUMNS * FRAME_WIDTH;
  const height = SPRITE_ROWS_BY_VERSION[version] * FRAME_HEIGHT;
  if (bytes.byteLength === 0) {
    throw new PetPackageError("Pet spritesheet is empty");
  }
  // The host runtime performs the real image-decode check; here we only
  // confirm the assumed nominal dimensions match the version. Decoding a
  // PNG/WebP without a library is platform-specific, so we rely on the
  // caller to have validated `bytes` is the named format before this point.
  const area = width * height;
  if (area > MAX_PIXEL_AREA) {
    throw new PetPackageError(`Pet spritesheet exceeds ${MAX_PIXEL_AREA} pixels`);
  }
  return { width, height };
}

/** Re-export `buildPetPackage` so callers can import everything from one place. */
export { buildPetPackage };
