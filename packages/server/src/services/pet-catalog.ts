/**
 * Pet catalog: list / import / delete Petdex pet packages on the host.
 *
 * Mirrors OpenBitFun's `services-core/src/pet_packages.rs`. The package
 * format itself lives in `@prismshadow/linsight-pets`; this service adds the
 * host-side concerns: anchoring the catalog under the data root, hashing
 * source paths for receipts, surfacing diagnostic strings for the picker.
 *
 * The catalog is a directory of folders, one per installed pet:
 *   <root>/pets/<slug>/pet.json
 *   <root>/pets/<slug>/<spritesheet-filename>
 *   <root>/pets/<slug>/.linsight-pet-receipt.json   (after an import)
 *
 * Builtin presets live in the web app's public assets (separate from the user
 * catalog) and are surfaced through the picker via a separate `presets`
 * directory the routes module can fill from a static import.
 */
import { createHash } from "node:crypto";
import {
  ARCHIVE_LIMIT,
  IMAGE_LIMIT,
  MANIFEST_LIMIT,
  MAX_PACKAGES,
  PetPackageError,
  buildPetPackage,
  coercePetPackage,
  deletePetPackage,
  fingerprintPetPackage,
  petDir,
  petsDir,
  readPetCatalog,
  readPetPackage,
  readPetReceipt,
  slugifyPetId,
  validatePetSpritesheet,
  writePetPackage,
  writePetReceipt,
  type PetPackage,
  type PetReceipt,
  type SpriteVersionNumber,
} from "@prismshadow/linsight-pets";

/** Maximum number of builtin presets the picker renders (a safety cap; mirrors `MAX_PACKAGES`). */
export const MAX_BUILTIN_PRESETS = MAX_PACKAGES;

/** Diagnostic codes — stable strings the picker can render without surprises. */
export type PetDiagnostic = string;

export interface PetCatalogSnapshot {
  /** Pets installed under the data root, sorted by id. */
  pets: PetPackage[];
  /** Non-fatal warnings collected while reading the catalog. */
  diagnostics: PetDiagnostic[];
}

export class PetCatalogService {
  constructor(private readonly root: string) {}

  /** Read every installed pet plus any non-fatal diagnostics. */
  async list(): Promise<PetCatalogSnapshot> {
    const diagnostics: PetDiagnostic[] = [];
    let pets: PetPackage[];
    try {
      pets = await readPetCatalog(this.root);
    } catch (err) {
      diagnostics.push(`Could not inspect installed pets: ${(err as Error).message}`);
      return { pets: [], diagnostics };
    }
    return { pets, diagnostics };
  }

  /** Resolve a single pet by id. Returns null when not installed. */
  async get(petId: string): Promise<PetPackage | null> {
    if (!isValidSlug(petId)) return null;
    return readPetPackage(this.root, petId);
  }

  /** Stable hash of an import source's absolute path (Windows: case-insensitive). */
  sourceKey(sourcePath: string): string {
    const normalised = process.platform === "win32" ? sourcePath.toLowerCase() : sourcePath;
    return createHash("sha256").update(normalised).digest("hex");
  }

  /**
   * Import a Petdex package from a local directory or .zip archive.
   *
   * `expectedFingerprint` (when supplied) must match the source's fingerprint or
   * the import is refused. Mirrors OpenBitFun's `publish` helper: idempotent
   * re-imports return the same pet directory without rewriting a modified user
   * copy.
   */
  async importPackage(sourcePath: string, expectedFingerprint?: string): Promise<PetPackage> {
    let loaded: LoadedImport;
    try {
      loaded = await this.loadSource(sourcePath);
    } catch (err) {
      if (err instanceof PetPackageError) throw err;
      throw new PetPackageError(`Could not read pet source: ${(err as Error).message}`);
    }
    return this.publish(loaded, this.sourceKey(sourcePath), expectedFingerprint);
  }

