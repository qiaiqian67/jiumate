/**
 * Moves the npm scope from @jiumate to @jadelau.
 *
 * The scope @jiumate is taken on the registry by somebody else, so the packages move to
 * the account that owns this release. npm does not let a published name change, so this
 * is a rename of every place a package name is written, not a redirect.
 *
 * Two things in the source look like the scope and are not:
 *
 *   - `@jiumate-builtin` is the suffix on a plugin id. It is not an npm scope, and the
 *     plugin store is addressed by it, so it stays as it is.
 *   - `~/.jiumate/...` is the data root and `jiumate/` is the repository. Neither is a
 *     package name.
 *
 * So only `@jiumate/` — a scope followed by a slash — is replaced, and `@jiumate-` is
 * left alone. The bare `@jiumate` that names the scope itself is replaced too, and there
 * are two places where that is written out.
 *
 * Usage:
 *   node scripts/rename-npm-scope.mjs jiumate jadelau --dry-run  # show what would change
 *   node scripts/rename-npm-scope.mjs jiumate jadelau             # do it
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const [from, to] = args.filter((a) => !a.startsWith("--"));
if (from === undefined || to === undefined) {
  console.error("usage: node scripts/rename-npm-scope.mjs <from> <to> [--dry-run]");
  process.exit(1);
}

/** The files git tracks, so nothing untracked or generated is touched. */
function trackedFiles() {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" });
  return out.split("\0").filter((f) => f !== "");
}

/** Binary files are left alone: a byte that happens to match is not a package name. */
function isBinary(file) {
  const bytes = fs.readFileSync(path.join(ROOT, file));
  return bytes.includes(0);
}

/**
 * The replacements. The scope with a slash is a package name; the scope on its own is the
 * scope root, which two source files name.
 */
function replaceScope(text) {
  return text.split(`@${from}/`).join(`@${to}/`).split(`"@${from}"`).join(`"@${to}"`);
}

let changed = 0;
let replacements = 0;
let skipped = 0;

for (const file of trackedFiles()) {
  const absolute = path.join(ROOT, file);
  if (!fs.existsSync(absolute)) continue;
  if (isBinary(file)) {
    skipped += 1;
    continue;
  }
  const before = fs.readFileSync(absolute, "utf8");
  const after = replaceScope(before);
  if (before === after) continue;
  replacements += before.split(`@${from}/`).length - 1 + (before.split(`"@${from}"`).length - 1);
  changed += 1;
  if (!dryRun) fs.writeFileSync(absolute, after, "utf8");
}

console.log(
  `${dryRun ? "would change" : "changed"} ${changed} files, ${replacements} replacements`,
);
if (skipped > 0) console.log(`skipped ${skipped} binary files`);

// The package names have to agree with each other, so the lockfile is regenerated rather
// than edited: pnpm writes the new names itself.
if (!dryRun) {
  console.log("regenerating the lockfile...");
  execFileSync("pnpm", ["install", "--lockfile-only"], { cwd: ROOT, stdio: "inherit" });
}
