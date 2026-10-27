/**
 * External pet sources — pets that ship inside *another* agent app's install.
 *
 * Mirrors OpenBitFun's Codex adapter: the Codex desktop app bundles a set of
 * Petdex pets in its webpack chunks, and this finds them, reads them out and
 * offers them for import. Nothing is executed — the bundle is parsed as text
 * (see `pet-codex-definitions.ts`) and the archive is read as a container (see
 * `asar.ts`).
 *
 * The review step is the point of the fingerprint. Discovery and import read the
 * archive separately, so a candidate carries the fingerprint of the bytes it was
 * built from; the import refuses when the source no longer hashes to it, which is
 * what stops a "reviewed" package from being swapped between the two reads.
 *
 * Where a pet came from is remembered in the install receipt (`sourceKey`), which
 * is also how a re-listing can tell an untouched copy from one the user has since
 * edited (`copyModified`) and an unchanged source from an updated one
 * (`sourceChanged`).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import {
  IMAGE_LIMIT,
  MANIFEST_LIMIT,
  MAX_PACKAGES,
  PetPackageError,
  fingerprintPetPackage,
  slugifyPetId,
  type PetPackage,
  type PetReceipt,
  type SpriteVersionNumber,
} from "@jadelau/pets";
import { openAsar } from "./asar.js";
import { importFingerprint, type PetCatalogService } from "./pet-catalog.js";
import { MAX_CODEX_DEFINITIONS, codexPetDefinitions } from "./pet-codex-definitions.js";

/** Bounds on what is pulled out of another app's archive. */
const SCRIPT_LIMIT = 32 * 1024 * 1024;
const ASSET_MAP_LIMIT = 1024 * 1024;
const BUNDLE_TOTAL_LIMIT = 64 * 1024 * 1024;
/** How long a discovered catalog is reused, so N preview requests cost one archive read. */
const CATALOG_TTL_MS = 10_000;
const REG_TIMEOUT_MS = 4000;

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------- discovery

export interface CodexDiscoveryInput {
  platform: NodeJS.Platform;
  /** `%LOCALAPPDATA%` (Windows). */
  localAppData?: string | undefined;
  /** `%ProgramFiles%` (Windows). */
  programFiles?: string | undefined;
  home?: string | undefined;
  /** Install roots of Store/MSIX packages, read from the registry on Windows. */
  packageRoots?: readonly string[] | undefined;
}

/**
 * Every place a Codex (or ChatGPT desktop) bundle plausibly lives, most likely
 * first and deduplicated. Pure so the per-platform table can be tested without
 * the platform.
 */
export function codexArchivePaths(input: CodexDiscoveryInput): string[] {
  const out: string[] = [];
  const push = (value: string | null | undefined): void => {
    if (value !== null && value !== undefined && value !== "" && !out.includes(value)) {
      out.push(value);
    }
  };
  // Normalises to forward slashes and drops the separator a later part starts with,
  // so a Windows root ("C:\\Program Files") and a POSIX one ("/Applications") both
  // compose without doubling a separator — and the dedupe above compares like for like.
  const join = (...parts: string[]): string =>
    parts
      .filter((part) => part !== "")
      .map((part, index) => (index === 0 ? part : part.replace(/^[/\\]+/, "")))
      .join("/")
      .replace(/\\/g, "/");

  if (input.platform === "win32") {
    // A Store/MSIX install is laid out as <package root>/app/resources/app.asar.
    for (const root of input.packageRoots ?? []) {
      push(join(root, "app/resources/app.asar"));
      push(join(root, "resources/app.asar"));
      push(join(root, "app.asar"));
    }
    for (const suffix of [
      "Programs/Codex/resources/app.asar",
      "Programs/ChatGPT/resources/app.asar",
      "OpenAI/Codex/resources/app.asar",
      "Codex/resources/app.asar",
    ]) {
      if (input.localAppData !== undefined) push(join(input.localAppData, suffix));
    }
    // An all-users install.
    for (const name of ["Codex", "ChatGPT"]) {
      if (input.programFiles !== undefined)
        push(join(input.programFiles, name, "resources/app.asar"));
    }
    return out;
  }

  if (input.platform === "darwin") {
    const roots = ["/Applications"];
    if (input.home !== undefined) roots.push(join(input.home, "Applications"));
    for (const root of roots) {
      for (const app of ["Codex.app", "ChatGPT.app"]) {
        push(join(root, app, "Contents/Resources/app.asar"));
      }
    }
    return out;
  }

  for (const root of ["/opt/Codex", "/opt/codex", "/opt/ChatGPT", "/usr/lib/codex"]) {
    push(join(root, "resources/app.asar"));
  }
  if (input.home !== undefined) {
    push(join(input.home, ".local/share/codex/resources/app.asar"));
  }
  return out;
}

