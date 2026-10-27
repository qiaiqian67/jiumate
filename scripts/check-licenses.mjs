/**
 * Fails when a production dependency carries a license this project will not ship.
 *
 * The posture is default-deny, not "block a list of known-bad licenses". A denylist only
 * catches the licenses someone already thought of, and the interesting case is always the one
 * nobody did — a dependency that quietly relicenses, or a transitive package nobody chose. So
 * the allowlist below names what may be bundled, and anything else has to be looked at and
 * added deliberately.
 *
 * Scope is production dependencies (`--prod`), because those are what ends up inside the
 * artifact a user runs. Dev-only tooling is not shipped and is not gated; the trade-off is
 * that a build-time tool under a copyleft license could in principle reach an output, which is
 * a review question rather than something a license field can answer.
 *
 * `EXCEPTIONS` exists for the cases the policy cannot decide on its own — a package whose
 * metadata is wrong, or one whose license is acceptable *because of how it is shipped* rather
 * than what it says. Every entry is printed on every run, including passing ones, so an
 * exception cannot become invisible by being green.
 *
 * Usage: node scripts/check-licenses.mjs   (wired to `pnpm check:licenses`, run by CI)
 */
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/**
 * Older packages name their license in prose rather than by SPDX identifier, and refusing them
 * would mean writing an exception for every one — which is how an allowlist turns into a list of
 * things nobody re-reads.
 *
 * Only aliases for *permissive* licenses belong here. An alias is a claim that the license is
 * the same one under a different name, so mapping anything copyleft would silently widen the
 * policy; unmapped spellings keep falling through to a refusal, which is the safe direction.
 *
 * Bare `BSD` is the interesting entry. It is ambiguous between the 2-, 3- and 4-clause variants,
 * and the ambiguity is entirely inside the permissive family — every reading is a license this
 * project ships. The map cannot resolve which one a given package meant, and does not need to.
 *
 * `LicenseRef-GUST-Font-License` is the other one worth spelling out. It is not an SPDX
 * identifier at all: it is a custom reference for the GUST Font License, which the font
 * TeX Gyre Adventor ships under. Its operative terms are the LaTeX Project Public License
 * 1.3c — or, at the reader's option, any later version — and LPPL is a permissive, source
 * -disclosure license whose obligations attach to the font file rather than to the work that
 * embeds it. A package that bundles it under Apache-2.0 for its own code is bundling
 * permissive licenses on both sides.
 */
const LEGACY_ALIASES = new Map([
  ["mit/x11", "mit"],
  ["x11", "mit"],
  ["mit license", "mit"],
  ["the mit license", "mit"],
  ["bsd", "bsd-2-clause"],
  ["bsd license", "bsd-2-clause"],
  ["bsd-2", "bsd-2-clause"],
  ["bsd-3", "bsd-3-clause"],
  ["apache 2.0", "apache-2.0"],
  ["apache-2", "apache-2.0"],
  ["apache license 2.0", "apache-2.0"],
  ["apache license, version 2.0", "apache-2.0"],
  ["isc license", "isc"],
  ["licenseref-gust-font-license", "lppl-1.3c"],
]);

/**
 * Licenses that may be bundled. Keys are SPDX identifiers, lowercased — SPDX matching is
 * case-insensitive, and pnpm reports whatever casing the package used.
 *
 * MPL-2.0 is here despite being copyleft: its obligations attach per file, so bundling an
 * unmodified dependency is fine. Modifying one of its files is not, which is a rule for a
 * reviewer rather than something this script can detect.
 *
 * OFL-1.1 and LPPL-1.3c are here for the font packages: both are permissive licenses whose
 * obligations attach to the font file itself (OFL's are a naming and reserved-name clause;
 * LPPL's are a source-disclosure clause), not to the work that embeds the font. Bundling
 * an unmodified font under either is fine.
 */
