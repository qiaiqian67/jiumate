/**
 * Bootstrap-publish the @jiumate/* packages to npm, once each, by hand.
 *
 * **Why this exists.** A Trusted Publisher can only be configured for a package that already
 * exists on the registry: npm's settings page lists the packages you can point a GitHub
 * workflow at, and a name that was never published is not in that list. So a brand-new
 * package cannot be first-published by `.github/workflows/release.yml` — that job
 * authenticates through OIDC, and OIDC has nothing to authenticate against until the package
 * is there. The one-time way out is a granular access token, used once, revoked afterwards.
 *
 * This script is that one-time way. It performs the same prepare steps the release
 * workflow's `publish-npm` job performs — stamp the versions, build, copy the LICENSE and
 * the built web assets into the package directories — and then publishes each package with
 * `pnpm publish`. Once every package exists on the registry, the release workflow can be
 * pointed at them and takes over from the next tag on.
 *
 * **What it deliberately does not do.** It does not use `npm publish`: that keeps
 * `workspace:*` dependencies unrewritten, and a published package whose dependency still
 * says `workspace:` cannot be installed (`Unsupported URL Type "workspace:"`). `pnpm publish`
 * rewrites every `workspace:` specifier to the version it points at, which is what a
 * published package needs.
 *
 * **The order matters.** A package whose dependency has not been published yet cannot be
 * installed by anyone, so the packages go out in dependency order: the plugins first (core
 * depends on them), then agenthub (core depends on it), then core, then server, then cli.
 *
 * Usage:
 *   node scripts/bootstrap-npm-publish.mjs --version 0.4.0            # publish
 *   node scripts/bootstrap-npm-publish.mjs --version 0.4.0 --dry-run  # prepare and show, publish nothing
 *   node scripts/bootstrap-npm-publish.mjs --version 0.4.0 --only core
 *
 * Requires an npm token with publish rights on the @jiumate scope, either in the
 * environment (`NPM_TOKEN`) or in `~/.npmrc`. Revoke it once every package is on the
 * registry and the Trusted Publisher is configured.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SCOPE = "@jiumate";

/**
 * The packages to publish, in the order they must go out.
 *
 * A plugin is one directory under `plugins/`; the four libraries are named. The order is
 * the dependency order: everything a package depends on comes before it, because a
 * `workspace:*` dependency is rewritten to a version at publish time and a version that is
 * not on the registry yet cannot be installed.
 */
function publishPlan() {
  const pluginsDir = path.join(ROOT, "plugins");
  const plugins = fs
    .readdirSync(pluginsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join("plugins", e.name))
    .filter((dir) => fs.existsSync(path.join(ROOT, dir, "package.json")))
    .map((dir) => {
      const pkg = readPackage(path.join(ROOT, dir, "package.json"));
      return { dir, name: pkg.name };
    })
    // A plugin whose name is outside the scope is not ours to publish.
    .filter((p) => p.name.startsWith(`${SCOPE}/`))
    .sort((a, b) => a.name.localeCompare(b.name));

  return [
    ...plugins,
    ...["agenthub", "core", "server", "cli"].map((dir) => {
      const pkg = readPackage(path.join(ROOT, "packages", dir, "package.json"));
      return { dir: path.join("packages", dir), name: pkg.name };
    }),
  ];
}

