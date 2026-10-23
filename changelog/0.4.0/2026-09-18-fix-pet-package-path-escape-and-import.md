# Reject a Petdex package that escapes its directory, and repair folder import and the catalog cap

- **Date:** 2026-09-18
- **Type:** fix
- **Scope:** `pets`, `server`, `web`

[中文版](2026-09-18-fix-pet-package-path-escape-and-import.zh.md)

Three defects in the Petdex pet package surface were corrected: a manifest could name a spritesheet outside its own package directory, importing a folder from Settings always failed, and the package cap reported the whole catalog as empty.

## A spritesheet path can no longer leave its package

- `coercePetPackage` rejected `..` only at the start or the end of `spritesheetPath`, so a traversal in the middle (`a/../../../etc/passwd`) passed every check and `join` then resolved it out of the package directory. `POST /api/pets/import` read the named file and installed its bytes as the pet's spritesheet, and `GET /api/pets/:slug/spritesheet` served them.
- Every segment of the path is now rejected when it is `.`, `..` or empty, wherever it appears.
- The resolved result is checked as well: the absolute spritesheet path is confirmed to sit inside the resolved package directory before it is stored, which also covers segment forms a Windows host normalises.

## Importing a folder from Settings works again

- The web picker sent `expectedFingerprint: null` when the user chose a directory, and the route rejected any non-string value with `400 invalid_pet_import`, so every import from Settings → Application failed.
- The picker now omits the key when there is nothing to verify against, and the route treats an explicit `null` as the same thing as an absent key.

## The package cap no longer empties the catalog

- `readPetCatalog` threw when the pets directory held more than `MAX_PACKAGES` entries, and `PetCatalogService.list` reports a failed read as zero pets. The directory was counted by every entry rather than by pet directories, so a few stray files were enough to hide every installed pet from the picker.
- The read now counts directories only, and truncates at the cap instead of throwing.
- `ensureRoom` reads the installed directory count from the filesystem rather than from `list()`, so the import guard no longer depends on the catalog read succeeding.

## Tests

- `packages/pets` covers a traversal in the middle of the path, a nested relative path that stays legal, a pets root holding stray files, and a directory count past the cap.
- `packages/server` covers an import body carrying an explicit `null` fingerprint.
- `packages/web` covers the import request body with and without a reviewed fingerprint.