const ALLOWED = new Set([
  "0bsd",
  "apache-2.0",
  "artistic-2.0",
  "blueoak-1.0.0",
  "bsd-2-clause",
  "bsd-3-clause",
  "bsd-4-clause",
  "cc0-1.0",
  "isc",
  "lppl-1.3c",
  "mit",
  "mit-0",
  "mpl-2.0",
  "ofl-1.1",
  "openssl",
  "python-2.0",
  "unlicense",
  "unicode-dfs-2016",
  "wtfpl",
  "zlib",
]);

/**
 * Packages allowed through despite the rules above, each with the reason it is acceptable.
 * Keyed by package name; the value is the justification, and it is printed verbatim.
 *
 * Nothing goes here because it is inconvenient. An entry means the policy has been applied and
 * the answer is a deliberate exception — so the reason has to stand on its own a year later,
 * when the person reading it did not write it.
 */
const EXCEPTIONS = new Map([
  [
    "khroma",
    "Reported as `Unknown` because its package.json carries no license field; the repository " +
      "states MIT. Pulled in transitively by mermaid (the web app's diagram renderer), so it is " +
      "not a dependency anyone here chose directly.",
  ],
]);

/** pnpm prints its own progress on stderr; a failure here is about the install, not a license. */
function readProdLicenses() {
  let raw;
  try {
    // A literal command string rather than an argv array, for two reasons: Node refuses to
    // spawn a `.cmd` shim without a shell (CVE-2024-27980), and passing an args array *with*
    // `shell: true` is deprecated (DEP0190) because those arguments would only be concatenated.
    // A fixed string has no argument to escape, so neither problem arises.
    raw = execSync("pnpm licenses list --prod --json", {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    console.error("check-licenses: could not read the dependency tree via `pnpm licenses list`.");
    console.error("Run `pnpm install` first; CI does this in the shared setup action.");
    if (err?.stderr) console.error(String(err.stderr).trim());
    process.exit(2);
  }
  try {
    return JSON.parse(raw);
  } catch {
    console.error("check-licenses: `pnpm licenses list --json` did not return JSON.");
    process.exit(2);
  }
}

/**
 * Decides whether one SPDX expression permits bundling.
 *
 * A disjunction (`A OR B`) is satisfied by either side — `(MPL-2.0 OR Apache-2.0)` is the common
 * shape, and the Apache branch is a free choice. A conjunction (`A AND B`) needs both, since
 * both apply at once.
 *
 * `+` is stripped before matching: it means "or later", and it never turns a permissive license
 * into a denied one or the reverse for the identifiers in play here.
 *
 * @param {string} expression An SPDX expression as pnpm reports it.
 * @returns {boolean} True when the expression permits bundling.
 */
export function isAllowed(expression) {
  const stripped = stripWrappingParens(expression.trim());
  if (!stripped) return false;

  // Split on the operators at the top level. The parenthesised sub-expressions this leaves
  // behind are handled by the recursion, which strips its own parens on entry.
  const orParts = splitTopLevel(stripped, " OR ");
  if (orParts.length > 1) return orParts.some(isAllowed);

  const andParts = splitTopLevel(stripped, " AND ");
  if (andParts.length > 1) return andParts.every(isAllowed);

  const leaf = stripped.replace(/\+$/, "").toLowerCase();
  return ALLOWED.has(LEGACY_ALIASES.get(leaf) ?? leaf);
}

/**
 * Removes parentheses only when they wrap the *whole* expression, repeating for `((A))`.
 *
 * A regex that simply trims leading `(` and trailing `)` is wrong, and wrong in the direction
 * that lets things through: on `(MPL-2.0 OR Apache-2.0) AND GPL-3.0` it drops the opening paren
 * but not the closing one, leaving a stray `)` that makes the `OR` look like the outer operator
 * — so the expression evaluates as "Apache is fine, therefore all is fine" and a GPL conjunct
 * disappears. Whether a leading paren has a partner at the very end is the whole question, so it
 * is checked by scanning rather than by pattern.
 *
 * @param {string} expression An SPDX expression, already trimmed.
 * @returns {string} The expression with any wrapping parentheses removed.
 */
export function stripWrappingParens(expression) {
  let text = expression.trim();
  while (text.startsWith("(") && text.endsWith(")") && wrapsEntirely(text)) {
    text = text.slice(1, -1).trim();
  }
  return text;
}

/** True when the `(` at index 0 closes exactly at the final character. */
function wrapsEntirely(text) {
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "(") depth += 1;
    else if (text[i] === ")") {
      depth -= 1;
      if (depth === 0) return i === text.length - 1;
    }
  }
  return false;
}

