/**
 * Local IO for JiuMate skin packages.
 *
 * The package format is host-supplied: callers pass in the root path (`<root>/skins/`) and
 * every read/write is anchored to that root. No process-wide constant, no env lookup — the
 * same arrangement the pet package uses, so the IO stays testable and a host can mount it
 * against a different root.
 *
 * Bounds follow the constants module: MANIFEST_LIMIT 64 KiB, ASSET_LIMIT 16 MiB,
 * MAX_SKINS 128, MAX_TOKENS 64.
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  ALLOWED_TOKENS,
  ASSET_FILENAME_LIMIT,
  ASSET_LIMIT,
  BACKGROUND_DIM_MAX,
  BACKGROUND_DIM_MIN,
  BACKGROUND_FOCUS_MAX,
  BACKGROUND_FOCUS_MIN,
  BACKGROUND_ZOOM_MAX,
  BACKGROUND_ZOOM_MIN,
  COLOR_VALUE_PATTERN,
  FONT_STACK_PATTERN,
  IMAGE_EXTENSIONS,
  DEFAULT_SKIN_BACKGROUND_DIM,
  DEFAULT_SKIN_SURFACE_ALPHA,
  MANIFEST_LIMIT,
  MAX_SKINS,
  MAX_SURFACES,
  MAX_TOKENS,
  RECEIPT_FILENAME,
  RECEIPT_SCHEMA_VERSION,
  SEMVER_PATTERN,
  SKIN_DESCRIPTION_LIMIT,
  SKIN_ID_LIMIT,
  SKIN_NAME_LIMIT,
  SKIN_SCHEMA,
  SKIN_SCHEMA_VERSION,
  TOKEN_VALUE_LIMIT,
  TYPOGRAPHY_TOKENS,
} from "./constants.js";
import {
  skinAssetPath,
  skinDir,
  skinManifestPath,
  skinReceiptPath,
  skinsDir,
  slugifySkinId,
} from "./paths.js";
import {
  isThemeAppearance,
  isThemeSafeArea,
  isThemeTaskMode,
  type SkinBackground,
  type SkinExtras,
  type SkinOrigin,
  type SkinPackage,
  type SkinReceipt,
  type ThemeArt,
  type ThemeColors,
  type ThemeSafeArea,
  type ThemeTaskMode,
} from "./schema.js";
import { THEME_COLOR_KEYS } from "./roles.js";
import { deriveRamps } from "./palette.js";

export {
  skinsDir,
  skinDir,
  skinManifestPath,
  skinAssetPath,
  skinReceiptPath,
  slugifySkinId,
  RECEIPT_FILENAME,
  ASSET_LIMIT,
  MANIFEST_LIMIT,
  MAX_SKINS,
  MAX_SURFACES,
  MAX_TOKENS,
};
export type { SkinBackground, SkinOrigin, SkinPackage, SkinReceipt };

/** Error raised when a skin package is invalid. The message is safe to surface to callers. */
export class SkinPackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkinPackageError";
  }
}

const TYPOGRAPHY_TOKEN_SET: ReadonlySet<string> = new Set<string>(TYPOGRAPHY_TOKENS);

