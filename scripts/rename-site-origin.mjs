/**
 * Moves the site's origin from the custom domain to the repository's GitHub Pages address.
 *
 * The domain is not owned any more, so every link that names it — the canonical URLs, the
 * one-line installer commands, the sitemap, the docs cross-references — has to name where
 * the site actually is. This rewrites them in place.
 *
 * The changelog is left alone. Its entries record what was true when they were written,
 * and a link in an old release note is a record of that release, not a live pointer.
 *
 * Usage:
 *   node scripts/rename-site-origin.mjs <from> <to> --dry-run  # show what would change
 *   node scripts/rename-site-origin.mjs <from> <to>            # do it
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
  console.error("usage: node scripts/rename-site-origin.mjs <from> <to> [--dry-run]");
  process.exit(1);
}

/** The files git tracks, so nothing untracked or generated is touched. */
function trackedFiles() {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" });
  return out.split("\0").filter((f) => f !== "");
}

/** Binary files are left alone: a byte that happens to match is not a link. */
function isBinary(file) {
  return fs.readFileSync(path.join(ROOT, file)).includes(0);
}

/**
 * A history of the site is not a live pointer: the changelog records what was true when
 * each entry was written, and rewriting the links in it would rewrite that history.
 */
function isHistory(file) {
  return file.startsWith("changelog/");
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
  if (isHistory(file)) continue;
  const before = fs.readFileSync(absolute, "utf8");
  const after = before.split(from).join(to);
  if (before === after) continue;
  replacements += before.split(from).length - 1;
  changed += 1;
  if (!dryRun) fs.writeFileSync(absolute, after, "utf8");
}

console.log(
  `${dryRun ? "would change" : "changed"} ${changed} files, ${replacements} replacements`,
);
if (skipped > 0) console.log(`skipped ${skipped} binary files`);