/**
 * Splits on `operator` only where it is not inside parentheses. The expressions pnpm reports are
 * shallow, but `(A OR B) AND C` is valid SPDX and splitting it naively would read the OR as the
 * outer operator and pass a package whose C half is denied.
 *
 * @param {string} expression An SPDX expression.
 * @param {string} operator `" OR "` or `" AND "`.
 * @returns {string[]} One element when the operator is absent.
 */
export function splitTopLevel(expression, operator) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < expression.length; i += 1) {
    const ch = expression[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (depth === 0 && expression.startsWith(operator, i)) {
      parts.push(expression.slice(start, i));
      i += operator.length - 1;
      start = i + 1;
    }
  }
  parts.push(expression.slice(start));
  return parts;
}

/**
 * Applies the policy to one `pnpm licenses list` tree.
 *
 * Split out from `main` so the decision can be exercised against fixture trees without a real
 * install, and so a failing case can be reproduced without editing the dependency graph.
 *
 * @param {Record<string, Array<{ name: string, versions?: string[] }>>} byLicense Tree keyed by
 *   license, as `pnpm licenses list --prod --json` returns it.
 * @param {Map<string, string>} [exceptions] Package names allowed through, with reasons.
 * @returns {{ checked: number, offenders: Array<{ name: string, versions: string[], license: string }>, usedExceptions: Set<string> }}
 */
export function checkTree(byLicense, exceptions = EXCEPTIONS) {
  let checked = 0;
  const offenders = [];
  const usedExceptions = new Set();

  for (const [license, packages] of Object.entries(byLicense)) {
    for (const pkg of packages) {
      checked += 1;
      if (isAllowed(license)) continue;
      if (exceptions.has(pkg.name)) {
        usedExceptions.add(pkg.name);
        continue;
      }
      offenders.push({ name: pkg.name, versions: pkg.versions ?? [], license });
    }
  }

  return { checked, offenders, usedExceptions };
}

function main() {
  const { checked, offenders, usedExceptions } = checkTree(readProdLicenses());

  // Printed whether or not the check passes: an exception that only appears when something is
  // wrong is an exception nobody remembers agreeing to.
  if (usedExceptions.size > 0) {
    console.log(`check-licenses: ${usedExceptions.size} documented exception(s) in force.`);
    for (const name of usedExceptions) {
      console.log(`\n  ${name}\n    ${EXCEPTIONS.get(name).replace(/\n/g, "\n    ")}`);
    }
    console.log("");
  }

  if (offenders.length > 0) {
    console.error(
      `check-licenses: ${offenders.length} production package(s) under a license this project does not ship:\n`,
    );
    for (const o of offenders.sort((a, b) => a.name.localeCompare(b.name))) {
      console.error(`  ${o.name}@${o.versions.join(",")}  —  ${o.license}`);
    }
    console.error(
      [
        "",
        "To resolve this, in order of preference:",
        "  1. Replace the dependency with one under a permissive license (MIT, ISC, Apache-2.0, BSD).",
        "  2. If it is already permissive and the metadata is simply wrong, add it to EXCEPTIONS",
        "     in scripts/check-licenses.mjs with the reason.",
        "  3. If the license is genuinely acceptable because of how the package ships — a separate",
        "     executable invoked as a subprocess, an optional plugin a user installs themselves —",
        "     add it to EXCEPTIONS and write down why. AGPL and SSPL are not acceptable under any",
        "     of these; they are the licenses this project has ruled out.",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }

  console.log(`check-licenses: ${checked} production packages checked, all licenses permitted.`);
}

// Only when run as a command. The pure parts above are imported by the test file, and a module
// that called process.exit() on import would take the test runner down with it.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
