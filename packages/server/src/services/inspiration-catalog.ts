/**
 * Inspiration catalog: the built-in library merged with the cases an admin authored.
 *
 * The package format and the on-disk catalog live in `@prismshadow/linsight-inspirations`; this
 * service adds the host-side concerns — anchoring the library at the data root, merging the two
 * sources, enforcing the rules that span both (a category must exist, a built-in id cannot be
 * claimed, a category in use cannot be deleted), and decoding the cover image an editor uploads.
 *
 * ## Why the two halves stay separate — for cases only
 *
 * Built-in **cases** are the product's own showcase: they ship inside the package, they have no
 * directory, and **nothing here can edit or delete one** — the same rule the built-in themes
 * follow. That is what keeps `builtinInspirationCatalog()` in the web bundle and this service's
 * answer the same list: the only thing that can differ between them is the authored half, so a
 * merge by id is a concatenation and there is no override to reason about.
 *
 * **Categories are not split at all.** They are seed data: the three the product ships are written
 * into a fresh library once (`seedInspirationCategories`) and are ordinary files from then on, so an
 * admin can rename, reorder or delete any of them. The only thing that holds one in place is that
 * cases are filed under it — a delete is refused while any case, built-in or authored, still names
 * it.
 *
 * ## What is validated where
 *
 * Field-level shape (lengths, the id charset, a cover filename's extension) is the package's
 * `coerceInspirationCaseInput`, so a hand-edited manifest and an API request are held to exactly
 * the same rules. The rules that need to see the *whole* catalog — category existence, id
 * uniqueness — are here, because only this layer holds both halves at once.
 */
import {
  CASE_MANIFEST_FILENAME,
  COVER_LIMIT,
  InspirationPackageError,
  PREVIEW_FILENAME,
  builtinInspirationCatalog,
  inspirationsDir,
  coerceInspirationCaseInput,
  coerceInspirationCategory,
  deleteInspirationCase,
  deleteInspirationCategory,
  readAdminCases,
  readAdminCategories,
  readInspirationCase,
  readInspirationPreview,
  resolveCaseAsset,
  seedInspirationCategories,
  sortCases,
  sortCategories,
  writeInspirationCase,
  writeInspirationCategory,
  writeInspirationCover,
  writeInspirationPreview,
} from "@prismshadow/linsight-inspirations";
import type {
  InspirationCase,
  InspirationCaseInput,
  InspirationCatalog,
  InspirationCategory,
} from "@prismshadow/linsight-inspirations";

/** Raised for a request the catalog refuses. The message is safe to surface to a caller. */
export class InspirationCatalogError extends Error {
  constructor(
    message: string,
    /** HTTP status the route should answer with. 400 for a bad body, 409 for a conflict. */
    readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
    this.name = "InspirationCatalogError";
  }
}

/**
 * What an editor submits.
 *
 * `body` is the case itself (the same shape a manifest carries). `cover` is the image bytes when
 * the editor uploaded one — carried separately because JSON has no place for them, and base64
 * because that is what the route's `application/json` write contract allows. `previewHtml`
 * distinguishes three intents, which is why it is not simply optional: a string writes a preview,
 * `null` removes one, and `undefined` leaves whatever is on disk alone (an update that did not
 * touch the preview must not silently drop it).
 */
export interface InspirationSaveInput {
  body: Record<string, unknown>;
  cover?: { filename: string; dataBase64: string } | undefined;
  previewHtml?: string | null | undefined;
}

/** A resolved asset: where to read it and what to call it. */
export interface InspirationAsset {
  path: string;
  mimeType: string;
}

export class InspirationCatalogService {
  constructor(private readonly root: string) {}

  /** The library directory this catalog is anchored at (used by tests and diagnostics). */
  dir(): string {
    return inspirationsDir(this.root);
  }

  /**
   * The whole catalog: the shipped cases plus the ones an admin authored.
   *
   * `includeDisabled` is the viewer's privilege, not a filter the service guesses: a disabled
   * case is one an admin parked, and only an admin is shown it. Built-in cases are never disabled.
   */
  async list(opts: { includeDisabled: boolean }): Promise<InspirationCatalog> {
    const admin = await this.readAdmin();
    const categories = sortCategories(admin.categories);
    const cases = [...builtinInspirationCatalog().cases, ...admin.cases].filter(
      (one) => one.enabled || opts.includeDisabled,
    );
    return { categories, cases: sortCases(cases, categories), diagnostics: admin.diagnostics };
  }

  /** Resolve one case by id, built-in or admin, disabled included. */
  async get(id: string): Promise<InspirationCase | null> {
    const builtin = builtinInspirationCatalog().cases.find((one) => one.id === id);
    if (builtin !== undefined) return builtin;
    return readInspirationCase(this.root, id);
  }