/** Strict read of a single manifest. Throws on parse / validation failure so corrupted data surfaces loudly. */
export async function readSkinPackage(root: string, slug: string): Promise<SkinPackage | null> {
  const manifestPath = skinManifestPath(root, slug);
  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  if (Buffer.byteLength(raw, "utf8") > MANIFEST_LIMIT) {
    throw new SkinPackageError(`Skin manifest exceeds ${MANIFEST_LIMIT} bytes`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new SkinPackageError(`Skin manifest is not valid JSON: ${(err as Error).message}`);
  }
  return coerceSkinPackage(parsed, { packagePath: skinDir(root, slug) });
}

/**
 * Coerce an arbitrary object into a `SkinPackage`. Used for both on-disk reads and
 * out-of-process imports (including the Codex-Dream-Skin converter, which produces a
 * manifest-shaped object and lets this function be the single place that decides validity).
 */
export function coerceSkinPackage(value: unknown, ctx: { packagePath: string }): SkinPackage {
  const raw = asObject(value, "Theme manifest must be a JSON object");

  if (raw["schema"] !== SKIN_SCHEMA) {
    throw new SkinPackageError(`Theme manifest must declare schema "${SKIN_SCHEMA}"`);
  }
  if (raw["schemaVersion"] !== SKIN_SCHEMA_VERSION) {
    throw new SkinPackageError(`Theme manifest must use schemaVersion ${SKIN_SCHEMA_VERSION}`);
  }

  const id = slugifySkinId(typeof raw["id"] === "string" ? raw["id"] : null);
  if (id === "custom-skin") {
    throw new SkinPackageError("Theme manifest is missing a usable `id`");
  }
  if (id.length > SKIN_ID_LIMIT) {
    throw new SkinPackageError(`Theme id exceeds ${SKIN_ID_LIMIT} characters`);
  }

  const name = trimmedString(raw["name"]);
  if (name === null) throw new SkinPackageError("Theme manifest is missing `name`");
  if (name.length > SKIN_NAME_LIMIT) {
    throw new SkinPackageError(`Theme name exceeds ${SKIN_NAME_LIMIT} characters`);
  }

  // Absent means `auto`, matching upstream: a theme that says nothing about its shells is
  // claiming the artwork was checked under both. Authors who know better are expected to say so.
  const appearance = raw["appearance"] === undefined ? "auto" : raw["appearance"];
  if (!isThemeAppearance(appearance)) {
    throw new SkinPackageError('Theme `appearance` must be "light", "dark" or "auto"');
  }
  const declaredAppearance = appearance;

  const version = typeof raw["version"] === "string" ? raw["version"] : "";
  if (!SEMVER_PATTERN.test(version)) {
    throw new SkinPackageError(`Theme manifest \`version\` must be semver (got "${version}")`);
  }

  const author = boundedOptionalString(raw["author"], SKIN_NAME_LIMIT, "author");
  const description = boundedOptionalString(
    raw["description"],
    SKIN_DESCRIPTION_LIMIT,
    "description",
  );

  const colors = coerceColors(raw["colors"]);
  // Both readings, from the one palette. See `palette.ts` for why a palette is laid out twice.
  const ramps = deriveRamps(colors);
  const art = coerceArt(raw["art"]);
  const background = coerceBackground(raw["image"], art, ctx.packagePath);
  const preview = coercePreview(raw["preview"], ctx.packagePath);
  const origin = coerceOrigin(raw["origin"]);
  const extras = coerceExtras(raw["jiumate"]);

  return {
    id,
    name,
    author,
    description,
    version,
    appearance: declaredAppearance,
    source: typeof raw["source"] === "string" ? raw["source"] : "user",
    packagePath: posix(ctx.packagePath),
    colors,
    art,
    tokens: { light: ramps.light.tokens, dark: ramps.dark.tokens },
    surfaces: { light: ramps.light.surfaces, dark: ramps.dark.surfaces },
    extras,
    background,
    previewPath: preview === null ? null : preview.path,
    previewMimeType: preview === null ? null : preview.mimeType,
    origin,
  };
}

/**
 * Read every installed skin under `root/skins/`. Folders whose name is a dotfile, or whose
 * manifest fails to parse, are skipped with a logged warning rather than aborting the whole
 * catalog — one bad skin must never take down the picker.
 *
 * The `MAX_SKINS` cap truncates rather than throwing: throwing here reads as "the catalog is
 * empty" to every caller that catches, which hides every installed skin *and* defeats the
 * import guard that counts them. Only directories count towards the cap.
 */
export async function readSkinCatalog(root: string): Promise<SkinPackage[]> {
  const dir = skinsDir(root);
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const slugs = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, MAX_SKINS);
  const out: SkinPackage[] = [];
  for (const slug of slugs) {
    try {
      const skin = await readSkinPackage(root, slug);
      if (skin !== null) out.push(skin);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[skins] skipping invalid skin '${slug}': ${(err as Error).message}`);
    }
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

/**
 * Write a manifest to disk. Does NOT touch the assets — callers stage those and the
 * manifest in any order, exactly as the pet package does.
 *
 * The written form is canonical: token keys are sorted so the file is byte-stable, and the
 * asset paths are stored package-relative so the manifest stays portable between hosts.
 */
export async function writeSkinPackage(root: string, skin: SkinPackage): Promise<void> {
  const dir = skinDir(root, skin.id);
  await mkdir(dir, { recursive: true });
  const body = JSON.stringify(toCanonicalManifest(skin), null, 2);
  await writeFile(skinManifestPath(root, skin.id), body, "utf8");
}

/**
 * SHA-256 of the canonical manifest.
 *
 * Fingerprints the **package-relative** form, never the absolute paths: a skin installed at
 * a different root is the same skin, and hashing resolved paths would make every install
 * look edited to the next reader that compared the two.
 */
export function fingerprintSkinPackage(skin: SkinPackage): string {
  const body = JSON.stringify(toCanonicalManifest(skin), null, 2);
  return createHash("sha256").update(body).digest("hex");
}

/**
 * Fingerprint of an import source: SHA-256 over each blob's byte length followed by its
 * bytes, in the order given. Length-prefixing stops a different manifest/asset split from
 * colliding on one digest — the same construction the pet package uses, so both agree on
 * what "the source changed" means.
 */
export function importFingerprint(blobs: readonly Uint8Array[]): string {
  const hash = createHash("sha256");
  for (const blob of blobs) hash.update(String(blob.byteLength)).update(blob);
  return hash.digest("hex");
}

/** Read the receipt next to a skin's manifest, or null if absent. */
export async function readSkinReceipt(root: string, slug: string): Promise<SkinReceipt | null> {
  const path = skinReceiptPath(root, slug);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  if (Buffer.byteLength(raw, "utf8") > MANIFEST_LIMIT) {
    throw new SkinPackageError("Skin receipt exceeds MANIFEST_LIMIT");
  }
  // A receipt is a cache of "we already imported this", not a source of truth: a corrupted
  // one must read as "no receipt" rather than failing the catalog that contains it. (The
  // pet package learned this the hard way — an unparsable receipt took down the whole
  // external-pet listing.)
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Partial<SkinReceipt>;
  if (
    record.schemaVersion !== RECEIPT_SCHEMA_VERSION ||
    typeof record.sourceKey !== "string" ||
    typeof record.fingerprint !== "string" ||
    typeof record.installedFingerprint !== "string"
  ) {
    return null;
  }
  return record as SkinReceipt;
}

/** Write the receipt next to a skin's manifest. */
export async function writeSkinReceipt(
  root: string,
  slug: string,
  receipt: SkinReceipt,
): Promise<void> {
  if (receipt.schemaVersion !== RECEIPT_SCHEMA_VERSION) {
    throw new SkinPackageError(
      `Refusing to write receipt with schemaVersion=${receipt.schemaVersion}`,
    );
  }
  await mkdir(skinDir(root, slug), { recursive: true });
  await writeFile(skinReceiptPath(root, slug), JSON.stringify(receipt), "utf8");
}

/** Remove an installed skin's directory (manifest, assets, receipt — everything). */
export async function deleteSkinPackage(root: string, slug: string): Promise<void> {
  await rm(skinDir(root, slug), { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

/** The on-disk manifest shape. Upstream's, plus the `jiumate` block and the asset name. */
function toCanonicalManifest(skin: SkinPackage): Record<string, unknown> {
  return {
    schema: SKIN_SCHEMA,
    schemaVersion: SKIN_SCHEMA_VERSION,
    id: skin.id,
    name: skin.name,
    author: skin.author,
    description: skin.description,
    version: skin.version,
    appearance: skin.appearance,
    // Sorted so a re-write is byte-stable and two manifests that declare the same palette
    // fingerprint the same regardless of the order the author happened to write them in.
    colors: Object.fromEntries(
      THEME_COLOR_KEYS.filter((key) => key in skin.colors).map((key) => [key, skin.colors[key]]),
    ),
    art: {
      focusX: skin.art.focusX,
      focusY: skin.art.focusY,
      zoom: skin.art.zoom,
      dim: skin.art.dim,
      ...(skin.art.safeArea === null ? {} : { safeArea: skin.art.safeArea }),
      ...(skin.art.taskMode === null ? {} : { taskMode: skin.art.taskMode }),
    },
    ...(skin.background === null ? {} : { image: skin.background.filename }),
    ...(skin.previewPath === null ? {} : { preview: posix(basename(skin.previewPath)) }),
    ...(skin.extras.font === null ? {} : { jiumate: { font: skin.extras.font } }),
    ...(skin.origin === null ? {} : { origin: skin.origin }),
  };
}

function coerceColors(value: unknown): ThemeColors {
  const table = asObject(value, "Theme manifest is missing `colors`");
  // Exact keys, both ways, as upstream. A missing role has no defensible default — guessing a
  // theme's body-text colour is worse than refusing the theme — and an extra key is a typo the
  // author would rather hear about than have silently ignored.
  const missing = THEME_COLOR_KEYS.filter((key) => !(key in table));
  if (missing.length > 0) {
    throw new SkinPackageError(`Theme \`colors\` is missing: ${missing.join(", ")}`);
  }
  const unknown = Object.keys(table).filter(
    (key) => !(THEME_COLOR_KEYS as readonly string[]).includes(key),
  );
  if (unknown.length > 0) {
    throw new SkinPackageError(`Theme \`colors\` has unknown keys: ${unknown.join(", ")}`);
  }
  const out = {} as ThemeColors;
  for (const key of THEME_COLOR_KEYS) {
    const declared = table[key];
    if (typeof declared !== "string" || declared.length === 0) {
      throw new SkinPackageError(`Theme \`colors.${key}\` must be a non-empty string`);
    }
    if (declared.length > TOKEN_VALUE_LIMIT) {
      throw new SkinPackageError(`Theme \`colors.${key}\` exceeds ${TOKEN_VALUE_LIMIT} characters`);
    }
    if (!COLOR_VALUE_PATTERN.test(declared)) {
      throw new SkinPackageError(
        `Theme \`colors.${key}\` must be a hex, rgb() or rgba() color (got "${declared}")`,
      );
    }
    out[key] = declared;
  }
  return out;
}