/**
 * Store/MSIX package install roots for `OpenAI.Codex`, read out of the AppModel
 * registry. Best-effort: `reg.exe` may be unavailable or the key empty, and both
 * come back as a diagnostic rather than an error — the filesystem paths above
 * still cover an installer-based install.
 */
export async function windowsCodexPackageRoots(): Promise<{
  roots: string[];
  diagnostics: string[];
}> {
  const diagnostics: string[] = [];
  const packagesKey =
    "HKCU\\Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\CurrentVersion\\AppModel\\Repository\\Packages";
  let fullNames: string[];
  try {
    const { stdout } = await execFileAsync("reg", ["query", packagesKey], {
      windowsHide: true,
      timeout: REG_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
    });
    fullNames = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("OpenAI.Codex_"));
  } catch (err) {
    diagnostics.push(`Could not inspect Codex app registrations: ${(err as Error).message}`);
    return { roots: [], diagnostics };
  }

  const roots: string[] = [];
  for (const fullName of fullNames.slice(0, 8)) {
    try {
      const { stdout } = await execFileAsync(
        "reg",
        ["query", `${packagesKey}\\${fullName}`, "/v", "PackageRoot"],
        { windowsHide: true, timeout: REG_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
      );
      const match = /PackageRoot\s+REG_SZ\s+(.+)/.exec(stdout);
      const root = match?.[1]?.trim();
      if (root !== undefined && root !== "" && !roots.includes(root)) roots.push(root);
    } catch (err) {
      diagnostics.push(`Could not read the Codex package root: ${(err as Error).message}`);
    }
  }
  return { roots, diagnostics };
}

// ------------------------------------------------------------------ reading

export interface CodexBundlePet {
  id: string;
  displayName: string;
  description: string | null;
  spriteVersionNumber: SpriteVersionNumber;
  manifestBytes: Uint8Array;
  imageBytes: Uint8Array;
  imageMimeType: string;
}

function basename(name: string): string {
  return name.slice(name.lastIndexOf("/") + 1);
}

function mimeTypeFor(name: string): string {
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".gif")) return "image/gif";
  return "image/png";
}

/** The bundle's asset map is what names the *current* generation of a sprite. */
function referencedByAssetMap(assetMap: string, fileName: string): boolean {
  return (
    assetMap.includes(`\`${fileName}\``) ||
    assetMap.includes(`'${fileName}'`) ||
    assetMap.includes(`"${fileName}"`)
  );
}

/**
 * Read every pet bundled in one Codex archive. A single unreadable pet becomes a
 * diagnostic instead of failing the whole listing, so one bad asset cannot hide
 * the rest.
 */