  /**
   * Create or replace a case.
   *
   * `id` is taken from the URL on an update and from the body on a create, and the two must agree
   * — otherwise an editor that renamed a case would silently write a second one beside the first.
   * An id that names a built-in is refused: the built-in half is not the admin's to overwrite, and
   * a shadowing admin case would make the same id mean two different things depending on which
   * surface merged them.
   */
  async save(
    input: InspirationSaveInput,
    opts: { id?: string; actor: string; now: string },
  ): Promise<InspirationCase> {
    let parsed: InspirationCaseInput;
    try {
      parsed = coerceInspirationCaseInput(input.body, {
        ...(opts.id === undefined ? {} : { expectedId: opts.id }),
      });
    } catch (err) {
      throw asCatalogError(err);
    }
    if (opts.id !== undefined && parsed.id !== opts.id) {
      throw new InspirationCatalogError(
        `the body's id "${parsed.id}" does not match the path's "${opts.id}"`,
      );
    }
    const builtinIds = new Set(builtinInspirationCatalog().cases.map((one) => one.id));
    if (builtinIds.has(parsed.id)) {
      throw new InspirationCatalogError(
        `"${parsed.id}" is a built-in case and cannot be replaced`,
        409,
      );
    }
    const existing = await readInspirationCase(this.root, parsed.id);
    if (opts.id === undefined && existing !== null) {
      throw new InspirationCatalogError(`a case with id "${parsed.id}" already exists`, 409);
    }
    await this.requireCategory(parsed.categoryId);

    const cover = await this.writeCoverIfUploaded(parsed.id, input.cover);
    const withCover: InspirationCaseInput =
      cover === null ? parsed : { ...parsed, cover: { kind: "image", ...cover } };

    // `previewFilename` is the service's to decide, not the body's: a preview exists exactly when
    // its document does, and the document is written here. An update that says nothing about the
    // preview keeps the one already on disk.
    let previewFilename = existing?.previewFilename ?? null;
    if (input.previewHtml !== undefined) {
      try {
        await writeInspirationPreview(this.root, parsed.id, input.previewHtml);
      } catch (err) {
        throw asCatalogError(err);
      }
      previewFilename = input.previewHtml === null ? null : PREVIEW_FILENAME;
    }

    try {
      return await writeInspirationCase(
        this.root,
        { ...withCover, previewFilename },
        {
          createdBy: opts.actor,
          createdAt: existing?.createdAt ?? opts.now,
          updatedAt: opts.now,
        },
      );
    } catch (err) {
      throw asCatalogError(err);
    }
  }

  /** Delete an admin case. A built-in is not the admin's to delete. */
  async remove(id: string): Promise<void> {
    const builtin = builtinInspirationCatalog().cases.find((one) => one.id === id);
    if (builtin !== undefined) {
      throw new InspirationCatalogError(`"${id}" is a built-in case and cannot be deleted`, 409);
    }
    const existing = await readInspirationCase(this.root, id);
    if (existing === null) {
      throw new InspirationCatalogError(`no case with id "${id}"`, 404);
    }
    await deleteInspirationCase(this.root, id);
  }

  /** A case's preview document, or null when it has none (or is a built-in). */
  async preview(id: string): Promise<string | null> {
    const one = await this.get(id);
    if (one === null || one.packagePath === null) return null;
    return readInspirationPreview(this.root, id);
  }

  /** A case's cover image, resolved to a readable path. Null for a built-in or a glyph cover. */
  async asset(id: string, filename: string): Promise<InspirationAsset | null> {
    const one = await this.get(id);
    if (one === null || one.packagePath === null) return null;
    return resolveCaseAsset(this.root, id, filename);
  }

  /**
   * Create or replace a category.
   *
   * Every category is the admin's, including the three the product ships — those are seed data and
   * ordinary files from the moment a library exists. Nothing here refuses an id for being
   * "built-in"; the only conflict is the path/body id agreement, which coercion checks.
   */
  async saveCategory(
    body: Record<string, unknown>,
    opts: { id?: string },
  ): Promise<InspirationCategory> {
    // Before anything else: a write is what CREATES the categories directory, and the seed's rule
    // is "the directory does not exist" — so writing first would permanently mark the library as
    // seeded and the shipped categories would never arrive.
    await this.ensureSeeded();
    let parsed: InspirationCategory;
    try {
      parsed = coerceInspirationCategoryFor(body, opts.id);
    } catch (err) {
      throw asCatalogError(err);
    }
    if (opts.id !== undefined && parsed.id !== opts.id) {
      throw new InspirationCatalogError(
        `the body's id "${parsed.id}" does not match the path's "${opts.id}"`,
      );
    }
    try {
      return await writeInspirationCategory(this.root, parsed);
    } catch (err) {
      throw asCatalogError(err);
    }
  }