/**
 * Read the `art` block: where the artwork's subject sits, and how the host should treat it.
 *
 * Every field is optional. Upstream fills the gaps by analysing the image; this host does not,
 * so an unstated value stays unstated — except `focusX`, which falls back to the side the
 * declared safe area leaves free, because that is a fact about the composition rather than a
 * guess about the pixels.
 */
function coerceArt(value: unknown): ThemeArt {
  const raw =
    value === undefined || value === null ? {} : asObject(value, "`art` must be an object");
  const safeArea = coerceSafeArea(raw["safeArea"]);
  const taskMode = coerceTaskMode(raw["taskMode"]);
  const defaultFocusX = safeArea === "left" ? 0.72 : safeArea === "right" ? 0.28 : 0.5;
  return {
    focusX: coerceRange(
      raw["focusX"],
      BACKGROUND_FOCUS_MIN,
      BACKGROUND_FOCUS_MAX,
      "focusX",
      defaultFocusX,
    ),
    focusY: coerceRange(raw["focusY"], BACKGROUND_FOCUS_MIN, BACKGROUND_FOCUS_MAX, "focusY", 0.45),
    zoom: coerceRange(raw["zoom"], BACKGROUND_ZOOM_MIN, BACKGROUND_ZOOM_MAX, "zoom", 1),
    dim: coerceRange(
      raw["dim"],
      BACKGROUND_DIM_MIN,
      BACKGROUND_DIM_MAX,
      "dim",
      DEFAULT_SKIN_BACKGROUND_DIM,
    ),
    safeArea,
    taskMode,
  };
}

