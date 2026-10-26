# The model gateway comes into the repository

- **Date:** 2026-10-23
- **Type:** refactor
- **Scope:** `core`, `cli`, `ci`

[中文版](2026-10-23-vendor-agenthub.zh.md)

The last name left in the source was `@prismshadow/agenthub` — the model gateway that core and cli depend on. It lives in another repository (`Prism-Shadow/model-message-stream-protocol`), it is published on npm under a scope this project no longer owns, and this project has pull-only access to it, so the dependency could not be renamed from where it stood.

It is now vendored: `packages/agenthub/` holds AgentHub 0.4.15, taken verbatim from the upstream repository's `v0.4.15` tag, and published as `@jiumate/agenthub` from this repository. The TypeScript source under `src/` is unmodified. The changes made to it here are confined to its own metadata and documentation — the package name, the `repository` / `bugs` / `homepage` fields, the `author` field, the dropped development-only dependencies, and two links in the tracer and playground pages that pointed at the upstream's former name. The Apache-2.0 license is reproduced in full beside the code, and `THIRD-PARTY-NOTICES.md` records where the code came from and that upstream remains the place to send fixes.

Because the package is now a workspace member, core and cli depend on it as `workspace:*` and import from `@jiumate/agenthub`. The release workflow publishes it ahead of core, for the same reason the plugin packages go first: a `workspace:*` dependency is rewritten to a version at publish time, and a version that is not on the registry cannot be installed.

## One thing the move exposed

The plugin loader used to decide what was a plugin by looking at the npm name: every dependency under `@jiumate/` was treated as one. That worked while the scope held nothing but plugins, and it stopped working the moment a library joined the scope — `@jiumate/agenthub` was being loaded as a plugin and failed the whole library. A plugin is now told apart by its `plugin.json` manifest, which is what actually distinguishes one; the scope no longer decides it.

## What this costs

Upstream fixes no longer arrive by bumping a dependency. They arrive by taking the change from `Prism-Shadow/model-message-stream-protocol` and applying it here, which means the version numbers of this package and that project no longer track each other. The upstream project is still published on npm as `@prismshadow/agenthub` and is maintained separately; the two can now diverge.

## Compatibility

The import path changed from `@prismshadow/agenthub` to `@jiumate/agenthub`, and the package moves from an npm dependency to a workspace member. Code inside this repository changed with it. Nothing outside the repository imported the gateway directly — it was an implementation detail of core's model layer — but the published `@jiumate/core` package now bundles it rather than depending on it, so a consumer installing core gets the gateway with it and needs no separate dependency.
