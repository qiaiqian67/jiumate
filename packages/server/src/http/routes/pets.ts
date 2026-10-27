/**
 * Pet catalog REST routes.
 *
 * GET    /api/pets                    — list installed pets + diagnostics.
 * GET    /api/pets/:slug/spritesheet  — serve the installed spritesheet bytes.
 * POST   /api/pets/import             — import a local Petdex package.
 * DELETE /api/pets/:slug              — remove an installed pet.
 *
 * External sources (pets bundled inside another agent app's install):
 *
 * GET    /api/pets/external                        — discovered candidates.
 * GET    /api/pets/external/:sourceKey/spritesheet — atlas bytes for a preview.
 * POST   /api/pets/import-external                 — import a reviewed candidate.
 */
import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import { PetPackageError } from "@jadelau/pets";
import type { AppEnv } from "../../auth/middleware.js";
import type { AppDeps } from "../../app.js";
import { readJson } from "../validate.js";
import { HttpError } from "../errors.js";

export function petRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const catalog = deps.petCatalog;

  app.get("/", async (c) => {
    const snapshot = await catalog.list();
    return c.json({ pets: snapshot.pets, diagnostics: snapshot.diagnostics });
  });

  // Registered ahead of `/:slug/...`: otherwise the literal `external` segment is
  // read as a pet id and the preview request 404s as an unknown pet.
  app.get("/external", async (c) => {
    return c.json(await deps.petExternal.list());
  });

  app.get("/external/:sourceKey/spritesheet", async (c) => {
    const found = await deps.petExternal.spritesheet(c.req.param("sourceKey"));
    if (found === null) {
      throw new HttpError(404, "pet_external_not_found", "External pet not found");
    }
    return c.body(new Uint8Array(found.bytes), 200, {
      "Content-Type": found.mimeType || "application/octet-stream",
      "Cache-Control": "private, max-age=300",
    });
  });

  app.post("/import-external", async (c) => {
    const body = await readJson(c);
    const sourceKey = body["sourceKey"];
    const expected = body["expectedFingerprint"];
    if (typeof sourceKey !== "string" || sourceKey.length === 0) {
      throw new HttpError(400, "invalid_pet_import", "sourceKey must be a non-empty string");
    }
    if (typeof expected !== "string" || expected.length === 0) {
      throw new HttpError(
        400,
        "invalid_pet_import",
        "expectedFingerprint must be a non-empty string",
      );
    }
    try {
      // The fingerprint the picker reviewed is required, not optional: unlike a
      // folder import, the source is another app's file that can be replaced
      // under us between the listing and the write.
      const pet = await deps.petExternal.importCandidate(sourceKey, expected);
      return c.json({ pet });
    } catch (err) {
      if (err instanceof PetPackageError) {
        throw new HttpError(400, "invalid_pet_import", err.message);
      }
      throw err;
    }
  });

  app.get("/:slug/spritesheet", async (c) => {
    const slug = c.req.param("slug");
    const pet = await catalog.get(slug);
    if (pet === null) {
      throw new HttpError(404, "pet_not_found", "Pet not found");
    }
    let bytes: Buffer;
    try {
      bytes = await readFile(pet.spritesheetPath);
    } catch {
      throw new HttpError(404, "pet_spritesheet_missing", "Pet spritesheet is missing");
    }
    return c.body(new Uint8Array(bytes), 200, {
      "Content-Type": pet.spritesheetMimeType || "application/octet-stream",
      "Cache-Control": "private, max-age=3600",
    });
  });

  app.post("/import", async (c) => {
    const body = await readJson(c);
    const path = body["path"];
    const expected = body["expectedFingerprint"];
    if (typeof path !== "string" || path.length === 0) {
      throw new HttpError(400, "invalid_pet_import", "path must be a non-empty string");
    }
    // `null` is the explicit "nothing was reviewed to verify against" a folder import
    // sends when the user picked a path rather than a listed candidate; it means the
    // same thing as an absent key. Only a non-string, non-null value is a bad request.
    if (expected !== undefined && expected !== null && typeof expected !== "string") {
      throw new HttpError(400, "invalid_pet_import", "expectedFingerprint must be a string");
    }
    try {
      const pet = await catalog.importPackage(
        path,
        typeof expected === "string" ? expected : undefined,
      );
      return c.json({ pet });
    } catch (err) {
      if (err instanceof PetPackageError) {
        throw new HttpError(400, "invalid_pet_import", err.message);
      }
      throw err;
    }
  });

  app.delete("/:slug", async (c) => {
    const slug = c.req.param("slug");
    try {
      await catalog.deletePackage(slug);
      return c.body(null, 204);
    } catch (err) {
      if (err instanceof PetPackageError) {
        throw new HttpError(404, "pet_not_found", err.message);
      }
      throw err;
    }
  });

  return app;
}
