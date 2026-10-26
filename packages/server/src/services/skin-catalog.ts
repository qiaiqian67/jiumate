/**
 * Skin catalog: list / import / delete JiuMate skin packages on the host.
 *
 * The package format itself lives in `@jiumate/skins`; this service adds the
 * host-side concerns: anchoring the catalog under the data root, hashing source paths for
 * receipts, and reading the asset bytes a fingerprint has to cover.
 *
 * The catalog is a directory of folders, one per installed skin:
 *   <root>/skins/<slug>/skin.json
 *   <root>/skins/<slug>/<asset-filename>            (background and/or preview)
 *   <root>/skins/<slug>/.jiumate-skin-receipt.json (after an import)
 *
 * Builtin presets live in the web bundle (see `@jiumate/skins/presets`) and are
 * merged with this catalog by the picker, the same way the pet picker merges its presets.
 *
 * ## Two source formats, one publish path
 *
 * A folder may carry either our own `skin.json` or a Codex-Dream-Skin `theme.json`. The
 * format is sniffed rather than declared by the caller, converted if needed, and then run
 * through the SAME `coerceSkinPackage` validator — so a converted theme is held to exactly
 * the rules a hand-written skin is, and there is one place that decides what a valid skin is.
 */
import { createHash } from "node:crypto";
import {
  ASSET_LIMIT,
  MANIFEST_LIMIT,
  MAX_SKINS,
  SkinPackageError,
  ZIP_ARCHIVE_LIMIT,
  ZipError,
  coerceSkinPackage,
  readDreamSkinTheme,
  deleteSkinPackage,
  fingerprintSkinPackage,
  importFingerprint,
  readSkinCatalog,
  readSkinPackage,
  readSkinReceipt,
  readZipEntries,
  skinDir,
  skinsDir,
  slugifySkinId,
  writeSkinPackage,
  writeSkinReceipt,
  type ThemeMode,
  type SkinPackage,
  type SkinReceipt,
  type ZipEntry,
} from "@jiumate/skins";

/** Diagnostic codes — stable strings the picker can render without surprises. */
export type SkinDiagnostic = string;

export interface SkinCatalogSnapshot {
  /** Skins installed under the data root, sorted by id. */
  skins: SkinPackage[];
  /** Non-fatal warnings collected while reading the catalog. */
  diagnostics: SkinDiagnostic[];
}

export interface SkinImportOptions {
  /** The fingerprint the reviewer saw. When supplied it must match, or the import is refused. */
  expectedFingerprint?: string | undefined;
  /**
   * Mode to use for a Codex-Dream-Skin theme that declares `appearance: "auto"`. Their format
   * treats "auto" as "fits either", which a single-mode package cannot express, so the caller
   * — normally the mode the user is looking at — decides.
   */
  mode?: ThemeMode | undefined;
}

export interface SkinImportResult {
  skin: SkinPackage;
  /** What the translation had to leave behind. Always empty for a native manifest. */
  warnings: string[];
}

export class SkinCatalogService {
  constructor(private readonly root: string) {}

  /** Read every installed skin plus any non-fatal diagnostics. */
  async list(): Promise<SkinCatalogSnapshot> {
    const diagnostics: SkinDiagnostic[] = [];
    let skins: SkinPackage[];
    try {
      skins = await readSkinCatalog(this.root);
    } catch (err) {
      diagnostics.push(`Could not inspect installed skins: ${(err as Error).message}`);
      return { skins: [], diagnostics };
    }
    return { skins, diagnostics };
  }

  /** Resolve a single skin by id. Returns null when not installed. */
  async get(skinId: string): Promise<SkinPackage | null> {
    if (!isValidSlug(skinId)) return null;
    return readSkinPackage(this.root, skinId);
  }

  /** Stable hash of an import source's absolute path (Windows: case-insensitive). */
  sourceKey(sourcePath: string): string {
    const normalised = process.platform === "win32" ? sourcePath.toLowerCase() : sourcePath;
    return createHash("sha256").update(normalised).digest("hex");
  }

