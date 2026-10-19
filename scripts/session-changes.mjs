/**
 * What this session actually did to the working tree.
 *
 * Three times in one session the agent declared a modified file "not mine, someone else must have
 * done it", and was wrong every time. The timestamps answered it in a second — all three files had
 * a modification time inside the session's own window — and that check should have been the first
 * thing run, not the last.
 *
 * The failure was not forgetting. It was answering "did I do this?" from impression when a
 * mechanical answer was one command away. So this makes the mechanical answer cheap and correct:
 *
 *   - files modified during the session window, with their timestamps
 *   - for each, what the diff actually is (a deleted BOM reads as an empty diff to `git diff`,
 *     because git normalises it out of the text view and the summary)
 *
 * Run it whenever the question "is this mine?" comes up, before answering from memory.
 *
 * Usage:
 *   node scripts/session-changes.mjs [--since <ISO timestamp>] [--minutes <n>]
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);

/** Defaults to the last six hours, which is wide enough to cover a long session and narrow enough to be readable. */
function since() {
  const i = argv.indexOf("--since");
  if (i >= 0 && argv[i + 1] !== undefined) return new Date(argv[i + 1]);
  const m = argv.indexOf("--minutes");
  const mins = m >= 0 && argv[m + 1] !== undefined ? Number(argv[m + 1]) : 360;
  return new Date(Date.now() - mins * 60_000);
}

const from = since();
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });

console.log(`工作区改动（${from.toLocaleString("zh-CN")} 之后）\n`);

// -z gives NUL-separated, unquoted paths. Without it porcelain quotes any path containing a
// non-ASCII byte or a backslash, and the leading "." of ".gitignore" gets eaten by slice(3) when
// the quoted form is longer — which produced a file literally named "gitignore".
const raw = git("status", "--porcelain", "-z");
const entries = raw.split("\0").filter((e) => e !== "");
const status = entries.length === 0 ? "" : "present";

if (status === "") {
  console.log("  工作区干净。");
} else {
  // -z yields status and path as two consecutive NUL-terminated fields for renames/copies only;
  // for ordinary entries it is "XY path" in a single field.
  for (const entry of entries) {
    const code = entry.slice(0, 2);
    const file = entry.slice(3);
    if (file === "") continue; // the path half of a rename pair, consumed below
    const renamed = code.includes("R") || code.includes("C");
    if (renamed) continue; // printed from the next field, which is the "old -> new" form

    console.log(`  ${code} ${file}`);
    const abs = join(root, file);
    let when = "";
    try {
      when = statSync(abs).mtime.toLocaleString("zh-CN");
    } catch {
      when = "(已删除)";
    }
    const inWindow = when !== "(已删除)" && new Date(when) >= from;
    console.log(`      修改时间 ${when}${inWindow ? "  ← 本次会话内" : ""}`);

    // git diff summarises a BOM removal as nothing: the byte is stripped during text conversion,
    // so the summary is empty while the file is genuinely modified. Compare bytes to see the truth.
    // Only tracked modifications have a committed counterpart. `??` files do not exist in HEAD, and
    // asking anyway makes git print a fatal that would be read as this script failing.
    const tracked = code.trim() !== "??";
    const numstat = tracked ? git("diff", "--numstat", "--", file).trim() : "";
    if (numstat !== "") {
      const [add, del] = numstat.split(/\s+/);
      console.log(`      内容改动 +${add} -${del}`);
    } else if (!tracked) {
      console.log("      新增文件（未跟踪）");
    } else {
      /*
       * git reports M with an empty diff. Two causes, and they need different answers:
       *
       *  - The file's bytes are identical and only the index stat is stale. `update-index
       *    --refresh` clears it.
       *  - `core.autocrlf=true` fighting a `.gitattributes` that says `eol=lf`. Git then reports M
       *    for files it would rewrite identically on checkout, and no refresh helps. This repo has
       *    both, so it is the expected case here rather than the unusual one.
       *
       * Distinguishing them is the point of the script: "M with no diff" reads as "someone changed
       * something I can't see", which is exactly the kind of ambiguity that produces a wrong answer
       * about who touched what.
       */
      const work = readFileSync(abs);
      const head = execFileSync("git", ["show", `HEAD:${file}`], { cwd: root, maxBuffer: 1 << 28 });
      if (work.equals(head)) {
        console.log("      字节完全相同 —— 假修改（索引 stat 过期，或 core.autocrlf 与 .gitattributes 冲突）");
        console.log(`      core.autocrlf=${git("config", "core.autocrlf").trim() || "(未设置)"}`);
      } else {
        const bom = (b) => b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf;
        if (bom(head) !== bom(work)) {
          console.log(`      仅字节序标记变化：提交时 ${bom(head) ? "有" : "无"} → 现在 ${bom(work) ? "有" : "无"}`);
        } else {
          let i = 0;
          while (i < Math.min(work.length, head.length) && work[i] === head[i]) i++;
          console.log(`      字节不同，首个差异在第 ${i} 字节（共 ${work.length} vs ${head.length}）`);
          console.log(`      HEAD  …${JSON.stringify(head.subarray(Math.max(0, i - 10), i + 10).toString())}`);
          console.log(`      工作区…${JSON.stringify(work.subarray(Math.max(0, i - 10), i + 10).toString())}`);
        }
      }
    }
    console.log("");
  }
}

/**
 * Commits made in this session, so "what did I change" can be answered from history rather than
 * from a working tree that has since been cleaned, reset or committed.
 *
 * `--since=<ISO>` rather than a rev range: an ISO timestamp contains colons, and git parses those
 * as a ref name when it appears as `A..B`. Passing it as a single `--since=` argument avoids that.
 */
const branch = git("rev-parse", "--abbrev-ref", "HEAD").trim();
const count = Number(git("rev-list", "--count", `--since=${from.toISOString()}`, "HEAD").trim() || "0");
if (count > 0) {
  console.log(`\n分支 ${branch} 上本次会话的提交：\n`);
  console.log(git("log", "--oneline", `--since=${from.toISOString()}`, "HEAD"));
}
void relative;