#!/bin/sh
# Bootstrap-publish the @jiumate/* packages to npm, once each, by hand.
#
# A Trusted Publisher can only be configured for a package that already exists on the
# registry, so a brand-new package cannot be first-published by the release workflow: that
# job authenticates through OIDC, and OIDC has nothing to authenticate against until the
# package is there. This is the one-time way out — a granular token, used once, revoked
# afterwards.
#
# The work is done by scripts/bootstrap-npm-publish.mjs, which performs the same prepare
# steps the release workflow performs (stamp the versions, build, copy the LICENSE and the
# built web assets) and then publishes each package with `pnpm publish`. This wrapper adds
# the two things a shell script does better: it refuses to run without a token in hand, and
# it leaves the working tree clean afterwards, because stamping the versions edits
# package.json files that must not be committed.
#
# Usage:
#   scripts/bootstrap-npm-publish.sh                 # publish at the repo's version
#   scripts/bootstrap-npm-publish.sh 0.4.0           # publish at a given version
#   scripts/bootstrap-npm-publish.sh --dry-run       # show the plan, publish nothing
#
# The token comes from $NPM_TOKEN or from ~/.npmrc. It is never written into the repository
# and never printed.
set -eu

ROOT_DIR="$(CDPATH= cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

VERSION="${1:-}"
DRY_RUN=0
if [ "$VERSION" = "--dry-run" ]; then
  DRY_RUN=1
  VERSION=""
fi

if [ "$DRY_RUN" -eq 0 ]; then
  if [ -z "${NPM_TOKEN:-}" ] && ! grep -q "_authToken" "$HOME/.npmrc" 2>/dev/null; then
    echo "error: no npm token found." >&2
    echo "  Set NPM_TOKEN in the environment, or put a token in ~/.npmrc." >&2
    echo "  Run with --dry-run first to see the plan." >&2
    exit 1
  fi
fi

# The version stamp rewrites package.json files in the working tree. Those edits are a
# release artefact, not a change to commit, so they are reverted afterwards — unless the
# tree was already dirty before the run, in which case the stash would carry that dirt too
# and this script refuses rather than guessing.
STASHED=0
if [ "$DRY_RUN" -eq 0 ] && [ -n "$(git status --porcelain 2>/dev/null || true)" ]; then
  echo "error: the working tree has uncommitted changes." >&2
  echo "  The version stamp rewrites package.json files and reverts them afterwards; running" >&2
  echo "  on a dirty tree risks reverting work that was not this script's." >&2
  echo "  Commit or stash first, then run this again." >&2
  exit 1
fi

if [ "$DRY_RUN" -eq 0 ]; then
  git stash push --include-untracked -m "bootstrap-npm-publish" >/dev/null 2>&1 || true
  STASHED=1
fi

cleanup() {
  if [ "$STASHED" -eq 1 ]; then
    echo
    echo "Reverting the version stamp…"
    git checkout -- . 2>/dev/null || true
    git stash pop --quiet 2>/dev/null || git stash pop 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

if [ "$DRY_RUN" -eq 1 ]; then
  node scripts/bootstrap-npm-publish.mjs --dry-run
  exit 0
fi

if [ -n "$VERSION" ]; then
  node scripts/bootstrap-npm-publish.mjs --version "$VERSION"
else
  node scripts/bootstrap-npm-publish.mjs
fi

echo
echo "Next: configure each published package's Trusted Publisher on npmjs.com"
echo "(organization: your npm account, repository: qiaiqian67/jiumate,"
echo " workflow: release.yml, environment: npm), then revoke the one-off token."