/** Reads and parses a package.json, failing loudly rather than publishing a half-read one. */
function readPackage(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`Cannot read ${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Runs a command, letting its output through, and fails the script when it fails. */
function run(command, args, options = {}) {
  console.log(`\n$ ${command} ${args.join(" ")}`);
  execFileSync(command, args, {
    stdio: "inherit",
    cwd: ROOT,
    shell: process.platform === "win32",
    ...options,
  });
}

/** Runs a command and returns its trimmed output, or null when it fails. */
function capture(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      cwd: ROOT,
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/** The version a package already has on the registry, or null when it is not published. */
function publishedVersion(name) {
  const out = capture("npm", ["view", name, "version"]);
  return out && out.length > 0 ? out : null;
}

/**
 * Fails when the npm CLI is too old to publish with a token.
 *
 * npm 11.5.1 is the floor the release workflow asserts for OIDC trusted publishing, and a
 * token publish wants the same client behaviour — the registry's write path changed
 * underneath older clients. Checking here means the failure is a clear message rather than
 * a confusing 4xx from the registry.
 */
function assertNpmVersion() {
  const raw = capture("npm", ["--version"]);
  if (!raw) throw new Error("Cannot determine the npm version — is npm on PATH?");
  const [major, minor, patch] = raw.split(".").map(Number);
  if (major < 11 || (major === 11 && (minor < 5 || (minor === 5 && patch < 1)))) {
    throw new Error(`npm ${raw} is too old to publish (need >= 11.5.1). Update npm and try again.`);
  }
  return raw;
}

/**
 * The npm token to publish with, or null when there is none.
 *
 * `NPM_TOKEN` in the environment wins; otherwise `~/.npmrc` is read. The token is never
 * printed — only whether one was found.
 */
function findToken() {
  if (process.env.NPM_TOKEN && process.env.NPM_TOKEN.trim()) return "NPM_TOKEN";
  const npmrc = path.join(os.homedir(), ".npmrc");
  if (fs.existsSync(npmrc)) {
    const text = fs.readFileSync(npmrc, "utf8");
    if (text.includes("_authToken") || text.includes("//registry.npmjs.org/:_authToken"))
      return "~/.npmrc";
  }
  return null;
}

/**
 * Writes the token into a temporary `.npmrc` for the publish calls.
 *
 * npm reads `NPM_CONFIG_USERCONFIG`, so pointing it at a file that holds only the token
 * publishes under that token without touching the user's own `~/.npmrc` — and the file is
 * removed when the script ends, so the token does not outlive the run.
 */
function withTokenConfig(token, body) {
  const tmp = path.join(os.tmpdir(), `jiumate-npmrc-${process.pid}`);
  fs.writeFileSync(tmp, `//registry.npmjs.org/:_authToken=${token}\n`, { mode: 0o600 });
  const previous = process.env.NPM_CONFIG_USERCONFIG;
  process.env.NPM_CONFIG_USERCONFIG = tmp;
  try {
    body();
  } finally {
    if (previous === undefined) delete process.env.NPM_CONFIG_USERCONFIG;
    else process.env.NPM_CONFIG_USERCONFIG = previous;
    fs.rmSync(tmp, { force: true });
  }
}

/**
 * Stamps the version into every package that gets published, and into core's VERSION
 * constant.
 *
 * The release workflow does the same thing from the tag name, so a package published here
 * and one published by the workflow carry the same version — which is what makes the
 * workflow's "already on the registry, skipping" check work on a re-run.
 */
