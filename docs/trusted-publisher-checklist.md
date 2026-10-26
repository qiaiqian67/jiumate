# Trusted Publisher checklist

npm has no REST API for Trusted Publishers — they are configured in the web interface,
one package at a time. This is the list of what to configure, with the values to paste.

**The repository** — `qiaiqian67/linsight`
**The workflow** — `.github/workflows/release.yml`
**The environment** — `npm`

A Trusted Publisher can only be configured for a package that already exists on the
registry, so run the bootstrap publish first:

```bash
sh scripts/bootstrap-npm-publish.sh --dry-run   # see the plan
sh scripts/bootstrap-npm-publish.sh 0.4.0       # publish
```

## The packages

23 packages, in the order they were published. The order matters only for the publish
itself; the configuration is the same for each.

| # | Package |
| --- | --- |
| 1 | `@jiumate/a2ui` |
| 2 | `@jiumate/ace-rsi-toolkit` |
| 3 | `@jiumate/agent-development` |
| 4 | `@jiumate/agent-tuning` |
| 5 | `@jiumate/ape-rsi-toolkit` |
| 6 | `@jiumate/awm-rsi-toolkit` |
| 7 | `@jiumate/browser-automation` |
| 8 | `@jiumate/continual-learning` |
| 9 | `@jiumate/data-analysis` |
| 10 | `@jiumate/editable-doc` |
| 11 | `@jiumate/goal` |
| 12 | `@jiumate/humanizer` |
| 13 | `@jiumate/model-development` |
| 14 | `@jiumate/opro-rsi-toolkit` |
| 15 | `@jiumate/skill-porting` |
| 16 | `@jiumate/software-development` |
| 17 | `@jiumate/use-bento-slides` |
| 18 | `@jiumate/use-claude-code` |
| 19 | `@jiumate/use-firecrawl` |
| 20 | `@jiumate/agenthub` |
| 21 | `@jiumate/core` |
| 22 | `@jiumate/server` |
| 23 | `@jiumate/cli` |

## What to type, for each one

On npmjs.com: the package's page → **Settings** → **Trusted Publisher** → **Add a new
trusted publisher**.

| Field | Value |
| --- | --- |
| Package | the package being configured |
| Organization or user | your npm account |
| Repository owner | `qiaiqian67` |
| Repository name | `linsight` |
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
