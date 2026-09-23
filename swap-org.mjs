/**
 * Swap the GitHub org on every reference, without touching look-alikes.
 *
 * Three things in this repo contain the old org's name but are NOT GitHub references, and a
 * blanket string replace would corrupt all three: the npm scope `@prismshadow/*` (972 uses, a
 * published package name), the maintainer address `zheng@prismshadow.com`, and the GitHub Pages
 * site `prism-shadow.github.io/GDPevo` — which the user asked to leave alone.
 *
 * So the replacement is case-sensitive on `Prism-Shadow` only, which is the exact casing all 1224
 * GitHub references use, and the lowercase `prism-shadow` of the Pages URL never matches.
 *
 * The old repo name is also folded in, longest pattern first: `Prism-Shadow/penguin-harness-design`
 * has to be rewritten before `Prism-Shadow/penguin-harness`, or the first becomes `linsight-design`
 * by accident rather than by rule.
 *
 * Deliberately out of scope: the 19 places that say `penguin-harness` without a `Prism-Shadow/`
 * prefix. Those name skill directories (`.agents/skills/penguin-harness-dev/`), a blog slug
 * (`free-models-in-penguin-harness`), and — in `2026-09-07-brand-rename-to-linsight.md` — the
 * rename script's own rules. Rewriting those would falsify history, so they are reported, not
 * changed.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const RULES = [
  ["Prism-Shadow/penguin-harness-design", "qiaiqian67/linsight-design"],
  ["Prism-Shadow/penguin-harness-community", "qiaiqian67/linsight-community"],
  ["Prism-Shadow/penguin-harness", "qiaiqian67/linsight"],
  ["Prism-Shadow", "qiaiqian67"],
];

const files = execFileSync("git", ["grep", "-l", "-F", "Prism-Shadow"], {
  encoding: "utf8",
})
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean);

let changed = 0;
const counts = new Map();
for (const file of files) {
  const before = readFileSync(file, "utf8");
  let after = before;
  for (const [from, to] of RULES) {
    const hits = after.split(from).length - 1;
    if (hits > 0) {
      counts.set(from, (counts.get(from) ?? 0) + hits);
      after = after.split(from).join(to);
    }
  }
  if (after !== before) {
    writeFileSync(file, after, "utf8");
    changed += 1;
  }
}

console.log(`改了 ${changed} / ${files.length} 个文件`);
for (const [from, n] of [...counts].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${from.padEnd(38)} -> ${n}`);
}