/** `auto` normalises to null rather than being guessed at; this host has no image analysis. */
function coerceSafeArea(value: unknown): ThemeSafeArea | null {
  if (value === undefined || value === null || value === "auto") return null;
  if (!isThemeSafeArea(value)) {
    throw new SkinPackageError('`art.safeArea` must be "left", "right" or "none"');
  }
  return value;
}

/** Same reasoning as {@link coerceSafeArea}: `auto` is upstream's inference, which we do not do. */
function coerceTaskMode(value: unknown): ThemeTaskMode | null {
  if (value === undefined || value === null || value === "auto") return null;
  if (!isThemeTaskMode(value)) {
    throw new SkinPackageError('`art.taskMode` must be "ambient", "full" or "off"');
  }
  return value;
}

/**
 * Read the optional `jiumate` block — the fields this host understands and upstream does not.
 *
 * Kept in its own object rather than added to the top level so a theme stays importable into the
 * project this format came from, whose validator rejects unknown keys outright.
 */
function coerceExtras(value: unknown): SkinExtras {
  if (value === undefined || value === null) return { font: null };
  const raw = asObject(value, "`jiumate` must be an object");
  const font = raw["font"];
  if (font === undefined || font === null) return { font: null };
  if (typeof font !== "string" || font.length === 0) {
    throw new SkinPackageError("`jiumate.font` must be a non-empty string");
  }
  if (font.length > TOKEN_VALUE_LIMIT) {
    throw new SkinPackageError(`\`jiumate.font\` exceeds ${TOKEN_VALUE_LIMIT} characters`);
  }
  if (!FONT_STACK_PATTERN.test(font)) {
    throw new SkinPackageError("`jiumate.font` must be a plain font stack");
  }
  return { font };
}

/**
 * Read the `image` field: one filename beside the manifest, as upstream.
 *
 * Upstream fixes the name (`background.webp|jpg|png`); this host also accepts `.svg`, because the
 * built-in gallery is authored as SVG — vector art scales to any window and costs a few KiB in a
 * bundle the desktop app carries. Framing comes from `art`, so there is no separate block.
 */
