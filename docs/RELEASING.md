# Releasing

How a version of JiuMate reaches npm, the GitHub Release and the OSS mirror — and the one
manual step that a new package needs before any of it can be automatic.

## The shape of a release

A release is a git tag, `v<version>`, pushed to `main`. The tag drives everything:
`.github/workflows/release.yml` reads the version from the tag name, stamps it into the
packages, builds the installers, publishes the npm packages, creates the GitHub Release
with the assets, and mirrors the release to Alibaba Cloud OSS.

The repository keeps the *next* version in its `package.json` files. A release therefore
starts by bumping those files and tagging the bump — the tag's version and the repository's
version must agree, or the workflow refuses to run.

## Publishing to npm: one manual step per new package

The workflow publishes to npm through **OIDC trusted publishing**: the GitHub Actions
runner presents a signed identity token, and npm checks it against a Trusted Publisher
configured for the package. There is no token in the repository and no token to rotate.

**A Trusted Publisher can only be configured for a package that already exists on the
registry.** npm's settings page lists the packages you can point a workflow at, and a name
that was never published is not in that list. So the first publish of a new package cannot
be done by the workflow — it has nothing to authenticate against yet.

That first publish is the bootstrap step, and it is done by hand, once, with a granular
token:

```bash
# See the plan first. Publishes nothing.
sh scripts/bootstrap-npm-publish.sh --dry-run

# Publish. Needs NPM_TOKEN in the environment, or a token in ~/.npmrc.
sh scripts/bootstrap-npm-publish.sh 0.4.0
```

The script does what the workflow's `publish-npm` job does — stamps the versions, builds
every package, copies the LICENSE and the built web assets into the package directories —
and then publishes each package with `pnpm publish`, in dependency order: the plugins
first, then `agenthub`, then `core`, then `server`, then `cli`. A package whose dependency
is not on the registry yet cannot be installed by anyone, so the order is not a preference.

Two details matter:

- **`pnpm publish`, never `npm publish`.** `npm publish` keeps `workspace:*` dependencies
  unrewritten, and a published package whose dependency still says `workspace:` cannot be
  installed (`Unsupported URL Type "workspace:"`). `pnpm publish` rewrites each `workspace:`
  specifier to the version it points at.
- **The version stamp edits `package.json` files.** The shell wrapper stashes the working
  tree before it starts and restores it afterwards, so the stamp never reaches a commit. It
  refuses to run on a dirty tree rather than risk reverting work that was not its own.

### The Trusted Publisher checklist

npm has no API for Trusted Publishers — they are configured in the web interface, one
package at a time. [docs/trusted-publisher-checklist.md](../docs/trusted-publisher-checklist.md)
lists the 23 packages and the values to paste for each.

After the bootstrap publish, the token has done its job and should be revoked.

### Configuring the Trusted Publisher

On npmjs.com, for each published package: **Settings → Trusted Publisher → Add a new
trusted publisher**.

| Field | Value |
| --- | --- |
| Package | the package itself (each package gets its own) |
| Organization or user | your npm account |
| Repository owner | `qiaiqian67` |
| Repository name | `linsight` |
| Workflow filename | `release.yml` |
| Environment name | `npm` |

The environment name must match the GitHub Environment the publish job declares. A
mismatch is the most common reason a publish job fails with an authentication error after
the configuration looks right.

Once every package has a Trusted Publisher, the workflow publishes from the next tag on,
and the bootstrap script is not needed again — except for a package added later.

## The four things that stop a release

Each of these has bitten a release in this repository, and each is checked before a tag
is pushed:

1. **GitHub Actions must be able to run.** A job that cannot start because of a billing
   or spending-limit problem fails in seconds with a message about payments, not about the
   code. The whole release sits behind this.
2. **The npm scope must exist and the packages must be published.** See above.
3. **The Windows installer needs a signing key.** The desktop build wants the `EVSIGN_KEY`
   secret, and the release asks for signing on both platforms
   (`require_windows_signing: true`, `require_macos_signing: true`), so a missing key
   stops the release rather than shipping an unsigned installer. The signing identity the
   build expects is in `packages/desktop/electron-builder.yml`. The EVSign client itself is
   downloaded and signature-checked by the workflow — only the key is a secret.
4. **The OSS mirror needs its environment configured.** The `mirror-oss` job wants
   `ALIYUN_OIDC_PROVIDER_ARN`, `ALIYUN_ROLE_ARN`, `OSS_BUCKET`, `OSS_REGION`,
   `OSS_ENDPOINT` and `OSS_PUBLIC_BASE_URL` as variables on the `oss-production`
   environment.

### The secrets and variables, in one place

| Where | Name | Needed by |
| --- | --- | --- |
| `desktop-build` environment | `EVSIGN_KEY` | the Windows installer build |
| `apple-signing` environment | `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `APPLE_TEAM_ID` | the macOS matrix job |
| `oss-production` environment | `ALIYUN_OIDC_PROVIDER_ARN`, `ALIYUN_ROLE_ARN`, `OSS_BUCKET`, `OSS_REGION`, `OSS_ENDPOINT`, `OSS_PUBLIC_BASE_URL` (variables) | the OSS mirror |
| `npm` environment | nothing — the Trusted Publisher is configured on npmjs.com | the npm publish |

The `npm` environment exists but holds no secrets: trusted publishing authenticates the
runner through OIDC, so there is no token to store. An empty environment is correct, not a
gap. The same is true of the `oss-production` environment's secrets — it authenticates
through OIDC too, and what it needs are variables rather than secrets.

## Retrying

The publish steps are idempotent: a version already on the registry is skipped, so a tag
that failed part-way through can be re-run as-is after the cause is fixed. Re-run the
workflow from the Actions page, or dispatch it manually with the tag.

The same holds for the bootstrap script: it skips a package whose version is already
published, so a partial run continues where it stopped.

## Where the pieces live

| | |
| --- | --- |
| The workflow | `.github/workflows/release.yml` |
| The bootstrap script | `scripts/bootstrap-npm-publish.mjs`, wrapped by `scripts/bootstrap-npm-publish.sh` |
| The release notes | `changelog/<version>/RELEASE.md` — read by the workflow and used as the GitHub Release body |
| The changelog entries | `changelog/unreleased/`, folded into a version directory at release time |
| The bundled artifacts | `scripts/package-release-bundles.sh` |
| The OSS mirror | `scripts/publish-release-to-oss.sh` |

## Before you tag

```bash
# The version the tag will carry must be the version in the repository.
node -p 'require("./package.json").version'

# The build must pass.
pnpm typecheck
pnpm test
pnpm build
```

Then bump the version everywhere it is written — the root `package.json`,
`packages/*/package.json`, `plugins/*/package.json`, and core's `VERSION` constant — write
the release notes into `changelog/<version>/RELEASE.md`, commit, tag, and push the tag.