export async function readCodexPets(
  archivePath: string,
): Promise<{ pets: CodexBundlePet[]; diagnostics: string[] }> {
  const diagnostics: string[] = [];
  const archive = await openAsar(archivePath);
  try {
    const names = archive.fileNames("webview/assets");
    const assetMaps = names.filter(
      (name) => basename(name).startsWith("codex-pet-assets-") && name.endsWith(".js"),
    );
    if (assetMaps.length !== 1) {
      diagnostics.push("Unsupported built-in pet asset map");
      return { pets: [], diagnostics };
    }
    const assetMap = new TextDecoder().decode(await archive.read(assetMaps[0]!, ASSET_MAP_LIMIT));

    const scripts = names.filter(
      (name) => basename(name).startsWith("app-initial-") && name.endsWith(".js"),
    );
    if (scripts.length !== 1) {
      diagnostics.push("Unsupported built-in pet metadata bundle");
      return { pets: [], diagnostics };
    }
    const script = new TextDecoder().decode(await archive.read(scripts[0]!, SCRIPT_LIMIT));

    const definitions = codexPetDefinitions(script);
    if (definitions.length === 0 || definitions.length > MAX_CODEX_DEFINITIONS) {
      diagnostics.push("Built-in pet definitions are missing or exceed the limit");
      return { pets: [], diagnostics };
    }

    const pets: CodexBundlePet[] = [];
    let totalBytes = 0;
    for (const definition of definitions) {
      const prefix = `${definition.assetRef}-spritesheet-`;
      const images = names.filter(
        (name) =>
          basename(name).startsWith(prefix) &&
          /\.(webp|png|jpe?g|gif)$/.test(name) &&
          referencedByAssetMap(assetMap, basename(name)),
      );
      if (images.length !== 1) {
        diagnostics.push(`Missing or ambiguous built-in pet image: ${definition.id}`);
        continue;
      }
      const imageBytes = await archive.read(images[0]!, IMAGE_LIMIT);
      totalBytes += imageBytes.byteLength;
      if (totalBytes > BUNDLE_TOTAL_LIMIT) {
        diagnostics.push("Bundled pet resource total exceeds its limit");
        break;
      }
      const imageName = basename(images[0]!);
      pets.push({
        id: slugifyPetId(definition.id),
        displayName: definition.displayName,
        description: definition.description,
        spriteVersionNumber: definition.spriteVersionNumber,
        imageMimeType: mimeTypeFor(imageName),
        imageBytes,
        // The staged package always names its image `spritesheet.<ext>`; the
        // import renames the file anyway, so the manifest is built against that.
        manifestBytes: new TextEncoder().encode(
          JSON.stringify({
            id: slugifyPetId(definition.id),
            displayName: definition.displayName,
            description: definition.description,
            spriteVersionNumber: definition.spriteVersionNumber,
            spritesheetPath: `spritesheet${imageName.slice(imageName.lastIndexOf("."))}`,
            spritesheetMimeType: mimeTypeFor(imageName),
          }),
        ),
      });
    }
    return { pets, diagnostics };
  } finally {
    await archive.close();
  }
}

// ------------------------------------------------------------------ catalog

export interface PetExternalCandidate {
  /** Identity of the source entry; also the receipt's `sourceKey`. */
  sourceKey: string;
  fingerprint: string;
  id: string;
  displayName: string;
  description: string | null;
  spriteVersionNumber: SpriteVersionNumber;
  /** Same-origin URL serving the atlas out of the source archive. */
  previewUrl: string;
  /** The installed copy with this source, if any. */
  imported: PetPackage | null;
  /** The installed copy has been edited since it was imported. */
  copyModified: boolean;
  /** The source changed since it was imported. */
  sourceChanged: boolean;
}

export interface PetExternalCatalog {
  candidates: PetExternalCandidate[];
  diagnostics: string[];
}

function sourceKeyFor(archivePath: string, petId: string): string {
  const identity = `${archivePath}#${petId}`;
  return createHash("sha256")
    .update(process.platform === "win32" ? identity.toLowerCase() : identity)
    .digest("hex");
}

/**
 * "Not there" is the normal case on most machines and must stay silent. A file
 * that exists but cannot be read is worth saying out loud — a Store-installed
 * Codex under `WindowsApps` is exactly that, and "nothing found" would hide it.
 *
 * Electron's asar shim reports a missing archive as `Invalid package <path>` with
 * no `code`, so the message is checked too: a regression in `openAsar`'s asar
 * bypass must not turn every machine without Codex into a wall of diagnostics.
 */
function sourceUnavailable(err: unknown): boolean {
  const error = err as NodeJS.ErrnoException;
  if (error.code === "ENOENT" || error.code === "ENOTDIR") return true;
  return typeof error.message === "string" && error.message.startsWith("Invalid package ");
}

export class PetExternalService {
  private cache: {
    at: number;
    catalog: PetExternalCatalog;
    sources: Map<string, CodexBundlePet>;
  } | null = null;

  constructor(
    private readonly catalog: PetCatalogService,
    /**
     * Test hook: read exactly these archives instead of discovering an install.
     * Discovery needs a real Codex on the machine, which no unit test can assume.
     */
    private readonly archiveOverride?: readonly string[],
  ) {}

  /** Discovered candidates, with a short cache so preview requests do not re-read the archive. */
  async list(): Promise<PetExternalCatalog> {
    const cached = this.cache;
    if (cached !== null && Date.now() - cached.at < CATALOG_TTL_MS) return cached.catalog;
    const fresh = await this.discover();
    this.cache = { at: Date.now(), catalog: fresh.catalog, sources: fresh.sources };
    return fresh.catalog;
  }