  /**
   * Delete a category.
   *
   * Refused while any case still names it — shipped or authored. The alternative (reassign or
   * orphan) would either move a case the admin did not mention or leave it reachable only from the
   * "All" tab, and neither is something a delete button should decide quietly. That check is also
   * what keeps the shipped cases from being orphaned by a delete.
   */
  async removeCategory(id: string): Promise<void> {
    await this.ensureSeeded();
    const admin = await this.readAdmin();
    if (!admin.categories.some((one) => one.id === id)) {
      throw new InspirationCatalogError(`no category with id "${id}"`, 404);
    }
    const inUse = [...builtinInspirationCatalog().cases, ...admin.cases].filter(
      (one) => one.categoryId === id,
    );
    if (inUse.length > 0) {
      throw new InspirationCatalogError(
        `"${id}" still holds ${inUse.length} case${inUse.length === 1 ? "" : "s"}; move or delete them first`,
        409,
      );
    }
    await deleteInspirationCategory(this.root, id);
  }

  // ---- internals ----

  /**
   * Read the category set and the authored cases.
   *
   * Seeding happens here rather than at boot so that a library created while the server is already
   * running is seeded too, and so that every path which reads or writes a category sees the same
   * set. `seedInspirationCategories` is a `stat` on the common path.
   */
  private async readAdmin(): Promise<{
    categories: InspirationCategory[];
    cases: InspirationCase[];
    diagnostics: string[];
  }> {
    await this.ensureSeeded();
    const [categories, cases] = await Promise.all([
      readAdminCategories(this.root),
      readAdminCases(this.root),
    ]);
    return {
      categories: categories.categories,
      cases: cases.cases,
      diagnostics: [...categories.diagnostics, ...cases.diagnostics],
    };
  }

  /** Write the shipped categories into a library that has never had any. Idempotent. */
  private async ensureSeeded(): Promise<void> {
    await seedInspirationCategories(this.root);
  }

  /** A case may only be filed under a category that exists. */
  private async requireCategory(categoryId: string): Promise<void> {
    const admin = await this.readAdmin();
    const known = new Set(admin.categories.map((one) => one.id));
    if (!known.has(categoryId)) {
      throw new InspirationCatalogError(`no category with id "${categoryId}"`);
    }
  }

  /**
   * Decode and store an uploaded cover image, returning the cover it produced.
   *
   * Returns null when the request carried no image, in which case the body's own `cover` stands
   * (a glyph, or an image the case already had). The declared length is checked before decoding
   * and the decoded length after, because base64 inflates by about a third and a client can lie
   * about either number.
   */
  private async writeCoverIfUploaded(
    id: string,
    cover: { filename: string; dataBase64: string } | undefined,
  ): Promise<{ filename: string; mimeType: string } | null> {
    if (cover === undefined) return null;
    const filename = cover.filename.trim();
    if (filename === "") throw new InspirationCatalogError("cover.filename must not be empty");
    if (cover.dataBase64.length > Math.ceil((COVER_LIMIT * 4) / 3) + 1024) {
      throw new InspirationCatalogError(
        `cover image must be at most ${Math.floor(COVER_LIMIT / (1024 * 1024))}MB`,
      );
    }
    let bytes: Buffer;
    try {
      bytes = Buffer.from(cover.dataBase64, "base64");
    } catch {
      throw new InspirationCatalogError("cover.dataBase64 is not valid base64");
    }
    try {
      await writeInspirationCover(this.root, id, filename, bytes);
    } catch (err) {
      throw asCatalogError(err);
    }
    const resolved = resolveCaseAsset(this.root, id, filename);
    if (resolved === null) {
      throw new InspirationCatalogError(
        "cover.filename must be a single path segment with a known image extension",
      );
    }
    return { filename, mimeType: resolved.mimeType };
  }
}

/**
 * Category coercion, wrapped so the service can pass an optional expected id without the call
 * site having to build the context object inline twice.
 */
function coerceInspirationCategoryFor(
  body: Record<string, unknown>,
  expectedId: string | undefined,
): InspirationCategory {
  return coerceInspirationCategory(body, {
    ...(expectedId === undefined ? {} : { expectedId }),
  });
}

/** Package-level validation failures become 400s; anything else keeps its own shape. */
function asCatalogError(err: unknown): InspirationCatalogError {
  if (err instanceof InspirationCatalogError) return err;
  if (err instanceof InspirationPackageError) return new InspirationCatalogError(err.message);
  throw err;
}

/** The manifest filename a case directory holds — re-exported for route-level diagnostics. */
export const INSPIRATION_MANIFEST_FILENAME = CASE_MANIFEST_FILENAME;