  /**
   * Import a theme from a local directory holding either `skin.json` or a Codex-Dream-Skin
   * `theme.json`.
   *
   * Mirrors the pet catalog's `publish` helper: idempotent re-imports return the existing
   * install without rewriting it, so a user's own edits to an installed theme survive a
   * second import of the source it came from.
   */
  async importPackage(
    sourcePath: string,
    options: SkinImportOptions = {},
  ): Promise<SkinImportResult> {
    let loaded: LoadedImport;
    try {
      loaded = await this.loadSource(sourcePath, options.mode);
    } catch (err) {
      if (err instanceof SkinPackageError) throw err;
      throw new SkinPackageError(`Could not read theme source: ${(err as Error).message}`);
    }
    return this.publish(loaded, this.sourceKey(sourcePath), options.expectedFingerprint);
  }

  /**
   * Import a theme from a `.zip` archive — the form the Codex Dream Skin community library
   * distributes, and the only form a browser upload can produce.
   *
   * ## Why this extracts to a temporary directory
   *
   * The archive is unpacked into a temp directory and then handed to the **same**
   * `loadSource` → `publish` path a folder import takes. That is deliberate: it means an
   * uploaded theme is held to exactly the rules a folder is, including the per-asset size
   * check that `stat`s before reading, and there is one place that decides what a valid theme
   * is. A parallel in-memory path would be a second implementation to keep in step, and the
   * rules it would drift from are the ones that matter.
   *
   * The staging directory is the OS temp dir rather than the theme catalog, because it holds
   * untrusted bytes and the catalog is scanned as a list of installed themes. It is removed on
   * every exit path.
   *
   * ## Why the source key is the archive's hash
   *
   * A folder import keys its receipt on the source *path*, because that path is stable and a
   * re-import of it should be recognised. An upload has no such path — the same archive
   * arrives from a browser each time — so the key is the archive's own bytes. Re-uploading the
   * identical file is then idempotent, and a changed one is not.
   */
  async importArchive(
    archive: Uint8Array,
    options: SkinImportOptions = {},
  ): Promise<SkinImportResult> {
    if (archive.byteLength > ZIP_ARCHIVE_LIMIT) {
      throw new SkinPackageError(`Theme archive exceeds ${ZIP_ARCHIVE_LIMIT} bytes`);
    }
    let entries: ZipEntry[];
    try {
      entries = readZipEntries(archive);
    } catch (err) {
      if (err instanceof ZipError) throw new SkinPackageError(err.message);
      throw err;
    }
    if (entries.length === 0) {
      throw new SkinPackageError("Theme archive is empty");
    }

    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const sourceKey = createHash("sha256").update(archive).digest("hex");
    const staging = await fs.mkdtemp(path.join(os.tmpdir(), "jiumate-theme-"));
    try {
      for (const entry of entries) {
        // The reader has already refused traversal, nesting, separators and non-ASCII, so every
        // name here is a flat ASCII filename. The basename call is belt-and-braces: this is the
        // one line that turns an archive-supplied string into a path.
        await fs.writeFile(path.join(staging, path.basename(entry.name)), entry.bytes);
      }
      let loaded: LoadedImport;
      try {
        loaded = await this.loadSource(staging, options.mode);
      } catch (err) {
        if (err instanceof SkinPackageError) throw err;
        throw new SkinPackageError(`Could not read theme archive: ${(err as Error).message}`);
      }
      return await this.publish(loaded, sourceKey, options.expectedFingerprint);
    } finally {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** Delete an installed skin by id. */
  async deletePackage(skinId: string): Promise<void> {
    if (!isValidSlug(skinId)) throw new SkinPackageError("Invalid skin id");
    await deleteSkinPackage(this.root, skinId);
  }

  /** Skins directory rooted at the configured data root. */
  dir(): string {
    return skinsDir(this.root);
  }

  /** Single skin directory. */
  skinDirFor(slug: string): string {
    return skinDir(this.root, slug);
  }

  /**
   * Resolve one asset of an installed skin for serving, or null when it may not be served.
   *
   * Only the assets the manifest **declares** are reachable — the background and the preview.
   * The extension rule in the validator would already keep `skin.json` and the receipt out of
   * reach, but an allowlist of declared files is the tighter statement and the one that stays
   * true if the receipt's name ever changes.
   */
  async assetFor(
    skinId: string,
    filename: string,
  ): Promise<{ path: string; mimeType: string } | null> {
    const skin = await this.get(skinId);
    if (skin === null) return null;
    if (skin.background !== null && skin.background.filename === filename) {
      return { path: skin.background.assetPath, mimeType: skin.background.mimeType };
    }
    if (skin.previewPath !== null && basenameOf(skin.previewPath) === filename) {
      return {
        path: skin.previewPath,
        mimeType: skin.previewMimeType ?? "application/octet-stream",
      };
    }
    return null;
  }

  /**
   * Installed skins keyed by the `sourceKey` of the receipt they were imported under. Lets a
   * caller recognise its own earlier import without knowing how the catalog is laid out.
   */
  async importedBySource(): Promise<Map<string, { skin: SkinPackage; receipt: SkinReceipt }>> {
    const out = new Map<string, { skin: SkinPackage; receipt: SkinReceipt }>();
    const { skins } = await this.list();
    for (const skin of skins) {
      const receipt = await readSkinReceipt(this.root, skin.id);
      if (receipt !== null) out.set(receipt.sourceKey, { skin, receipt });
    }
    return out;
  }

  // ---- internals ----

  /**
   * The cap counts skin *directories*, read straight off the filesystem rather than derived
   * from `list()`. `list()` reports an unreadable catalog as zero skins, so a guard built on
   * it would wave through every import exactly when the directory is already too full to read.
   */
  private async ensureRoom(): Promise<void> {
    const fs = await import("node:fs/promises");
    const entries = await fs
      .readdir(skinsDir(this.root), { withFileTypes: true })
      .catch(() => [] as import("node:fs").Dirent[]);
    const installed = entries.filter(
      (entry) => entry.isDirectory() && !entry.name.startsWith("."),
    ).length;
    if (installed >= MAX_SKINS) {
      throw new SkinPackageError("Skin package limit reached");
    }
  }

  /**
   * The shared tail of both formats: honour the fingerprint the reviewer saw, return an
   * existing install when the receipt already matches, otherwise stage the assets and write
   * manifest + receipt.
   */
  private async publish(
    loaded: LoadedImport,
    sourceKey: string,
    expectedFingerprint?: string,
  ): Promise<SkinImportResult> {
    if (expectedFingerprint !== undefined && expectedFingerprint !== loaded.fingerprint) {
      throw new SkinPackageError("Skin source changed; refresh and review again");
    }
    const existing = await this.findByReceipt(sourceKey, loaded.fingerprint);
    if (existing !== null) return { skin: existing, warnings: loaded.warnings };
    await this.ensureRoom();
    const slug = slugifySkinId(loaded.manifest.id);
    const staged = await this.stage(slug, loaded);
    try {
      await writeSkinPackage(this.root, staged);
    } catch (err) {
      throw new SkinPackageError(`Could not stage skin: ${(err as Error).message}`);
    }
    const onDisk = await readSkinPackage(this.root, slug);
    if (onDisk === null) {
      throw new SkinPackageError("Skin staging file disappeared after import");
    }
    try {
      // The receipt records what is actually on disk, not the in-memory record: a re-read
      // package resolves its asset paths canonically, and fingerprinting the staged record
      // instead would make every fresh install look edited to the next reader comparing them.
      const receipt: SkinReceipt = {
        schemaVersion: 1,
        sourceKey,
        fingerprint: loaded.fingerprint,
        installedFingerprint: fingerprintSkinPackage(onDisk),
      };
      await writeSkinReceipt(this.root, slug, receipt);
    } catch (err) {
      throw new SkinPackageError(`Could not stage skin: ${(err as Error).message}`);
    }
    return { skin: onDisk, warnings: loaded.warnings };
  }

  private async findByReceipt(sourceKey: string, fingerprint: string): Promise<SkinPackage | null> {
    const imported = await this.importedBySource();
    const match = imported.get(sourceKey);
    return match !== undefined && match.receipt.fingerprint === fingerprint ? match.skin : null;
  }

  /**
   * Read a package from a directory. `skin.json` wins when both are present: a folder that
   * carries our own manifest has already been converted (or written) for this host, and the
   * theme beside it is the upstream original the user kept for reference.
   */
  private async loadSource(sourcePath: string, mode?: ThemeMode): Promise<LoadedImport> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const stat = await fs.stat(sourcePath).catch(() => null);
    if (stat === null || !stat.isDirectory()) {
      throw new SkinPackageError(
        "Skin source must be a directory containing skin.json or theme.json",
      );
    }
    const native = await fs.readFile(path.join(sourcePath, "skin.json")).catch(() => null);
    let loaded: LoadedImport;
    if (native !== null) {
      loaded = await this.assembleNative(new Uint8Array(native), sourcePath);
    } else {
      const dream = await fs.readFile(path.join(sourcePath, "theme.json")).catch(() => null);
      if (dream === null) {
        throw new SkinPackageError("Skin source is missing skin.json or theme.json");
      }
      loaded = await this.assembleDreamSkin(new Uint8Array(dream), sourcePath, mode);
    }
    // Warnings about what the source carried and this host did not use. Added here rather than
    // inside either `assemble*` because it is a property of the *directory*, which neither of
    // them can see — and because both formats deserve it.
    return {
      ...loaded,
      warnings: [...loaded.warnings, ...(await unusedSourceWarnings(sourcePath, loaded))],
    };
  }

  private async assembleNative(
    manifestBytes: Uint8Array,
    packagePath: string,
  ): Promise<LoadedImport> {
    if (manifestBytes.byteLength > MANIFEST_LIMIT) {
      throw new SkinPackageError(`Skin manifest exceeds ${MANIFEST_LIMIT} bytes`);
    }
    const record = coerceSkinPackage(parseJson(manifestBytes, "Skin manifest"), { packagePath });
    const assets = await this.readAssets(record);
    return {
      manifest: record,
      fingerprint: importFingerprint([manifestBytes, ...assets.map((asset) => asset.bytes)]),
      assets,
      warnings: [],
    };
  }

  private async assembleDreamSkin(
    themeBytes: Uint8Array,
    packagePath: string,
    mode?: ThemeMode,
  ): Promise<LoadedImport> {
    if (themeBytes.byteLength > MANIFEST_LIMIT) {
      throw new SkinPackageError(`Dream Skin theme exceeds ${MANIFEST_LIMIT} bytes`);
    }
    const { manifest, warnings } = readDreamSkinTheme(
      parseJson(themeBytes, "Dream Skin theme"),
      mode === undefined ? {} : { mode },
    );
    // Through the same validator a native manifest goes through: a converted theme gets no
    // licence to break the token allowlist or the asset rules.
    const record = coerceSkinPackage(manifest, { packagePath });
    const assets = await this.readAssets(record);
    return {
      manifest: record,
      // Fingerprints the SOURCE bytes, not the converted manifest: the value the picker
      // reviews is "this theme.json plus this image", and that is what a re-import compares.
      fingerprint: importFingerprint([themeBytes, ...assets.map((asset) => asset.bytes)]),
      assets,
      warnings,
    };
  }

  /**
   * Read every asset the manifest declares, after checking each one's size.
   *
   * The size is checked from `stat` BEFORE the read: a 200 MB image would otherwise be pulled
   * into memory in full and only then rejected for exceeding the limit. (The pet catalog reads
   * first and validates afterwards, which is the shape this deliberately does not copy.)
   */
  private async readAssets(skin: SkinPackage): Promise<LoadedAsset[]> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const declared: Array<{ filename: string; absolute: string }> = [];
    if (skin.background !== null) {
      declared.push({ filename: skin.background.filename, absolute: skin.background.assetPath });
    }
    if (skin.previewPath !== null) {
      declared.push({
        filename: basenameOf(skin.previewPath),
        absolute: skin.previewPath,
      });
    }
    const out: LoadedAsset[] = [];
    for (const asset of declared) {
      const stat = await fs.stat(asset.absolute).catch(() => null);
      if (stat === null || !stat.isFile()) {
        throw new SkinPackageError(`Skin source is missing its asset "${asset.filename}"`);
      }
      if (stat.size > ASSET_LIMIT) {
        throw new SkinPackageError(`Skin asset "${asset.filename}" exceeds ${ASSET_LIMIT} bytes`);
      }
      const bytes = new Uint8Array(await fs.readFile(asset.absolute));
      out.push({ filename: asset.filename, bytes });
    }
    return out;
  }

