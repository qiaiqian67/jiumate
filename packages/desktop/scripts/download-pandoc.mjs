#!/usr/bin/env node
/**
 * Download a Pandoc binary tarball/zip into packages/desktop/build/pandoc/<platform>/.
 *
 * Mirrors the MinGit step in .github/workflows/desktop-build.yml: a packaged build pulls
 * a fresh binary from the upstream release so the installer ships a known-good version;
 * a local `pnpm desktop` (dev mode) falls through to PATH (`resolvePandocPath` handles that).
 * CI calls this once per runner, then `pnpm --filter @jadelau/desktop build`
 * (specifically build-assets.mjs) copies the staged binary into dist/bin/pandoc/<platform>/,
 * which is where pandoc-path.ts looks for it.
 *
 * Usage: `node scripts/download-pandoc.mjs <platform>` where <platform> is one of
 * `win32-x64`, `darwin-arm64`, `darwin-x64`, `linux-x64`. Exit code is non-zero on any
 * download or extraction failure (the workflow surfaces the failure cleanly).
 *
 * Version pinned via PANDOC_VERSION (matches the Pandoc release tag): bump deliberately
 * when a release notes a Markdown or DOCX regression that affects users, not on autopilot.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import zlib from "node:zlib";

const PANDOC_VERSION = process.env.PANDOC_VERSION ?? "3.5";
const BASE_URL = `https://github.com/jgm/pandoc/releases/download/${PANDOC_VERSION}`;

const PLATFORMS = {
  "win32-x64": {
    asset: `pandoc-${PANDOC_VERSION}-windows-x86_64.zip`,
    /** Pandoc ships the binary as `pandoc-${VERSION}/pandoc.exe`; copy it to `pandoc.exe`. */
    binaryInArchive: `pandoc-${PANDOC_VERSION}/pandoc.exe`,
    binaryOut: "pandoc.exe",
    extract: (archive, dest) => extractZip(archive, dest),
  },
  "darwin-arm64": {
    asset: `pandoc-${PANDOC_VERSION}-arm64-macOS.zip`,
    /**
     * The macOS archives are named for the architecture, and they extract to a directory
     * of that same name — `pandoc-3.5-arm64/bin/pandoc` — while the Windows and Linux
     * archives extract to `pandoc-3.5/`. The two are not interchangeable, and a wrong
     * root here means the staged binary is simply not there.
     */
    binaryInArchive: `pandoc-${PANDOC_VERSION}-arm64/bin/pandoc`,
    binaryOut: "pandoc",
    extract: (archive, dest) => extractZip(archive, dest),
  },
  "darwin-x64": {
    asset: `pandoc-${PANDOC_VERSION}-x86_64-macOS.zip`,
    /** As above: `pandoc-3.5-x86_64/bin/pandoc`, not `pandoc-3.5/bin/pandoc`. */
    binaryInArchive: `pandoc-${PANDOC_VERSION}-x86_64/bin/pandoc`,
    binaryOut: "pandoc",
    extract: (archive, dest) => extractZip(archive, dest),
  },
  "linux-x64": {
    asset: `pandoc-${PANDOC_VERSION}-linux-amd64.tar.gz`,
    binaryInArchive: `pandoc-${PANDOC_VERSION}/bin/pandoc`,
    binaryOut: "pandoc",
    extract: (archive, dest) => extractTarGz(archive, dest),
  },
};

function extractZip(archive, dest) {
  // Node has no built-in zip; fall back to `unzip` (CI runners and macOS dev hosts both
  // have it; Linux dev hosts can `apt install unzip`).
  const r = spawnSync("unzip", ["-q", "-o", archive, "-d", dest], { stdio: "inherit" });
  if (r.status !== 0) {
    throw new Error(`unzip failed with exit code ${r.status}`);
  }
}

