/**
 * Inspiration library REST routes.
 *
 *   GET    /api/inspirations                        — the whole catalog: categories, cases, diagnostics.
 *   GET    /api/inspirations/:id/preview            — a case's preview document (HTML).
 *   GET    /api/inspirations/:id/asset/:name        — a case's cover image.
 *   POST   /api/inspirations/cases                  — create a case (admin).
 *   PUT    /api/inspirations/cases/:id              — replace a case (admin).
 *   DELETE /api/inspirations/cases/:id              — delete a case (admin).
 *   POST   /api/inspirations/categories             — create a category (admin).
 *   PUT    /api/inspirations/categories/:id         — replace a category (admin).
 *   DELETE /api/inspirations/categories/:id         — delete a category (admin).
 *
 * Reads are open to every signed-in user — the library is the product's own showcase plus
 * whatever the admins published — and only the writes are admin-gated, with the same 403 shape
 * the admin user routes use. Unlike those routes this surface is deliberately available in
 * desktop mode: the built-in half is read-only content that the single desktop user benefits from
 * exactly as much as a server user does, and there is no other account for an "admin" to be.
 *
 * The two asset routes are read-only and named by a validated single path segment (the package's
 * `isAssetFilename`), which is what keeps a crafted name from walking out of the case directory.
 * They sit under `/api` and therefore behind the session cookie, unlike the workspace preview
 * route: a case's cover is content the library owns, not a sandbox the user opened.
 */
import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import type { InspirationCatalogResponse, InspirationCaseResponse } from "../../api/types.js";
import { HttpError } from "../errors.js";
import type { AppEnv } from "../../auth/middleware.js";
import { readJson, requireString } from "../validate.js";
import type { AppDeps } from "../../app.js";
import {
  InspirationCatalogError,
  type InspirationCatalogService,
} from "../../services/inspiration-catalog.js";

/** Admin gate for the write half: the same 403 body `adminUsersRoutes` answers with. */
function requireAdmin(isAdmin: boolean): void {
  if (!isAdmin) {
    throw new HttpError(403, "admin_required", "Only an admin can perform this operation.");
  }
}

/** A catalog refusal becomes the HTTP status it declared. */
function rethrow(err: unknown): never {
  if (err instanceof InspirationCatalogError) {
    const code =
      err.status === 404
        ? "inspiration_not_found"
        : err.status === 409
          ? "inspiration_conflict"
          : "invalid_inspiration";
    throw new HttpError(err.status, code, err.message);
  }
  throw err;
}

/**
 * Read the `coverUpload` block off a create/update body, if present.
 *
 * A separate block from the case's own `cover` field: `cover` says what the case should *show*
 * (a glyph, or a file already on disk), and this carries new bytes. Sending both is legal and the
 * bytes win — that is what "upload a replacement image" means.
 */
function coverUploadFrom(
  body: Record<string, unknown>,
): { filename: string; dataBase64: string } | undefined {
  const raw = body["coverUpload"];
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new HttpError(400, "invalid_inspiration", "coverUpload must be an object.");
  }
  const record = raw as Record<string, unknown>;
  return {
    filename: requireString(record, "filename", { label: "coverUpload.filename" }),
    dataBase64: requireString(record, "dataBase64", { label: "coverUpload.dataBase64" }),
  };
}

/**
 * Read `previewHtml` off a create/update body, distinguishing its three intents.
 *
 * Absent means "leave the preview alone" and `null` means "remove it" — an update that never
 * mentions the preview must not drop one, and a body cannot express "remove" by omission.
 */
function previewHtmlFrom(body: Record<string, unknown>): string | null | undefined {
  const raw = body["previewHtml"];
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== "string") {
    throw new HttpError(400, "invalid_inspiration", "previewHtml must be a string or null.");
  }
  return raw;
}

export function inspirationRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const catalog: InspirationCatalogService = deps.inspirationCatalog;

  app.get("/", async (c) => {
    const snapshot = await catalog.list({ includeDisabled: c.var.user.isAdmin });
    return c.json({
      categories: snapshot.categories,
      cases: snapshot.cases,
      diagnostics: snapshot.diagnostics,
      canManage: c.var.user.isAdmin,
    } satisfies InspirationCatalogResponse);
  });

  app.get("/:id/preview", async (c) => {
    const html = await catalog.preview(c.req.param("id"));
    if (html === null) {
      throw new HttpError(404, "inspiration_preview_missing", "This case has no preview.");
    }
    // `text/html` is the point: the web app renders this in a sandboxed iframe. The sandbox, not
    // this header, is what bounds what the document may do — see the detail modal.
    return c.body(html, 200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, max-age=60",
    });
  });

  app.get("/:id/asset/:name", async (c) => {
    const found = await catalog.asset(c.req.param("id"), c.req.param("name"));
    if (found === null) {
      throw new HttpError(404, "inspiration_asset_not_found", "Cover image not found.");
    }
    let bytes: Buffer;
    try {
      bytes = await readFile(found.path);
    } catch {
      throw new HttpError(404, "inspiration_asset_missing", "Cover image is missing.");
    }
    return c.body(new Uint8Array(bytes), 200, {
      "Content-Type": found.mimeType,
      "Cache-Control": "private, max-age=300",
    });
  });

  app.post("/cases", async (c) => {
    requireAdmin(c.var.user.isAdmin);
    const body = await readJson(c);
    try {
      const one = await catalog.save(
        { body, cover: coverUploadFrom(body), previewHtml: previewHtmlFrom(body) },
        { actor: c.var.user.userId, now: new Date().toISOString() },
      );
      return c.json({ case: one } satisfies InspirationCaseResponse, 201);
    } catch (err) {
      rethrow(err);
    }
  });

  app.put("/cases/:id", async (c) => {
    requireAdmin(c.var.user.isAdmin);
    const id = c.req.param("id");
    const body = await readJson(c);
    try {
      const one = await catalog.save(
        { body, cover: coverUploadFrom(body), previewHtml: previewHtmlFrom(body) },
        { id, actor: c.var.user.userId, now: new Date().toISOString() },
      );
      return c.json({ case: one } satisfies InspirationCaseResponse);
    } catch (err) {
      rethrow(err);
    }
  });

  app.delete("/cases/:id", async (c) => {
    requireAdmin(c.var.user.isAdmin);
    try {
      await catalog.remove(c.req.param("id"));
      return c.body(null, 204);
    } catch (err) {
      rethrow(err);
    }
  });

  app.post("/categories", async (c) => {
    requireAdmin(c.var.user.isAdmin);
    const body = await readJson(c);
    try {
      const category = await catalog.saveCategory(body, {});
      return c.json({ category }, 201);
    } catch (err) {
      rethrow(err);
    }
  });

  app.put("/categories/:id", async (c) => {
    requireAdmin(c.var.user.isAdmin);
    const id = c.req.param("id");
    const body = await readJson(c);
    try {
      const category = await catalog.saveCategory(body, { id });
      return c.json({ category });
    } catch (err) {
      rethrow(err);
    }
  });

  app.delete("/categories/:id", async (c) => {
    requireAdmin(c.var.user.isAdmin);
    try {
      await catalog.removeCategory(c.req.param("id"));
      return c.body(null, 204);
    } catch (err) {
      rethrow(err);
    }
  });

  return app;
}
