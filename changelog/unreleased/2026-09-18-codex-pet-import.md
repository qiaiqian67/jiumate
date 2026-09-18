# Import the pets bundled with the Codex desktop app

- **Date:** 2026-09-18
- **Type:** feature
- **Scope:** `server`, `web`

[中文版](2026-09-18-codex-pet-import.zh.md)

The Codex desktop app ships its own Petdex pets inside its webpack chunks. This finds that install, reads the pets out of its `app.asar`, and offers them for review and import — the same capability OpenBitFun's Codex adapter provides.

## Discovery

- The server looks in the per-platform install locations for Codex and the ChatGPT desktop app, plus the Store/MSIX package roots read from the Windows AppModel registry. `reg.exe` is best-effort: it failing costs the MSIX paths, not the feature, and the reason is reported as a diagnostic.
- The bundle is parsed **as text and never evaluated**, and the archive is read **as a container**: running another application's bundle inside the server is not on the table. A definition whose values are built at runtime (`${…}`, an escape, a function call), an id that is not a plain slug, a sprite version this host cannot render, and two definitions claiming one id with different content are all refused rather than guessed at.
- The sprite is resolved through the bundle's own asset map, so a bundle shipping more than one generation of an atlas resolves to the current one rather than to whichever the archive lists first.
- One unreadable pet is a diagnostic; the rest of the listing still comes back.

## Review and import

- `GET /api/pets/external` lists candidates with the fingerprint they were read from, a preview URL, and the state of any earlier import: `imported`, plus `copyModified` (the installed copy has been edited since) and `sourceChanged` (the source has moved on).
- `GET /api/pets/external/:sourceKey/spritesheet` serves the atlas out of the source archive. The listing therefore stays small, and the picker crops the atlas to its first frame with the same sprite CSS the pet renders with — the server has no image decoder, so it hands over bytes rather than a thumbnail.
- `POST /api/pets/import-external` re-reads the source and refuses when it no longer hashes to the reviewed fingerprint. The fingerprint is required rather than optional here: the source is another application's file, which can be replaced between the listing and the write.
- Settings → Application gained an **Import from Codex** list with a rescan, a per-candidate status pill and an import button.

## Asar reader

- New dependency-free reader in `services/asar.ts`. `@electron/asar` is build tooling that happens to be in the tree through electron-builder; depending on it at runtime would pull a CLI, a globber and a minimatcher into the server for one directory lookup. OpenBitFun writes its own reader for the same reason.
- Electron replaces `fs` with a wrapper that reads *through* any path containing `.asar`, so opening an archive as a file fails there — with a bare `ENOENT, not found in <path>` when the file exists and `Invalid package <path>` when it does not, neither of which names the real problem. The reader switches asar support off for the duration of the read via `process.noAsar`, with the window serialized because the flag is process-wide.

## Fixes

- A freshly imported pet was reported as edited by the very next reader. The receipt's `installedFingerprint` was computed from the in-memory record, whose `spritesheetPath` carries native separators, while a re-read resolves it canonically — so the two never matched. The receipt now records what is actually on disk.
- The catalog's import tail was extracted so the folder import and the bytes-only external import share one fingerprint and one publish path; a candidate the external catalog listed and the import that follows it can no longer disagree about what "the source changed" means.

## Compatibility

- No new prefs and no data migration. An external import lands in the same catalog as a folder import and is indistinguishable from one afterwards, except that its receipt's `sourceKey` points back at the archive it came from.