  /**
   * Import a package that exists only as bytes — a pet read out of another app's
   * archive (see `pet-external.ts`) rather than a folder on disk.
   *
   * Shares the fingerprint and publish path with the folder import, so a
   * candidate the external catalog listed and this import cannot disagree about
   * whether the source changed in between.
   */
  async importBytes(input: {
    sourceKey: string;
    manifestBytes: Uint8Array;
    imageBytes: Uint8Array;
    expectedFingerprint?: string | undefined;
  }): Promise<PetPackage> {
    let loaded: LoadedImport;
    try {
      loaded = this.assemble(input.manifestBytes, input.imageBytes, "");
    } catch (err) {
      if (err instanceof PetPackageError) throw err;
      throw new PetPackageError(`Could not read pet source: ${(err as Error).message}`);
    }
    return this.publish(loaded, input.sourceKey, input.expectedFingerprint);
  }

  /** Delete an installed pet by id. Refuses to remove the active pet (caller's job to pick a fallback first). */
  async deletePackage(petId: string): Promise<void> {
    if (!isValidSlug(petId)) throw new PetPackageError("Invalid pet id");
    await deletePetPackage(this.root, petId);
  }

  /** Pets directory rooted at the configured data root. */
  dir(): string {
    return petsDir(this.root);
  }

  /**
   * Installed pets keyed by the `sourceKey` of the receipt they were imported
   * under. Lets an external source recognise its own earlier import without
   * knowing how the catalog is laid out on disk.
   */
  async importedBySource(): Promise<Map<string, { pet: PetPackage; receipt: PetReceipt }>> {
    const out = new Map<string, { pet: PetPackage; receipt: PetReceipt }>();
    const { pets } = await this.list();
    for (const pet of pets) {
      const receipt = await readPetReceipt(this.root, pet.id);
      if (receipt !== null) out.set(receipt.sourceKey, { pet, receipt });
    }
    return out;
  }

  /** Single pet directory. */
  petDirFor(slug: string): string {
    return petDir(this.root, slug);
  }

  // ---- internals ----

  private async ensureRoom(): Promise<void> {
    const { pets } = await this.list();
    if (pets.length >= MAX_PACKAGES) {
      throw new PetPackageError("Pet package limit reached");
    }
  }

  /**
   * The shared tail of both imports: honour the fingerprint the reviewer saw,
   * return an existing install when the receipt already matches, otherwise stage
   * the bytes and write manifest + receipt. Mirrors OpenBitFun's `publish`.
   */
  private async publish(
    loaded: LoadedImport,
    sourceKey: string,
    expectedFingerprint?: string,
  ): Promise<PetPackage> {
    if (expectedFingerprint !== undefined && expectedFingerprint !== loaded.fingerprint) {
      throw new PetPackageError("Pet source changed; refresh and review again");
    }
    // Idempotency: if a receipt matches, return the existing install.
    const existing = await this.findByReceipt(sourceKey, loaded.fingerprint);
    if (existing !== null) return existing;
    await this.ensureRoom();
    const slug = slugifyPetId(loaded.manifest.id);
    const staged = await this.stage(slug, loaded);
    try {
      await writePetPackage(this.root, staged.manifest);
    } catch (err) {
      throw new PetPackageError(`Could not stage pet: ${(err as Error).message}`);
    }
    const onDisk = await readPetPackage(this.root, slug);
    if (onDisk === null) {
      throw new PetPackageError("Pet staging file disappeared after import");
    }
    try {
      // The receipt records what is actually on disk, not the in-memory record.
      // `fingerprintPetPackage` covers `spritesheetPath`, and a re-read package
      // resolves it canonically (forward slashes, package-relative in the file) —
      // so fingerprinting the staged record instead made every fresh install look
      // edited to the next reader that compared the two.
      const receipt: PetReceipt = {
        schemaVersion: 1,
        sourceKey,
        fingerprint: loaded.fingerprint,
        installedFingerprint: fingerprintPetPackage(onDisk),
      };
      await writePetReceipt(this.root, slug, receipt);
    } catch (err) {
      throw new PetPackageError(`Could not stage pet: ${(err as Error).message}`);
    }
    return onDisk;
  }

  private async findByReceipt(sourceKey: string, fingerprint: string): Promise<PetPackage | null> {
    const imported = await this.importedBySource();
    const match = imported.get(sourceKey);
    return match !== undefined && match.receipt.fingerprint === fingerprint ? match.pet : null;
  }