  /**
   * Write the assets into the target directory and return the manifest re-anchored to it.
   * The manifest is written by `writeSkinPackage`, which stores asset paths package-relative
   * — so the source directory's paths never reach the installed copy.
   */
  private async stage(slug: string, loaded: LoadedImport): Promise<SkinPackage> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const dir = skinDir(this.root, slug);
    await fs.mkdir(dir, { recursive: true });
    for (const asset of loaded.assets) {
      await fs.writeFile(path.join(dir, asset.filename), asset.bytes);
    }
    const rebase = (absolute: string): string =>
      path.join(dir, path.basename(absolute)).split(path.sep).join("/");
    return {
      ...loaded.manifest,
      id: slug,
      packagePath: dir.split(path.sep).join("/"),
      background:
        loaded.manifest.background === null
          ? null
          : {
              ...loaded.manifest.background,
              assetPath: rebase(loaded.manifest.background.assetPath),
            },
      previewPath:
        loaded.manifest.previewPath === null ? null : rebase(loaded.manifest.previewPath),
    };
  }
}

interface LoadedAsset {
  filename: string;
  bytes: Uint8Array;
}

interface LoadedImport {
  manifest: SkinPackage;
  fingerprint: string;
  assets: LoadedAsset[];
  /** Converter notes; always empty for a native manifest. */
  warnings: string[];
}

