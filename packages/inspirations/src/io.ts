/**
 * Local IO for the inspiration library.
 *
 * The library root is an argument on every call rather than a process-wide constant, matching the
 * pet and skin catalogs: the server anchors it at the data root, and a test anchors it at a temp
 * directory.
 *
 * ## Layout
 *
 *   <root>/inspirations/cases/<id>/case.json      the case
 *   <root>/inspirations/cases/<id>/cover.<ext>    optional cover image
 *   <root>/inspirations/cases/<id>/preview.html   optional preview document
 *   <root>/inspirations/categories/<id>.json      one admin category per file
 *
 * ## What this module is strict about, and what it tolerates
 *
 * A **write** is strict: an unknown field, an out-of-range length, an id that disagrees with the
 * directory it is about to be written into — each is refused, because a manifest that half-saved
 * is worse than one that did not.
 *
 * A **read** is tolerant in exactly two places. A case directory whose manifest is unreadable is
 * skipped with a diagnostic rather than failing the whole catalog — one bad case must not take
 * down the gallery, the same call the pet catalog makes. And a case naming a category that no
 * longer exists keeps its `categoryId` and gains a diagnostic: the gallery's "All" tab still
 * shows it, and a hand-edited manifest does not become invisible.
 */
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ASSET_FILENAME_LIMIT,
  CASE_KINDS,
  COVER_KINDS,
  COVER_LIMIT,
  DESCRIPTION_LIMIT,
  GLYPH_LIMIT,
  IMAGE_EXTENSIONS,
  INSPIRATION_SCHEMA,
  INSPIRATION_SCHEMA_ACCEPTED,
  INSPIRATION_SCHEMA_VERSION,
  MANIFEST_LIMIT,
  MAX_CASES,
  MAX_CATEGORIES,
  MAX_SKILLS,
  MAX_TOOLS,
  PREVIEW_FILENAME,
  PREVIEW_LIMIT,
  PROMPT_LIMIT,
  REF_NAME_LIMIT,
  CATEGORY_NAME_LIMIT,
  TITLE_LIMIT,
} from "./constants.js";
import {
  caseAssetPath,
  caseDir,
  caseManifestPath,
  casesDir,
  categoriesDir,
  categoryPath,
  isAssetFilename,
} from "./paths.js";
import { SEED_INSPIRATION_CATEGORIES } from "./presets.js";
import { isInspirationSlug } from "./schema.js";
import type {
  InspirationCase,
  InspirationCaseInput,
  InspirationCatalog,
  InspirationCategory,
  InspirationCover,
  InspirationKind,
  InspirationSource,
} from "./schema.js";

/** Raised when a case or category is invalid. The message is safe to surface to a caller. */
export class InspirationPackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InspirationPackageError";
  }
}