  /** The atlas for one candidate, read from whichever archive it came from. */
  async spritesheet(sourceKey: string): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
    const catalog = await this.list();
    if (!catalog.candidates.some((candidate) => candidate.sourceKey === sourceKey)) return null;
    const pet = this.cache?.sources.get(sourceKey);
    if (pet === undefined) return null;
    return { bytes: pet.imageBytes, mimeType: pet.imageMimeType };
  }

  /**
   * Import a reviewed candidate. Re-reads the source rather than trusting the
   * cached copy: the fingerprint check is only meaningful if the bytes are read
   * again, and this is the call that writes to disk.
   */
  async importCandidate(sourceKey: string, expectedFingerprint: string): Promise<PetPackage> {
    const { catalog, sources } = await this.discover();
    const candidate = catalog.candidates.find((entry) => entry.sourceKey === sourceKey);
    const pet = sources.get(sourceKey);
    if (candidate === undefined || pet === undefined) {
      throw new PetPackageError("This pet is no longer offered by the source app");
    }
    if (candidate.fingerprint !== expectedFingerprint) {
      throw new PetPackageError("Pet source changed; refresh and review again");
    }
    const installed = await this.catalog.importBytes({
      sourceKey,
      manifestBytes: pet.manifestBytes,
      imageBytes: pet.imageBytes,
      expectedFingerprint,
    });
    // `imported` / `copyModified` are derived from the install receipts, so the
    // listing cached above went stale the moment this wrote one.
    this.cache = null;
    return installed;
  }

  private async discover(): Promise<{
    catalog: PetExternalCatalog;
    sources: Map<string, CodexBundlePet>;
  }> {
    const diagnostics: string[] = [];
    const sources = new Map<string, CodexBundlePet>();
    const candidates: PetExternalCandidate[] = [];

    const packageRoots =
      this.archiveOverride === undefined && process.platform === "win32"
        ? await windowsCodexPackageRoots()
        : null;
    if (packageRoots !== null) diagnostics.push(...packageRoots.diagnostics);

    const archivePaths =
      this.archiveOverride ??
      codexArchivePaths({
        platform: process.platform,
        localAppData: process.env["LOCALAPPDATA"],
        programFiles: process.env["ProgramFiles"],
        home: process.env["USERPROFILE"] ?? process.env["HOME"],
        packageRoots: packageRoots?.roots,
      });

    const installed = await this.catalog.importedBySource();
    let found = false;
    for (const archivePath of archivePaths) {
      let bundle: { pets: CodexBundlePet[]; diagnostics: string[] };
      try {
        bundle = await readCodexPets(archivePath);
      } catch (err) {
        if (!sourceUnavailable(err)) {
          diagnostics.push(`${archivePath}: ${(err as Error).message}`);
        }
        continue;
      }
      found = true;
      diagnostics.push(...bundle.diagnostics.map((entry) => `${archivePath}: ${entry}`));
      for (const pet of bundle.pets) {
        if (candidates.length >= MAX_PACKAGES) break;
        const sourceKey = sourceKeyFor(archivePath, pet.id);
        sources.set(sourceKey, pet);
        candidates.push(this.describe(pet, sourceKey, installed));
      }
      break;
    }

    if (!found) {
      diagnostics.push("No Codex desktop installation with bundled pets was found");
    }
    return { catalog: { candidates, diagnostics }, sources };
  }

  private describe(
    pet: CodexBundlePet,
    sourceKey: string,
    installed: Map<string, { pet: PetPackage; receipt: PetReceipt }>,
  ): PetExternalCandidate {
    const fingerprint = importFingerprint(pet.manifestBytes, pet.imageBytes);
    const base: PetExternalCandidate = {
      sourceKey,
      fingerprint,
      id: pet.id,
      displayName: pet.displayName,
      description: pet.description,
      spriteVersionNumber: pet.spriteVersionNumber,
      previewUrl: `/api/pets/external/${sourceKey}/spritesheet`,
      imported: null,
      copyModified: false,
      sourceChanged: false,
    };
    const match = installed.get(sourceKey);
    if (match === undefined) return base;
    return {
      ...base,
      imported: match.pet,
      copyModified: fingerprintPetPackage(match.pet) !== match.receipt.installedFingerprint,
      sourceChanged: fingerprint !== match.receipt.fingerprint,
    };
  }
}

/** Re-exported so route handlers can bound the response the same way the catalog does. */
export { MANIFEST_LIMIT };
