/**
 * Configure npm's trusted publishing for every @jadelau package, in one go.
 *
 * **Why this exists.** npm's settings page has a form per package: Packages → YOUR_PACKAGE →
 * Settings → Trusted Publisher, with six fields to fill in for each of the twenty-six
 * packages. That is a hundred and fifty-six fields, and a typo in any one of them means the
 * next release's publish fails with a 404 that says nothing about which field was wrong.
 *
 * `npm trust` is the same configuration from the command line, and it takes the package name
 * as an argument — so the loop below is the form, filled in once. The values are the ones the
 * release workflow uses:
 *
 *   --file      release.yml    the workflow that publishes, in .github/workflows/
 *   --repo      qiaiqian67/jiumate
 *   --env       npm            the environment the publish-npm job runs in
 *   --allow-publish            the workflow runs `pnpm publish`, so it needs this
 *
 * **What it needs.** An npm account with two-factor authentication enabled, and a granular
 * access token that can publish. The token must NOT have "bypass 2FA" enabled: npm refuses
 * trusted-publisher configuration with such a token, because the point of the configuration is
 * that the CI run proves who it is. The token goes in `NPM_TOKEN`, or in `~/.npmrc` as
 * `//registry.npmjs.org/:_authToken=...`.
 *
 * The first call asks for a 2FA code and npm offers to remember the account for five
 * minutes, which is what makes the remaining twenty-five calls bearable. There is a two-second
 * pause between calls because npm rate-limits.
 *
 * Usage:
 *   node scripts/configure-npm-trust.mjs                    # configure all of them
 *   node scripts/configure-npm-trust.mjs --only core        # just one
 *   node scripts/configure-npm-trust.mjs --dry-run          # show what would be configured
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/** The workflow that publishes, and the environment it runs in. Both are in release.yml. */
const WORKFLOW_FILE = "release.yml";
const REPOSITORY = "qiaiqian67/jiumate";
const ENVIRONMENT = "npm";

/** Pause between calls: npm rate-limits, and 26 calls in a row will trip it. */
const PAUSE_MS = 2000;

/**
 * The packages, in the order they are published.
 *
 * The order is the dependency order, and it is the same one the release workflow uses: the
 * plugins first, because core declares them as `workspace:*` dependencies; then agenthub,
 * which core also depends on; then core, server and cli. A package whose dependency is not on
 * the registry cannot be installed by anyone, so the order matters for the packages that come
 * after — not for the configuration itself, which does not care. It is kept anyway so that
 * this script and the release workflow cannot drift apart.
 */
function packages() {
  const pluginsDir = path.join(ROOT, "plugins");
  const plugins = fs
    .readdirSync(pluginsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => `@jadelau/${e.name}`)
    .sort();
  const libraries = ["agenthub", "inspirations", "pets", "skins", "core", "server", "cli"];
  return [...plugins, ...libraries.map((name) => `@jadelau/${name}`)];
}

function parseArgs(argv) {
  let only = null;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--only") {
      const value = argv[i + 1];
      if (value === undefined) throw new Error("--only requires a package name");
      only = value.startsWith("@") ? value : `@jadelau/${value}`;
      i++;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }
  return { only, dryRun };
}

/** Whether this machine has a token npm can use. */
function hasToken() {
  if (process.env.NPM_TOKEN !== undefined && process.env.NPM_TOKEN !== "") return true;
  const npmrc = path.join(process.env.USERPROFILE ?? "", ".npmrc");
  if (!fs.existsSync(npmrc)) return false;
  return /_authToken\s*=\s*\S+/.test(fs.readFileSync(npmrc, "utf8"));
}

async function main() {
  const { only, dryRun } = parseArgs(process.argv.slice(2));
  const all = packages();
  const targets = only === null ? all : all.filter((name) => name === only);
  if (targets.length === 0) {
    console.error(`no such package: ${only}`);
    console.error(`known packages: ${all.join(", ")}`);
    process.exit(1);
  }

  if (dryRun) {
    console.log(`Would configure trusted publishing for ${targets.length} package(s):\n`);
    for (const name of targets) {
      console.log(`  npm trust github ${name} \\`);
      console.log(`    --file ${WORKFLOW_FILE} --repo ${REPOSITORY} --env ${ENVIRONMENT} \\`);
      console.log(`    --allow-publish`);
    }
    console.log(`\nDry run — nothing was configured.`);
    return;
  }

  if (!hasToken()) {
    console.error("No npm token found.");
    console.error("Set NPM_TOKEN, or put one in %USERPROFILE%\\.npmrc as:");
    console.error("  //registry.npmjs.org/:_authToken=npm_...");
    console.error("");
    console.error("The token needs publish access on the @jadelau scope. It must NOT have");
    console.error('"bypass 2FA" enabled — npm refuses trusted-publisher configuration with');
    console.error("such a token, and the account must have 2FA switched on anyway.");
    process.exit(1);
  }

  let failed = 0;
  for (const [index, name] of targets.entries()) {
    console.log(`[${index + 1}/${targets.length}] ${name}`);
    try {
      execFileSync(
        "npm",
        [
          "trust",
          "github",
          name,
          "--file",
          WORKFLOW_FILE,
          "--repo",
          REPOSITORY,
          "--env",
          ENVIRONMENT,
          "--allow-publish",
          "--yes",
        ],
        { stdio: "inherit" },
      );
    } catch (err) {
      failed++;
      console.error(`  FAILED: ${name}`);
      const output = `${err?.stderr?.toString() ?? ""}${err?.stdout?.toString() ?? ""}`.trim();
      if (output !== "")
        console.error(
          output
            .split("\n")
            .slice(0, 6)
            .map((l) => `    ${l}`)
            .join("\n"),
        );
    }
    if (index < targets.length - 1) await new Promise((r) => setTimeout(r, PAUSE_MS));
  }

  console.log("");
  console.log(`Configured ${targets.length - failed} of ${targets.length}.`);
  if (failed > 0) {
    console.error(`${failed} failed.`);
    process.exit(1);
  }
}

await main();
