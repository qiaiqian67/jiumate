# A script for the one manual publish a new package needs

- **Date:** 2026-10-23
- **Type:** process
- **Scope:** `ci`, `tooling`

[中文版](2026-10-23-bootstrap-npm-publish.zh.md)

The release workflow publishes to npm through OIDC trusted publishing, and a Trusted Publisher can only be configured for a package that already exists on the registry — npm's settings page lists the packages a workflow can be pointed at, and a name that was never published is not in that list. So the first publish of a new package cannot be done by the workflow, and has to be done by hand with a granular token that is revoked afterwards.

That hand step was written down in a comment in the release workflow and nowhere else, which made it easy to get wrong: the order matters (a package whose dependency is not published yet cannot be installed), `npm publish` rather than `pnpm publish` produces a package that cannot be installed at all, and the version stamp edits files that must not be committed.

`scripts/bootstrap-npm-publish.mjs` performs that step. It does what the workflow's `publish-npm` job does — stamps the versions, builds every package, copies the LICENSE and the built web assets into the package directories — and then publishes each package with `pnpm publish`, in dependency order: the plugins, then `agenthub`, `inspirations`, `pets` and `skins`, then `core`, then `server`, then `cli`. A version already on the registry is skipped, so a run that failed part-way through continues where it stopped.

`scripts/bootstrap-npm-publish.sh` wraps it for a shell. It refuses to run without a token, refuses to run on a dirty working tree, and reverts the version stamp when it finishes — the stamp is a release artefact, not a change to commit.

`--dry-run` prints the plan and publishes nothing.

`docs/RELEASING.md` writes the whole thing up: what a release is, the bootstrap step and how to configure the Trusted Publisher afterwards, the four things that have to be in place before a release can succeed, and how to retry one that failed.

## Compatibility

No runtime behaviour changes. The scripts are only run by hand, and they only touch the npm registry and the working tree they are run in.