function stampVersion(version) {
  for (const dir of ["packages/agenthub", "packages/core", "packages/server", "packages/cli"]) {
    const file = path.join(ROOT, dir, "package.json");
    const pkg = readPackage(file);
    if (pkg.version === version) continue;
    run("npm", ["version", "--no-git-tag-version", "--allow-same-version", version], {
      cwd: path.join(ROOT, dir),
    });
  }
  for (const entry of fs.readdirSync(path.join(ROOT, "plugins"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(ROOT, "plugins", entry.name);
    const file = path.join(dir, "package.json");
    if (!fs.existsSync(file)) continue;
    const pkg = readPackage(file);
    if (!pkg.name?.startsWith(`${SCOPE}/`)) continue;
    if (pkg.version === version) continue;
    run("npm", ["version", "--no-git-tag-version", "--allow-same-version", version], { cwd: dir });
  }
}

/**
 * Copies the LICENSE into the package directories and the built web assets into the server
 * package — the same two steps the release workflow performs, so a package published here
 * contains what one published by the workflow would.
 */
function copyAssets() {
  const license = fs.readFileSync(path.join(ROOT, "LICENSE"));
  for (const dir of ["packages/agenthub", "packages/core", "packages/server", "packages/cli"]) {
    fs.writeFileSync(path.join(ROOT, dir, "LICENSE"), license);
  }
  for (const entry of fs.readdirSync(path.join(ROOT, "plugins"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(ROOT, "plugins", entry.name);
    if (!fs.existsSync(path.join(dir, "package.json"))) continue;
    fs.writeFileSync(path.join(dir, "LICENSE"), license);
  }
  // The server package ships the built Web UI, and an npm install serves it from there.
  const webDist = path.join(ROOT, "packages", "web", "dist");
  if (!fs.existsSync(webDist)) {
    throw new Error(
      "packages/web/dist is missing — build the web assets first (pnpm --filter @jiumate/web build).",
    );
  }
  const target = path.join(ROOT, "packages", "server", "web-dist");
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(webDist, target, { recursive: true });
}

/** Builds every package that gets published, in dependency order. */
function buildAll() {
  for (const name of ["agenthub", "core", "web", "server", "cli"]) {
    run("pnpm", ["--filter", `${SCOPE}/${name}`, "build"]);
  }
}

/** Prints what the script is about to do, without touching the registry. */
function report(plan, version, token) {
  console.log("Bootstrap publish plan\n");
  console.log(`  version: ${version}`);
  console.log(`  token:   ${token ? `found (${token})` : "NOT FOUND — publishing will fail"}`);
  console.log(`  npm:     ${capture("npm", ["--version"]) ?? "?"}`);
  console.log(`  pnpm:    ${capture("pnpm", ["--version"]) ?? "?"}`);
  console.log("");
  for (const item of plan) {
    const existing = publishedVersion(item.name);
    const state = existing === null ? "new" : `already published at ${existing}`;
    console.log(`  ${item.name.padEnd(34)} ${state}`);
  }
  console.log("");
}

function parseArgs(argv) {
  const options = { version: null, dryRun: false, only: null, skipExisting: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--version" || arg === "-v") options.version = argv[++i];
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--only") options.only = argv[++i];
    else if (arg === "--force") options.skipExisting = false;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(
      [
        "Usage: node scripts/bootstrap-npm-publish.mjs [options]",
        "",
        "  --version <v>   The version to publish. Defaults to the root package.json's version.",
        "  --dry-run       Prepare everything and print the plan; publish nothing.",
        "  --only <name>   Publish only this package (e.g. core).",
        "  --force         Publish even when the version is already on the registry.",
        "",
        "Set NPM_TOKEN, or put a token in ~/.npmrc, before running without --dry-run.",
      ].join("\n"),
    );
    return;
  }

  const rootPkg = readPackage(path.join(ROOT, "package.json"));
  const version = options.version ?? rootPkg.version;
  if (!/^\d+\.\d+\.\d+/.test(version)) {
    throw new Error(`Version must look like 1.2.3, got: ${version}`);
  }
  assertNpmVersion();

  const plan = publishPlan();
  if (options.only) {
    const only = plan.filter(
      (p) => p.name === options.only || p.name === `${SCOPE}/${options.only}`,
    );
    if (only.length === 0) throw new Error(`No package named ${options.only} in the plan.`);
    plan.length = 0;
    plan.push(...only);
  }

  const tokenSource = findToken();
  report(plan, version, tokenSource);

  if (options.dryRun) {
    console.log("Dry run — nothing was published.\n");
    console.log("Next steps when you are ready:");
    console.log("  1. node scripts/bootstrap-npm-publish.mjs --version " + version);
    console.log("  2. On npmjs.com, add each published package's Trusted Publisher:");
    console.log("     organization/user: your npm account");
    console.log("     package:           the package");
    console.log("     repository owner:  qiaiqian67");
    console.log("     repository name:   linsight");
    console.log("     workflow filename:  release.yml");
    console.log("     environment name:   npm");
    console.log("  3. Revoke the one-off token.");
    console.log("  4. Tag and push, and let the release workflow publish from then on.");
    return;
  }

  if (!tokenSource) {
    throw new Error(
      "No npm token found. Set NPM_TOKEN in the environment, or put one in ~/.npmrc, or run with --dry-run.",
    );
  }
  const token = process.env.NPM_TOKEN ?? readNpmrcToken();

  console.log("Preparing the packages…");
  stampVersion(version);
  buildAll();
  copyAssets();

  const published = [];
  const skipped = [];
  const failed = [];

  withTokenConfig(token, () => {
    for (const item of plan) {
      const existing = publishedVersion(item.name);
      if (existing === version && options.skipExisting) {
        console.log(`\n${item.name}@${version} is already on the registry, skipping.`);
        skipped.push(item.name);
        continue;
      }
      if (existing !== null && !options.force) {
        console.log(
          `\n${item.name} is already published at ${existing}. ` +
            `Publishing ${version} alongside it is what --force is for.`,
        );
        skipped.push(item.name);
        continue;
      }
      try {
        run("pnpm", ["--filter", item.name, "publish", "--access", "public", "--no-git-checks"]);
        published.push(item.name);
      } catch (err) {
        console.error(
          `\n${item.name} failed to publish: ${err instanceof Error ? err.message : String(err)}`,
        );
        failed.push(item.name);
        // A failure here usually means a dependency of this package is not on the registry
        // yet. Stop rather than publish a chain that cannot be installed.
        break;
      }
    }
  });

  console.log("\nDone.");
  if (published.length) console.log(`  published: ${published.join(", ")}`);
  if (skipped.length) console.log(`  skipped:   ${skipped.join(", ")}`);
  if (failed.length) console.log(`  failed:    ${failed.join(", ")}`);
  if (published.length) {
    console.log("\nNext: configure each published package's Trusted Publisher on npmjs.com,");
    console.log("then revoke the one-off token.");
  }
  if (failed.length) process.exitCode = 1;
}

/** Reads the token out of the user's own ~/.npmrc. */
function readNpmrcToken() {
  const npmrc = path.join(os.homedir(), ".npmrc");
  const text = fs.readFileSync(npmrc, "utf8");
  const match = text.match(/(?:_authToken|:\s*_authToken)\s*=\s*(\S+)/);
  if (!match) throw new Error("Could not read a token out of ~/.npmrc.");
  return match[1];
}

try {
  main();
} catch (err) {
  console.error(`\nerror: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}
