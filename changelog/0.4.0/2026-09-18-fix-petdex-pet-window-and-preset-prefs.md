# Fix the Petdex pet window never opening and preset prefs reverting

- **Date:** 2026-09-18
- **Type:** fix
- **Scope:** `desktop`, `server`

[中文版](2026-09-18-fix-petdex-pet-window-and-preset-prefs.zh.md)

Two defects in the Petdex desktop pet were corrected: the floating pet window was never created, and a selected preset reverted to the default on the next load.

## The floating window now opens

- The preload bridge was emitted by `tsup` into the ESM build and handed to a `sandbox: true` renderer, which loads preload scripts as CommonJS only. Electron dropped it (`Cannot use import statement outside a module`), so `contextBridge.exposeInMainWorld("pet", …)` never ran and `window.pet` stayed `undefined`. The chat page's `window.pet.open()` call was never reached, so no `/pet` request was ever made and no window appeared.
- The preload is now its own CommonJS bundle, `dist/preload.cjs`, built by the new `tsup.preload.config.ts`. The package `build` script runs it as a second `tsup` invocation after the ESM build (which owns the `clean`), and `main.ts` / `pet-window.ts` load `preload.cjs` in both the main window and the pet window.
- `scripts/build-assets.mjs` now fails the build when `dist/preload.cjs` is missing or contains ESM syntax, so the entry cannot be folded back into the ESM build unnoticed.

## A selected preset survives a reload

- The server's `validatePetPrefs` nulled any `activePetId` absent from the installed catalog. The 13 builtin presets ship as web assets (`packages/web/public/pets/`) and are not in the server's catalog, so every non-default preset was rewritten to `null` by `PUT /api/me/prefs` and the pet reverted to `blue-golden` on the next load.
- The id is now retained whenever it is a string within the length bound; catalog membership is no longer enforced server-side.

## Tests

- Added server, web, and desktop unit tests covering pet prefs validation, the sprite geometry helpers, and the pet-window IPC surface.