function isValidSlug(id: string): boolean {
  return /^[a-z0-9_-]+$/i.test(id);
}

function basenameOf(absolute: string): string {
  const parts = absolute.split("/");
  return parts[parts.length - 1] ?? absolute;
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (err) {
    throw new SkinPackageError(`${label} is not valid JSON: ${(err as Error).message}`);
  }
}

/**
 * Warnings for files the source carried and the import did not use.
 *
 * `theme.css` is the reason this exists. Dream Skin's importer requires it for any new package
 * (`extract-theme-zip-macos.sh` fails without it), so every theme from that community library
 * carries one — and this host has no Safe CSS support, so the file is written into the staging
 * directory and then dropped on the floor. A theme without it is missing the radius, blur, shadow
 * and typography its author wrote, which means the user compares the result against a screenshot
 * that was never going to match and has nothing to go on.
 *
 * Note that the copy strings in a Dream-Skin theme already warn this way (`dreamskin.ts`). A
 * stylesheet that changes how the theme *looks* deserves it at least as much, so leaving it
 * silent was an inconsistency in this host's own behaviour rather than a missing feature.
 *
 * The rest are named together and without ceremony. `manifest.json` and `LICENSE.txt` are
 * transport — the first is their integrity manifest, which this host does not verify against, and
 * the second is attribution for a theme the user already has. Neither is actionable, so neither
 * gets its own sentence.
 */