// ---------------------------------------------------------------------------
// Coercion
// ---------------------------------------------------------------------------

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InspirationPackageError(`${what} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

/**
 * A required, trimmed, length-capped string.
 *
 * `fallbackFrom` is the other language's value: when this side is missing or blank it is filled
 * from there, so a case authored in one language is readable in both UIs instead of rendering an
 * empty card. Only when both sides are blank does an empty string pass through — an Agent-only
 * case legitimately has no prompt.
 */
function textField(
  raw: Record<string, unknown>,
  key: string,
  limit: number,
  what: string,
  fallbackFrom?: string,
): string {
  const value = raw[key];
  if (value !== undefined && value !== null && typeof value !== "string") {
    throw new InspirationPackageError(`${what} must be a string`);
  }
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length > limit) {
    throw new InspirationPackageError(`${what} must be at most ${limit} characters`);
  }
  if (text !== "") return text;
  const fallback = (fallbackFrom ?? "").trim();
  return fallback.length > limit ? fallback.slice(0, limit) : fallback;
}

/** A list of referenced names (skills, tools): trimmed, non-empty, deduplicated, capped. */
function refList(raw: Record<string, unknown>, key: string, cap: number): string[] {
  const value = raw[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new InspirationPackageError(`${key} must be an array`);
  }
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      throw new InspirationPackageError(`${key} entries must be strings`);
    }
    const name = entry.trim();
    if (name === "") continue;
    if (name.length > REF_NAME_LIMIT) {
      throw new InspirationPackageError(
        `${key} entries must be at most ${REF_NAME_LIMIT} characters`,
      );
    }
    if (!out.includes(name)) out.push(name);
  }
  if (out.length > cap) {
    throw new InspirationPackageError(`${key} must hold at most ${cap} entries`);
  }
  return out;
}

function boolField(raw: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = raw[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "boolean") {
    throw new InspirationPackageError(`${key} must be a boolean`);
  }
  return value;
}

function orderField(raw: Record<string, unknown>): number {
  const value = raw["order"];
  if (value === undefined || value === null) return 0;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new InspirationPackageError("order must be a number");
  }
  // Clamped rather than refused: an order is a sort hint, and a client sending 1e9 is asking for
  // "last", which the clamp grants without a round trip.
  return Math.max(-10_000, Math.min(10_000, Math.round(value)));
}

function kindField(raw: Record<string, unknown>): InspirationKind {
  const value = raw["kind"];
  if (typeof value === "string" && (CASE_KINDS as readonly string[]).includes(value)) {
    return value as InspirationKind;
  }
  throw new InspirationPackageError(`kind must be one of ${CASE_KINDS.join(", ")}`);
}

/**
 * The cover, as a discriminated union.
 *
 * A `glyph` cover is a character; an `image` cover names a file beside the manifest. The MIME
 * type is **derived from the extension** rather than read from the manifest: a manifest claiming
 * `image/png` for a `.svg` would otherwise have the asset route serve SVG under a raster type,
 * and the type is the one thing the browser acts on.
 */
function coverField(raw: Record<string, unknown>): InspirationCover {
  const value = raw["cover"];
  if (value === undefined || value === null) return { kind: "glyph", glyph: "✨" };
  const cover = asRecord(value, "cover");
  const kind = cover["kind"];
  if (typeof kind !== "string" || !(COVER_KINDS as readonly string[]).includes(kind)) {
    throw new InspirationPackageError(`cover.kind must be one of ${COVER_KINDS.join(", ")}`);
  }
  if (kind === "glyph") {
    const glyph = typeof cover["glyph"] === "string" ? cover["glyph"].trim() : "";
    if (glyph === "") throw new InspirationPackageError("cover.glyph must not be empty");
    if (glyph.length > GLYPH_LIMIT) {
      throw new InspirationPackageError(`cover.glyph must be at most ${GLYPH_LIMIT} characters`);
    }
    return { kind: "glyph", glyph };
  }
  const filename = typeof cover["filename"] === "string" ? cover["filename"].trim() : "";
  if (!isAssetFilename(filename)) {
    throw new InspirationPackageError(
      `cover.filename must be a single path segment with one of ${[...IMAGE_EXTENSIONS.keys()].join(", ")}`,
    );
  }
  const dot = filename.lastIndexOf(".");
  const mimeType =
    IMAGE_EXTENSIONS.get(filename.slice(dot).toLowerCase()) ?? "application/octet-stream";
  return { kind: "image", filename, mimeType };
}

/**
 * The preview filename: absent, or exactly the one name a preview may take.
 *
 * Two spellings are accepted because the same value has two homes: a manifest stores it as
 * `preview` (it names a file beside the manifest), while the in-memory case calls it
 * `previewFilename` (it is one field among several, and `preview` alone reads like the document
 * itself). Coercion is what bridges them, so it has to read both — a case read off disk and
 * written back is otherwise unchanged by construction, which is what the round trip relies on.
 */
function previewField(raw: Record<string, unknown>): string | null {
  const value = raw["preview"] ?? raw["previewFilename"];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new InspirationPackageError("preview must be a string");
  }
  const name = value.trim();
  if (name === "") return null;
  if (name !== PREVIEW_FILENAME) {
    throw new InspirationPackageError(`preview must be ${PREVIEW_FILENAME}`);
  }
  return name;
}

function optionalText(raw: Record<string, unknown>, key: string, limit: number): string | null {
  const value = raw[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new InspirationPackageError(`${key} must be a string`);
  }
  const text = value.trim();
  if (text === "") return null;
  if (text.length > limit) {
    throw new InspirationPackageError(`${key} must be at most ${limit} characters`);
  }
  return text;
}

/**
 * Coerce a manifest — or a create/update request body, which is the same shape — into a case.
 *
 * `id` is required to be a legal slug, and `expectedId` (the directory name, on a read) must
 * agree with it. That agreement is what keeps the catalog and the asset route talking about the
 * same case: without it a manifest could declare one id while sitting in another's directory, and
 * the two routes would serve different things under one name.
 */
export function coerceInspirationCaseInput(
  value: unknown,
  ctx: { expectedId?: string } = {},
): InspirationCaseInput {
  const raw = asRecord(value, "case");
  const declaredId = typeof raw["id"] === "string" ? raw["id"].trim() : "";
  const id = declaredId !== "" ? declaredId : (ctx.expectedId ?? "");
  if (!isInspirationSlug(id)) {
    throw new InspirationPackageError(
      "id must be lowercase letters, digits, dash or underscore, starting with a letter or digit",
    );
  }
  if (ctx.expectedId !== undefined && id !== ctx.expectedId) {
    throw new InspirationPackageError(
      `case.json declares id "${id}" but sits in directory "${ctx.expectedId}"`,
    );
  }
  const categoryId = typeof raw["categoryId"] === "string" ? raw["categoryId"].trim() : "";
  if (!isInspirationSlug(categoryId)) {
    throw new InspirationPackageError("categoryId must be a valid category id");
  }
  const agentId = optionalText(raw, "agentId", REF_NAME_LIMIT);
  return {
    id,
    kind: kindField(raw),
    categoryId,
    title: textField(raw, "title", TITLE_LIMIT, "title", textOf(raw["titleZh"])),
    titleZh: textField(raw, "titleZh", TITLE_LIMIT, "titleZh", textOf(raw["title"])),
    description: textField(
      raw,
      "description",
      DESCRIPTION_LIMIT,
      "description",
      textOf(raw["descriptionZh"]),
    ),
    descriptionZh: textField(
      raw,
      "descriptionZh",
      DESCRIPTION_LIMIT,
      "descriptionZh",
      textOf(raw["description"]),
    ),
    prompt: textField(raw, "prompt", PROMPT_LIMIT, "prompt", textOf(raw["promptZh"])),
    promptZh: textField(raw, "promptZh", PROMPT_LIMIT, "promptZh", textOf(raw["prompt"])),
    agentId,
    skills: refList(raw, "skills", MAX_SKILLS),
    tools: refList(raw, "tools", MAX_TOOLS),
    cover: coverField(raw),
    previewFilename: previewField(raw),
    featured: boolField(raw, "featured", false),
    order: orderField(raw),
    enabled: boolField(raw, "enabled", true),
  };
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Coerce a category file or a create/update request body into a category. */
export function coerceInspirationCategory(
  value: unknown,
  ctx: { expectedId?: string } = {},
): InspirationCategory {
  const raw = asRecord(value, "category");
  const declaredId = typeof raw["id"] === "string" ? raw["id"].trim() : "";
  const id = declaredId !== "" ? declaredId : (ctx.expectedId ?? "");
  if (!isInspirationSlug(id)) {
    throw new InspirationPackageError("category id must be a valid slug");
  }
  if (ctx.expectedId !== undefined && id !== ctx.expectedId) {
    throw new InspirationPackageError(
      `category file declares id "${id}" but is named "${ctx.expectedId}"`,
    );
  }
  const name = textField(raw, "name", CATEGORY_NAME_LIMIT, "name", textOf(raw["nameZh"]));
  const nameZh = textField(raw, "nameZh", CATEGORY_NAME_LIMIT, "nameZh", textOf(raw["name"]));
  if (name === "" && nameZh === "") {
    throw new InspirationPackageError("category name must not be empty");
  }
  return { id, name, nameZh, order: orderField(raw) };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Read one admin case, or null when it is not there. Throws when it is there but invalid. */
export async function readInspirationCase(
  root: string,
  id: string,
): Promise<InspirationCase | null> {
  if (!isInspirationSlug(id)) return null;
  const manifest = caseManifestPath(root, id);
  let text: string;
  try {
    text = await readFile(manifest, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  if (Buffer.byteLength(text, "utf8") > MANIFEST_LIMIT) {
    throw new InspirationPackageError(`case.json exceeds ${MANIFEST_LIMIT} bytes`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new InspirationPackageError(`case.json is not valid JSON: ${(err as Error).message}`);
  }
  const raw = asRecord(parsed, "case");
  // A schema we have written ourselves — the current one, or the pre-rebrand one — is read, not
  // refused. Everything else is a file from somewhere else and stays a diagnostic, so one foreign
  // manifest cannot take the gallery down (see the tolerance note at the top of this module).
  if (raw["schema"] !== undefined && !INSPIRATION_SCHEMA_ACCEPTED.has(String(raw["schema"]))) {
    throw new InspirationPackageError(
      `case.json declares an unknown schema "${String(raw["schema"])}"`,
    );
  }
  if (raw["schemaVersion"] !== undefined && raw["schemaVersion"] !== INSPIRATION_SCHEMA_VERSION) {
    throw new InspirationPackageError(
      `case.json declares schemaVersion ${String(raw["schemaVersion"])}, this build writes ${INSPIRATION_SCHEMA_VERSION}`,
    );
  }
  const input = coerceInspirationCaseInput(raw, { expectedId: id });
  return {
    ...input,
    source: "admin",
    packagePath: caseDir(root, id),
    createdAt: optionalText(raw, "createdAt", 64),
    updatedAt: optionalText(raw, "updatedAt", 64),
    createdBy: optionalText(raw, "createdBy", 128),
  };
}

/** Read every case under a library root, in directory order. */
export async function readAdminCases(root: string): Promise<{
  cases: InspirationCase[];
  diagnostics: string[];
}> {
  const diagnostics: string[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(casesDir(root), { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { cases: [], diagnostics };
    throw err;
  }
  const ids = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  if (ids.length > MAX_CASES) {
    diagnostics.push(
      `only the first ${MAX_CASES} of ${ids.length} cases are listed; delete some to see the rest`,
    );
  }
  const cases: InspirationCase[] = [];
  for (const id of ids.slice(0, MAX_CASES)) {
    try {
      const one = await readInspirationCase(root, id);
      if (one !== null) cases.push(one);
    } catch (err) {
      // One unreadable case must not take down the gallery; it is reported instead.
      diagnostics.push(`skipped case "${id}": ${(err as Error).message}`);
    }
  }
  return { cases, diagnostics };
}

/** Read every category under a library root. */
export async function readAdminCategories(root: string): Promise<{
  categories: InspirationCategory[];
  diagnostics: string[];
}> {
  const diagnostics: string[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(categoriesDir(root), { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { categories: [], diagnostics };
    throw err;
  }
  const files = entries
    .filter(
      (entry) => entry.isFile() && entry.name.endsWith(".json") && !entry.name.startsWith("."),
    )
    .map((entry) => entry.name.slice(0, -".json".length))
    .filter((id) => isInspirationSlug(id))
    .sort((a, b) => a.localeCompare(b));
  if (files.length > MAX_CATEGORIES) {
    diagnostics.push(`only the first ${MAX_CATEGORIES} of ${files.length} categories are listed`);
  }
  const categories: InspirationCategory[] = [];
  for (const id of files.slice(0, MAX_CATEGORIES)) {
    try {
      const one = await readInspirationCategory(root, id);
      if (one !== null) categories.push(one);
    } catch (err) {
      diagnostics.push(`skipped category "${id}": ${(err as Error).message}`);
    }
  }
  return { categories, diagnostics };
}

/** Read one category, or null when it is not there. */
export async function readInspirationCategory(
  root: string,
  id: string,
): Promise<InspirationCategory | null> {
  if (!isInspirationSlug(id)) return null;
  let text: string;
  try {
    text = await readFile(categoryPath(root, id), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new InspirationPackageError(
      `category "${id}" is not valid JSON: ${(err as Error).message}`,
    );
  }
  return coerceInspirationCategory(parsed, { expectedId: id });
}

/**
 * Write the shipped categories into an empty library, once.
 *
 * **The rule is "the categories directory does not exist yet", not a marker file**, which is what
 * makes deletion stick: an admin who removes a category (or all of them) leaves the directory in
 * place, so the next boot seeds nothing. Only a library that has never had a categories directory —
 * a fresh data root — gets the three the product ships, and from that moment they are ordinary
 * files that can be renamed, reordered and deleted like any other.
 *
 * Called before every read and write of the category set rather than at boot, so a library created
 * while the server is already running is seeded too. Idempotent, and cheap: one `stat`.
 */
export async function seedInspirationCategories(root: string): Promise<void> {
  const dir = categoriesDir(root);
  try {
    await stat(dir);
    return;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  await mkdir(dir, { recursive: true });
  for (const one of SEED_INSPIRATION_CATEGORIES) {
    await writeInspirationCategory(root, { ...one });
  }
}

/**
 * Read the whole admin catalog.
 *
 * The cases come back sorted the way every list surface wants them: by the category they are
 * filed under (in category order), then by the case's own `order`, then by title. Sorting here
 * rather than in each caller means the gallery, the draft screen's folder and the search results
 * cannot disagree about what "first" means.
 *
 * This is the host's half **alone** — it does not know about the shipped catalog. Use
 * {@link mergeInspirationCatalog} to combine the two.
 */
export async function readInspirationCatalog(root: string): Promise<InspirationCatalog> {
  const categoriesRead = await readAdminCategories(root);
  const casesRead = await readAdminCases(root);
  const diagnostics = [...categoriesRead.diagnostics, ...casesRead.diagnostics];
  const known = new Set(categoriesRead.categories.map((category) => category.id));
  for (const one of casesRead.cases) {
    if (!known.has(one.categoryId)) {
      diagnostics.push(`case "${one.id}" is filed under unknown category "${one.categoryId}"`);
    }
  }
  return {
    categories: sortCategories(categoriesRead.categories),
    cases: sortCases(casesRead.cases, categoriesRead.categories),
    diagnostics,
  };
}

/** Categories in display order: `order`, then the English name as a stable tiebreak. */
export function sortCategories(categories: readonly InspirationCategory[]): InspirationCategory[] {
  return [...categories].sort(
    (a, b) => a.order - b.order || a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  );
}

/**
 * Cases in display order: the category's position, then the case's own order, then its title.
 *
 * A case whose category is not in `categories` sorts last rather than disappearing — a
 * hand-edited manifest stays reachable, and the diagnostic from the read says why.
 */
export function sortCases(
  cases: readonly InspirationCase[],
  categories: readonly InspirationCategory[],
): InspirationCase[] {
  const rank = new Map<string, number>();
  sortCategories(categories).forEach((category, index) => rank.set(category.id, index));
  const rankOf = (one: InspirationCase): number => rank.get(one.categoryId) ?? rank.size;
  return [...cases].sort(
    (a, b) =>
      rankOf(a) - rankOf(b) ||
      a.order - b.order ||
      a.title.localeCompare(b.title) ||
      a.id.localeCompare(b.id),
  );
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Write a case and its optional assets.
 *
 * The manifest is written last, and written atomically (temp file + rename): a manifest is the
 * case's identity, so a reader must never observe a half-written one, and an interrupted write
 * leaves the previous manifest in place rather than a truncated one. Assets are staged first for
 * the same reason — the rename is what publishes the case.
 */
export async function writeInspirationCase(
  root: string,
  input: InspirationCaseInput,
  meta: { createdBy: string | null; createdAt?: string | null; updatedAt: string },
): Promise<InspirationCase> {
  const normalized = coerceInspirationCaseInput(input, { expectedId: input.id });
  const dir = caseDir(root, normalized.id);
  await mkdir(dir, { recursive: true });
  if (normalized.cover.kind === "image") {
    await removeStaleCovers(root, normalized.id, normalized.cover.filename);
  } else {
    await removeStaleCovers(root, normalized.id, null);
  }
  const body = JSON.stringify(
    {
      schema: INSPIRATION_SCHEMA,
      schemaVersion: INSPIRATION_SCHEMA_VERSION,
      id: normalized.id,
      kind: normalized.kind,
      categoryId: normalized.categoryId,
      title: normalized.title,
      titleZh: normalized.titleZh,
      description: normalized.description,
      descriptionZh: normalized.descriptionZh,
      prompt: normalized.prompt,
      promptZh: normalized.promptZh,
      agentId: normalized.agentId,
      skills: normalized.skills,
      tools: normalized.tools,
      cover: normalized.cover,
      preview: normalized.previewFilename,
      featured: normalized.featured,
      order: normalized.order,
      enabled: normalized.enabled,
      createdAt: meta.createdAt ?? null,
      updatedAt: meta.updatedAt,
      createdBy: meta.createdBy,
    },
    null,
    2,
  );
  await writeAtomic(caseManifestPath(root, normalized.id), body);
  const written = await readInspirationCase(root, normalized.id);
  if (written === null) {
    throw new InspirationPackageError("case manifest disappeared after write");
  }
  return written;
}

/**
 * Replace the `preview.html` beside a case, or remove it.
 *
 * `html` is stored verbatim: the document is rendered in a sandboxed iframe with no same-origin
 * access (see the web app's detail modal), so what it may do is bounded by the sandbox rather
 * than by rewriting the author's markup here.
 */
export async function writeInspirationPreview(
  root: string,
  id: string,
  html: string | null,
): Promise<void> {
  const path = caseAssetPath(root, id, PREVIEW_FILENAME);
  if (html === null) {
    await rm(path, { force: true });
    return;
  }
  const bytes = Buffer.byteLength(html, "utf8");
  if (bytes > PREVIEW_LIMIT) {
    throw new InspirationPackageError(`preview must be at most ${PREVIEW_LIMIT} bytes`);
  }
  await mkdir(caseDir(root, id), { recursive: true });
  await writeAtomic(path, html);
}

/** Read a case's preview document, or null when it has none. */
export async function readInspirationPreview(root: string, id: string): Promise<string | null> {
  try {
    return await readFile(caseAssetPath(root, id, PREVIEW_FILENAME), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/** Write a case's cover image. Bounded, and the name must already be a legal asset filename. */
export async function writeInspirationCover(
  root: string,
  id: string,
  filename: string,
  bytes: Uint8Array,
): Promise<void> {
  if (!isAssetFilename(filename)) {
    throw new InspirationPackageError("cover filename must be a single image path segment");
  }
  if (bytes.byteLength === 0) throw new InspirationPackageError("cover image is empty");
  if (bytes.byteLength > COVER_LIMIT) {
    throw new InspirationPackageError(`cover image must be at most ${COVER_LIMIT} bytes`);
  }
  await mkdir(caseDir(root, id), { recursive: true });
  await writeFile(caseAssetPath(root, id, filename), bytes);
  await removeStaleCovers(root, id, filename);
}

/** Resolve a case's asset to a path and MIME type, or null when it is not a legal name. */
export function resolveCaseAsset(
  root: string,
  id: string,
  filename: string,
): { path: string; mimeType: string } | null {
  if (!isInspirationSlug(id) || !isAssetFilename(filename)) return null;
  const dot = filename.lastIndexOf(".");
  const mimeType = IMAGE_EXTENSIONS.get(filename.slice(dot).toLowerCase());
  if (mimeType === undefined) return null;
  return { path: caseAssetPath(root, id, filename), mimeType };
}

/** Delete a case: its manifest and every asset in its directory. */
export async function deleteInspirationCase(root: string, id: string): Promise<void> {
  if (!isInspirationSlug(id)) throw new InspirationPackageError("invalid case id");
  await rm(caseDir(root, id), { recursive: true, force: true });
}

/** Write one category. */
export async function writeInspirationCategory(
  root: string,
  input: InspirationCategory,
): Promise<InspirationCategory> {
  const normalized = coerceInspirationCategory(input, { expectedId: input.id });
  await mkdir(categoriesDir(root), { recursive: true });
  await writeAtomic(categoryPath(root, normalized.id), JSON.stringify(normalized, null, 2));
  return normalized;
}

/** Delete one category file. Cases filed under it are the caller's to deal with. */
export async function deleteInspirationCategory(root: string, id: string): Promise<void> {
  if (!isInspirationSlug(id)) throw new InspirationPackageError("invalid category id");
  await rm(categoryPath(root, id), { force: true });
}

/**
 * Delete every image in a case directory except `keep`, so replacing a cover (or dropping one for
 * a glyph) does not leave the old bytes behind for the asset route to keep serving.
 */
async function removeStaleCovers(root: string, id: string, keep: string | null): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(caseDir(root, id), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isFile() || entry.name === keep) continue;
    if (!isAssetFilename(entry.name)) continue;
    if (entry.name.length > ASSET_FILENAME_LIMIT) continue;
    await rm(join(caseDir(root, id), entry.name), { force: true });
  }
}

/**
 * Write a file by staging it beside its target and renaming over it.
 *
 * `rename` replaces an existing file on both POSIX and Windows (libuv's `MoveFileEx` carries
 * `MOVEFILE_REPLACE_EXISTING`), so a reader sees either the old bytes or the new ones.
 */
async function writeAtomic(path: string, body: string): Promise<void> {
  const temp = `${path}.tmp`;
  await writeFile(temp, body, "utf8");
  await rename(temp, path);
}

/** Re-exported so a caller can build a case from a preset without importing the schema module. */
export type { InspirationSource };