function coerceBackground(
  value: unknown,
  art: ThemeArt,
  packagePath: string,
): SkinBackground | null {
  if (value === undefined || value === null) return null;
  const filename = coerceAssetFilename(value, "image");
  return {
    filename,
    assetPath: resolveAssetPath(packagePath, filename),
    mimeType: mimeForAsset(filename),
    focusX: art.focusX,
    focusY: art.focusY,
    zoom: art.zoom,
    dim: art.dim,
  };
}

function coercePreview(
  value: unknown,
  packagePath: string,
): { path: string; mimeType: string } | null {
  if (value === undefined || value === null) return null;
  const filename = coerceAssetFilename(value, "preview");
  return { path: resolveAssetPath(packagePath, filename), mimeType: mimeForAsset(filename) };
}

function coerceOrigin(value: unknown): SkinOrigin | null {
  if (value === undefined || value === null) return null;
  const raw = asObject(value, "`origin` must be an object");
  if (raw["format"] !== "dreamskin") {
    throw new SkinPackageError('`origin.format` must be "dreamskin"');
  }
  const originalId = typeof raw["originalId"] === "string" ? raw["originalId"] : null;
  if (originalId === null) throw new SkinPackageError("`origin.originalId` must be a string");
  const appearance = typeof raw["appearance"] === "string" ? raw["appearance"] : null;
  const copy: Record<string, string> = {};
  if (raw["copy"] !== undefined) {
    const table = asObject(raw["copy"], "`origin.copy` must be an object");
    for (const key of Object.keys(table)) {
      const entry = table[key];
      if (typeof entry === "string") copy[key] = entry;
    }
  }
  return { format: "dreamskin", originalId, appearance, copy };
}

/** A single path segment with a recognized image extension. */
function coerceAssetFilename(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new SkinPackageError(`\`${label}\` must name an image file`);
  }
  if (value.length > ASSET_FILENAME_LIMIT) {
    throw new SkinPackageError(`\`${label}\` filename exceeds ${ASSET_FILENAME_LIMIT} characters`);
  }
  // One segment, and only the characters a filename needs. A name with no separator in it
  // cannot climb out of the package directory, which is what keeps the asset route safe.
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(value)) {
    throw new SkinPackageError(`\`${label}\` must be a plain filename (no directories)`);
  }
  if (!mimeForAssetOrNull(value)) {
    throw new SkinPackageError(
      `\`${label}\` must end in one of ${[...IMAGE_EXTENSIONS.keys()].join(", ")}`,
    );
  }
  return value;
}

function mimeForAsset(filename: string): string {
  const mime = mimeForAssetOrNull(filename);
  if (!mime) throw new SkinPackageError(`Unsupported image extension: ${filename}`);
  return mime;
}

function mimeForAssetOrNull(filename: string): string | null {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0) return null;
  return IMAGE_EXTENSIONS.get(filename.slice(dot).toLowerCase()) ?? null;
}

/**
 * Resolve an asset filename against the package directory.
 *
 * The single-segment rule above already makes an escape impossible; this is the last line of
 * defence on the **resolved** result rather than on the text, so it also covers the forms we
 * did not think of (a Windows segment Win32 normalises away, a separator the regex let
 * through). Same construction as the pet package's spritesheet check.
 */
function resolveAssetPath(packagePath: string, filename: string): string {
  const root = resolve(packagePath);
  const resolved = resolve(join(packagePath, filename));
  const escaped = relative(root, resolved);
  if (escaped === "" || escaped.startsWith("..") || isAbsolute(escaped)) {
    throw new SkinPackageError(`Asset "${filename}" escapes its package directory`);
  }
  return posix(resolved);
}

function coerceRange(
  value: unknown,
  min: number,
  max: number,
  label: string,
  fallback: number,
): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new SkinPackageError(`\`background.${label}\` must be a number`);
  }
  if (value < min || value > max) {
    throw new SkinPackageError(`\`background.${label}\` must be between ${min} and ${max}`);
  }
  return value;
}

function asObject(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SkinPackageError(message);
  }
  return value as Record<string, unknown>;
}

function trimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function boundedOptionalString(value: unknown, limit: number, label: string): string | null {
  const trimmed = trimmedString(value);
  if (trimmed === null) return null;
  if (trimmed.length > limit) {
    throw new SkinPackageError(`Skin \`${label}\` exceeds ${limit} characters`);
  }
  return trimmed;
}

/** Paths are stored with forward slashes so assertions stay stable on every host. */
function posix(value: string): string {
  return value.split(sep).join("/");
}

function relativePath(dir: string, absolute: string): string {
  return relative(dir, absolute).split(sep).join("/");
}