  /**
   * Read a package from a directory: `<source>/pet.json` plus whatever
   * `spritesheetPath` names inside it. `.zip` archives are the host runtime's
   * job to unpack before calling in — this service only deals with the layout
   * OpenBitFun already publishes.
   */
  private async loadSource(sourcePath: string): Promise<LoadedImport> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const stat = await fs.stat(sourcePath).catch(() => null);
    if (stat === null || !stat.isDirectory()) {
      throw new PetPackageError("Pet source must be a directory containing pet.json");
    }
    const manifestBytes = await fs.readFile(path.join(sourcePath, "pet.json")).catch(() => {
      throw new PetPackageError("Pet source is missing pet.json");
    });
    // The image's location is only known once the manifest is parsed, so the
    // manifest is coerced twice: once to find the image, once in `assemble`.
    const record = coercePetPackage(parseManifestJson(manifestBytes), {
      packagePath: sourcePath,
    });
    const imageBytes = await fs.readFile(record.spritesheetPath).catch(() => {
      throw new PetPackageError("Pet source is missing its spritesheet image");
    });
    return this.assemble(new Uint8Array(manifestBytes), new Uint8Array(imageBytes), sourcePath);
  }

  /**
   * Validate and fingerprint a manifest/image pair already held in memory.
   * `packagePath` only affects the manifest's reported paths — an external
   * source has no directory of its own, so it passes an empty one.
   */
  private assemble(
    manifestBytes: Uint8Array,
    imageBytes: Uint8Array,
    packagePath: string,
  ): LoadedImport {
    if (manifestBytes.byteLength > MANIFEST_LIMIT) {
      throw new PetPackageError(`Pet manifest exceeds ${MANIFEST_LIMIT} bytes`);
    }
    const record = coercePetPackage(parseManifestJson(manifestBytes), { packagePath });
    if (imageBytes.byteLength > IMAGE_LIMIT) {
      throw new PetPackageError(`Pet spritesheet exceeds ${IMAGE_LIMIT} bytes`);
    }
    validatePetSpritesheet(imageBytes, record.spriteVersionNumber);
    return {
      manifest: record,
      fingerprint: importFingerprint(manifestBytes, imageBytes),
      spritesheetBytes: imageBytes,
    };
  }

  private async stage(slug: string, loaded: LoadedImport): Promise<{ manifest: PetPackage }> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const dir = petDir(this.root, slug);
    await fs.mkdir(dir, { recursive: true });
    const spritesheetRelative = `sprite${imageExtensionFor(loaded.manifest.spritesheetMimeType)}`;
    const spritesheetAbs = path.join(dir, spritesheetRelative);
    await fs.writeFile(spritesheetAbs, loaded.spritesheetBytes);
    const staged: PetPackage = {
      ...loaded.manifest,
      packagePath: dir,
      spritesheetPath: spritesheetAbs,
      id: slug,
    };
    return { manifest: staged };
  }
}

interface LoadedImport {
  manifest: PetPackage;
  fingerprint: string;
  spritesheetBytes: Uint8Array;
}

function isValidSlug(id: string): boolean {
  return /^[a-z0-9_-]+$/i.test(id);
}

function parseManifestJson(bytes: Uint8Array): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch (err) {
    throw new PetPackageError(`Pet manifest is not valid JSON: ${(err as Error).message}`);
  }
  return parsed;
}

/**
 * Fingerprint of an import source: SHA-256 over the manifest's byte length, the
 * manifest bytes, then the spritesheet bytes. Length-prefixing stops a different
 * manifest/image split from colliding on one digest.
 *
 * Shared by the folder import and the external (bytes-only) import so both agree
 * on what "the source changed" means — the value the picker reviews is the value
 * the import verifies.
 */
export function importFingerprint(manifestBytes: Uint8Array, imageBytes: Uint8Array): string {
  return createHash("sha256")
    .update(String(manifestBytes.byteLength))
    .update(manifestBytes)
    .update(imageBytes)
    .digest("hex");
}

function imageExtensionFor(mime: string): string {
  if (mime === "image/webp") return ".webp";
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/gif") return ".gif";
  return ".png";
}

// Re-export for tests and route handlers.
export { buildPetPackage };