const UNUSED_SOURCE_EXPLAINED = new Map<string, string>([
  [
    "theme.css",
    "主题带的 theme.css（圆角、毛玻璃、阴影、字体等）在本应用里还没有实现，已忽略——这个主题的观感会和它的截图不一样。",
  ],
]);

async function unusedSourceWarnings(sourcePath: string, loaded: LoadedImport): Promise<string[]> {
  const fs = await import("node:fs/promises");
  // Both manifest names count as used: a folder that has been converted for this host keeps the
  // upstream `theme.json` beside its `skin.json`, and neither is "unused".
  const used = new Set([
    "skin.json",
    "theme.json",
    ...loaded.assets.map((asset) => asset.filename),
  ]);
  const entries = await fs.readdir(sourcePath, { withFileTypes: true }).catch(() => []);
  const unused = entries
    .filter((entry) => entry.isFile() && !entry.name.startsWith(".") && !used.has(entry.name))
    .map((entry) => entry.name)
    .sort();

  const warnings: string[] = [];
  const unnamed: string[] = [];
  for (const name of unused) {
    const explained = UNUSED_SOURCE_EXPLAINED.get(name);
    if (explained === undefined) unnamed.push(name);
    else warnings.push(explained);
  }
  if (unnamed.length > 0) {
    warnings.push(`主题带的这些文件没有对应项，已忽略：${unnamed.join("、")}`);
  }
  return warnings;
}
