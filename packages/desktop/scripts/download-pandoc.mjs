#!/usr/bin/env node
/**
 * Download a Pandoc binary tarball/zip into packages/desktop/build/pandoc/<platform>/.
 *
 * Mirrors the MinGit step in .github/workflows/desktop-build.yml: a packaged build pulls
 * a fresh binary from the upstream release so the installer ships a known-good version;
 * a local `pnpm desktop` (dev mode) falls through to PATH (`resolvePandocPath` handles that).
 * CI calls this once per runner, then `pnpm --filter @prismshadow/jiumate-desktop build`
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
    binaryInArchive: `pandoc-${PANDOC_VERSION}/bin/pandoc`,
    binaryOut: "pandoc",
    extract: (archive, dest) => extractZip(archive, dest),
  },
  "darwin-x64": {
    asset: `pandoc-${PANDOC_VERSION}-x86_64-macOS.zip`,
    binaryInArchive: `pandoc-${PANDOC_VERSION}/bin/pandoc`,
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
    throw new Error(`expected ${src} after extraction; check binaryInArchive mapping`);
  }
  fs.copyFileSync(src, dst);
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
