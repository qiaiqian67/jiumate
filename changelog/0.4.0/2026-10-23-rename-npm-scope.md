# The packages move to the @jiumate scope

- **Date:** 2026-10-23
- **Type:** refactor
- **Scope:** `core`, `server`, `web`, `cli`, `desktop`, `docs`, `landing`, `installer`, `plugins`

[中文版](2026-10-23-rename-npm-scope.zh.md)

The eleven published packages carried the name of the organisation that no longer owns them. `@prismshadow/jiumate-core` is now `@jiumate/core`; `@prismshadow/jiumate-server` is `@jiumate/server`; the same for cli, web, desktop, docs, inspirations, installer, landing, pets and skins. The nineteen plugin packages were already on `@jiumate/*`, so the two sets now sit in one scope instead of two.

The rename reaches everywhere a package name is written rather than merely mentioned: the `name` field in each `package.json`, every `import` and `type` specifier across the source, the `workspace:*` dependency edges, the `pnpm --filter` selectors in CI and in the release workflow, the npm publish loop that walks `plugins/*/` before `core`, `server` and `cli`, and the install scripts' one-line install advice.

Three things outside the scope moved with it, because they carried the same name: the desktop application's `appId` and `appUserModelId` are now `com.jiumate`, the six plugin packages' `url` field points at this repository instead of the old one, and the citation and bylines in the README and the landing blog read JiuMate.

## What did not move

`@prismshadow/agenthub` is a separate published library — the model gateway that core and cli depend on, released from another repository and already at 0.4.15 on the registry. Renaming a package that is not ours to rename would break the install, so it stays. It is the only `prismshadow` left in the source.

The changelog keeps the old names in the entries that mention them. Those entries record what was true when they were written; rewriting them would falsify the history. The only exception is this entry and its counterpart.

## A note on the release

The `@jiumate/*` names are free on the registry, which is why the move is possible at all — but a Trusted Publisher can only be configured for a package that already exists there, so each of the eleven needs a bootstrap publish before the release workflow can publish it for real. The v0.4.0 tag predates this rename, so it would publish under the old names if it ran today; the next tag carries the new ones.

## Compatibility

The published package names change, so `npm install @prismshadow/jiumate-core` stops resolving and `@jiumate/core` starts. The old names were never published, so nothing that installed them breaks — there is nothing to unpublish and no version to deprecate. Import paths inside the repository changed with the names, and no source outside the repository is affected.
