# Trusted Publisher checklist

npm has no REST API for Trusted Publishers — they are configured in the web interface,
one package at a time. This is the list of what to configure, with the values to paste.

**The repository** — `qiaiqian67/jiumate`
**The workflow** — `.github/workflows/release.yml`
**The environment** — `npm`

A Trusted Publisher can only be configured for a package that already exists on the
registry, so run the bootstrap publish first:

```bash
sh scripts/bootstrap-npm-publish.sh --dry-run   # see the plan
sh scripts/bootstrap-npm-publish.sh 0.4.0       # publish
```

## The packages

26 packages, in the order they were published. The order matters only for the publish
itself; the configuration is the same for each.

| # | Package |
| --- | --- |
| 1 | `@jadelau/a2ui` |
| 2 | `@jadelau/ace-rsi-toolkit` |
| 3 | `@jadelau/agent-development` |
| 4 | `@jadelau/agent-tuning` |
| 5 | `@jadelau/ape-rsi-toolkit` |
| 6 | `@jadelau/awm-rsi-toolkit` |
| 7 | `@jadelau/browser-automation` |
| 8 | `@jadelau/continual-learning` |
| 9 | `@jadelau/data-analysis` |
| 10 | `@jadelau/editable-doc` |
| 11 | `@jadelau/goal` |
| 12 | `@jadelau/humanizer` |
| 13 | `@jadelau/model-development` |
| 14 | `@jadelau/opro-rsi-toolkit` |
| 15 | `@jadelau/skill-porting` |
| 16 | `@jadelau/software-development` |
| 17 | `@jadelau/use-bento-slides` |
| 18 | `@jadelau/use-claude-code` |
| 19 | `@jadelau/use-firecrawl` |
| 20 | `@jadelau/agenthub` |
| 21 | `@jadelau/inspirations` |
| 22 | `@jadelau/pets` |
| 23 | `@jadelau/skins` |
| 24 | `@jadelau/core` |
| 25 | `@jadelau/server` |
| 26 | `@jadelau/cli` |

## What to type, for each one

On npmjs.com: the package's page → **Settings** → **Trusted Publisher** → **Add a new
trusted publisher**.

| Field | Value |
| --- | --- |
| Package | the package being configured |
| Organization or user | your npm account |
| Repository owner | `qiaiqian67` |
| Repository name | `jiumate` |
| Workflow filename | `release.yml` |
| Environment name | `npm` |

**The environment name must be `npm`.** It is the GitHub Environment the publish job
declares, and a mismatch there is the most common reason a publish job fails with an
authentication error after the configuration looks correct.

## Checking that it took

The GitHub Environment named `npm` must exist in the repository, and the publish job must
reference it by that name. Both are already true in `.github/workflows/release.yml`.

A publish that fails on authentication with a trusted publisher configured usually means
one of:

- the repository owner or name in the npm setting does not match the repository the
  workflow runs from
- the workflow filename is not `release.yml`, or is given with a path
- the environment name is not `npm`, or the job does not declare that environment
- the package in the npm setting is not the one being published

## After it works

Revoke the one-off token used for the bootstrap publish. The Trusted Publisher takes over
from the next tag on, and no token is needed again.