function extractTarGz(archive, dest) {
  const r = spawnSync("tar", ["-xzf", archive, "-C", dest], { stdio: "inherit" });
  if (r.status !== 0) {
    throw new Error(`tar failed with exit code ${r.status}`);
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Find the Pandoc binary inside an extracted archive, wherever the archive put it.
 * The archives are laid out with a versioned root directory, and its name differs per
 * platform — `pandoc-3.5/` on Windows and Linux, `pandoc-3.5-arm64/` and
 * `pandoc-3.5-x86_64/` on macOS — so the declared path is a statement of intent that
 * a Pandoc release can invalidate. This is the fallback: the deepest executable called
 * `pandoc` or `pandoc.exe`, so a renamed root costs a warning rather than a release.
 */
function findBinary(extractDir, binaryOut) {
  const wanted = binaryOut.toLowerCase();
  let best;
  const walk = (dir, depth) => {
    if (depth > 6) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (entry.name.toLowerCase() === wanted) {
        // Prefer the shallowest match, and among those the one under a `bin` directory.
        const score = depth * 10 + (path.basename(path.dirname(full)) === "bin" ? 0 : 1);
        if (best === undefined || score < best.score) best = { full, score };
      }
    }
  };
  walk(extractDir, 0);
  return best?.full;
}

/** The archive's entries, for the error message when no binary can be found at all. */
function listExtracted(extractDir) {
  const names = [];
  const walk = (dir, depth) => {
    if (depth > 3 || names.length > 20) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = path.relative(extractDir, path.join(dir, entry.name));
      names.push(entry.isDirectory() ? `${rel}/` : rel);
      if (entry.isDirectory()) walk(path.join(dir, entry.name), depth + 1);
    }
  };
  walk(extractDir, 0);
  return names.length === 0 ? "(nothing)" : names.join(", ");
}

/** Follow a single redirect: Pandoc's release URLs 302 to GitHub's S3-backed CDN. */
async function download(url, dest) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} downloading ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
}

async function stageOne(platform) {
  const cfg = PLATFORMS[platform];
  if (cfg === undefined) {
    throw new Error(
      `unknown platform: ${platform}. Expected one of: ${Object.keys(PLATFORMS).join(", ")}`,
    );
  }
  const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const outDir = path.join(pkgDir, "build", "pandoc", platform);
  ensureDir(outDir);
  const archive = path.join(outDir, cfg.asset);
  const extractDir = path.join(outDir, "extract");
  ensureDir(extractDir);

  console.log(`[download-pandoc] ${platform}: fetching ${cfg.asset}`);
  await download(`${BASE_URL}/${cfg.asset}`, archive);
  cfg.extract(archive, extractDir);

  const src = path.join(extractDir, cfg.binaryInArchive);
  const dst = path.join(outDir, cfg.binaryOut);
  if (!fs.existsSync(src)) {
    // Pandoc names the root directory of its archives after the platform, and the two
    // macOS builds do not use the same name as the Windows and Linux ones. When the
    // declared path is not there, take the binary from wherever the archive put it
    // rather than failing the build: a missing Pandoc costs the desktop shell its
    // DOCX/EPUB conversion, while a wrong path here costs the whole release.
    const found = findBinary(extractDir, cfg.binaryOut);
    if (found === undefined) {
      throw new Error(
        `expected ${src} after extraction; check binaryInArchive mapping. ` +
          `The archive contains: ${listExtracted(extractDir)}`,
      );
    }
    console.log(
      `[download-pandoc] ${platform}: ${cfg.binaryInArchive} is not in the archive; ` +
        `using ${path.relative(extractDir, found)} instead.`,
    );
    fs.copyFileSync(found, dst);
  } else {
    fs.copyFileSync(src, dst);
  }
  fs.chmodSync(dst, 0o755);

  // Best-effort cleanup: the archive is ~150MB and the extract dir is bigger.
  fs.rmSync(archive, { force: true });
  fs.rmSync(extractDir, { recursive: true, force: true });
  console.log(`[download-pandoc] ${platform}: staged ${dst}`);
}

async function main() {
  const arg = process.argv[2];
  if (arg === "--help" || arg === "-h" || arg === undefined) {
    console.log(
      `Usage: node scripts/download-pandoc.mjs <platform>\n` +
        `platforms: ${Object.keys(PLATFORMS).join(", ")}`,
    );
    process.exit(arg === undefined ? 1 : 0);
  }
  // Reference zlib so the import isn't dropped by dead-code elimination on platforms that
  // only use tar.gz (the function lives in this module on purpose for future use).
  void zlib;
  await stageOne(arg);
}

main().catch((err) => {
  console.error(`[download-pandoc] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
