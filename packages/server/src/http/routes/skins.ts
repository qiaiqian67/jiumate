/**
 * Skin catalog REST routes.
 *
 * GET    /api/skins                     — list installed skins + diagnostics.
 * GET    /api/skins/:slug/asset/:name   — serve a declared skin asset (background / preview).
 * POST   /api/skins/import              — import a local skin folder.
 * POST   /api/skins/import/archive      — import an uploaded `.zip`.
 * DELETE /api/skins/:slug               — remove an installed skin.
 *
 * The folder import accepts either of two layouts and sniffs which one it got: our own
 * `skin.json`, or a Codex-Dream-Skin `theme.json`, which the catalog converts before
 * validating. The response carries the converter's `warnings` so the picker can say what the
 * translation left behind (an `art.taskMode`, an unknown palette key) instead of silently
 * producing a skin that looks different from the upstream screenshot.
 */
import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import { SkinPackageError, ZIP_ARCHIVE_LIMIT } from "@prismshadow/linsight-skins";
import type { AppEnv } from "../../auth/middleware.js";
import type { AppDeps } from "../../app.js";
import { readJson } from "../validate.js";
import { HttpError } from "../errors.js";

export function skinRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const catalog = deps.skinCatalog;

  app.get("/", async (c) => {
    const snapshot = await catalog.list();
    return c.json({ skins: snapshot.skins, diagnostics: snapshot.diagnostics });
  });

  app.get("/:slug/asset/:name", async (c) => {
    const found = await catalog.assetFor(c.req.param("slug"), c.req.param("name"));
    if (found === null) {
      throw new HttpError(404, "skin_asset_not_found", "Skin asset not found");
    }
    let bytes: Buffer;
    try {
      bytes = await readFile(found.path);
    } catch {
      throw new HttpError(404, "skin_asset_missing", "Skin asset is missing");
    }
    return c.body(new Uint8Array(bytes), 200, {
      "Content-Type": found.mimeType || "application/octet-stream",
      // Long-lived: an asset is content-addressed by the skin id plus its filename, and a
      // changed wallpaper arrives as a re-import under a new fingerprint rather than as new
      // bytes under the same name.
      "Cache-Control": "private, max-age=3600",
    });
  });

  app.post("/import", async (c) => {
    const body = await readJson(c);
    const path = body["path"];
    const expected = body["expectedFingerprint"];
    const mode = body["mode"];
    if (typeof path !== "string" || path.length === 0) {
      throw new HttpError(400, "invalid_skin_import", "path must be a non-empty string");
    }
    // `null` is the explicit "nothing was reviewed to verify against" a folder import sends
    // when the user picked a path rather than a listed candidate; it means the same thing as
    // an absent key. Only a non-string, non-null value is a bad request. (The pet routes
    // learned this one the hard way — requiring a string 400'd every path-based import.)
    if (expected !== undefined && expected !== null && typeof expected !== "string") {
      throw new HttpError(400, "invalid_skin_import", "expectedFingerprint must be a string");
    }
    if (mode !== undefined && mode !== null && mode !== "light" && mode !== "dark") {
      throw new HttpError(400, "invalid_skin_import", 'mode must be "light" or "dark"');
    }
    try {
      const result = await catalog.importPackage(path, {
        ...(typeof expected === "string" ? { expectedFingerprint: expected } : {}),
        ...(mode === "light" || mode === "dark" ? { mode } : {}),
      });
      return c.json({ skin: result.skin, warnings: result.warnings });
    } catch (err) {
      if (err instanceof SkinPackageError) {
        throw new HttpError(400, "invalid_skin_import", err.message);
      }
      throw err;
    }
  });

  /**
   * Import an uploaded `.zip`.
   *
   * Its own route rather than a content-type branch on `/import`, because the two requests carry
   * their parameters differently and a raw body has nowhere to put JSON. It also has no
   * `expectedFingerprint`: that field exists so the picker can assert "the source I showed you
   * has not changed since", and an upload was never shown to anyone beforehand. Idempotency
   * comes from the archive's own hash instead — see `importArchive`.
   */
  app.post("/import/archive", async (c) => {
    // Refuse on the declared length before buffering, then again on the real one: a client can
    // lie about `Content-Length`, and the second check is the one that holds.
    const declared = Number(c.req.header("content-length") ?? "");
    if (Number.isFinite(declared) && declared > ZIP_ARCHIVE_LIMIT) {
      throw new HttpError(413, "skin_archive_too_large", "Theme archive is too large");
    }
    const archive = new Uint8Array(await c.req.arrayBuffer());
    if (archive.byteLength === 0) {
      throw new HttpError(400, "invalid_skin_import", "Theme archive is empty");
    }
    if (archive.byteLength > ZIP_ARCHIVE_LIMIT) {
      throw new HttpError(413, "skin_archive_too_large", "Theme archive is too large");
    }
    try {
      const result = await catalog.importArchive(archive);
      return c.json({ skin: result.skin, warnings: result.warnings });
    } catch (err) {
      if (err instanceof SkinPackageError) {
        throw new HttpError(400, "invalid_skin_import", err.message);
      }
      throw err;
    }
  });

  app.delete("/:slug", async (c) => {
    const slug = c.req.param("slug");
    // Deliberately stricter than the pet route, which returns 204 for any slug because its
    // delete is a bare `rm -f`: there, a typo and a success are the same answer, and the
    // settings page reported "deleted" either way. Here the caller is told the truth, which
    // is the only way the UI can report one.
    const existing = await catalog.get(slug);
    if (existing === null) {
      throw new HttpError(404, "skin_not_found", "Skin not found");
    }
    try {
      await catalog.deletePackage(slug);
      return c.body(null, 204);
    } catch (err) {
      if (err instanceof SkinPackageError) {
        throw new HttpError(404, "skin_not_found", err.message);
      }
      throw err;
    }
  });

  return app;
}
