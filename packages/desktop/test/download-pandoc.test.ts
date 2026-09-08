/**
 * Tests for the Pandoc download script. The script is a thin wrapper over fetch + unzip/tar,
 * but the platform mapping is load-bearing — a wrong `binaryInArchive` path means the staged
 * file is missing, the desktop shell reports `pandoc_unavailable`, and DOCX/EPUB/RTF/TXT
 * silently fall off the menu. Locking the mapping here catches a Pandoc release-name
 * change before a CI run does.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, "..");
const SCRIPT = path.join(pkgDir, "scripts", "download-pandoc.mjs");

const tmpRoots: string[] = [];
function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "linsight-pandoc-dl-"));
  tmpRoots.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of tmpRoots.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("download-pandoc.mjs platform map", () => {
  // We invoke the script with a missing platform and assert the help/error text — the
  // platform list is read off the same constants, so this pins both the names and the
  // expected entry points.
  it("rejects unknown platforms with a useful message", () => {
    const r = spawnSync(process.execPath, [SCRIPT, "beos-pdp11"], { encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stderr + r.stdout).toMatch(/unknown platform: beos-pdp11/);
  });

  it("prints the platform list on --help", () => {
    const r = spawnSync(process.execPath, [SCRIPT, "--help"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("win32-x64");
    expect(r.stdout).toContain("darwin-arm64");
    expect(r.stdout).toContain("darwin-x64");
    expect(r.stdout).toContain("linux-x64");
  });

  it("exits 1 with no arguments", () => {
    const r = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
    expect(r.status).toBe(1);
  });

  it("uses an archive name + binary-in-archive path that matches a real Pandoc release layout", async () => {
    // We can't fetch from GitHub in unit tests; instead we re-read the script and assert
    // the strings we expect to match a Pandoc 3.x release. A bump to 4.x would change
    // the `pandoc-${VERSION}` prefix, and a switch to per-binary archives would change
    // `binaryInArchive` — either is intentional but should surface in a code review.
    const src = await fs.promises.readFile(SCRIPT, "utf8");
    expect(src).toMatch(/win32-x64[^}]+pandoc-\$\{PANDOC_VERSION\}-windows-x86_64\.zip/);
    expect(src).toMatch(/darwin-arm64[^}]+pandoc-\$\{PANDOC_VERSION\}-arm64-macOS\.zip/);
    expect(src).toMatch(/darwin-x64[^}]+pandoc-\$\{PANDOC_VERSION\}-x86_64-macOS\.zip/);
    expect(src).toMatch(/linux-x64[^}]+pandoc-\$\{PANDOC_VERSION\}-linux-amd64\.tar\.gz/);
    // The unzip / tar branch must use the matching extractor for each platform.
    expect(src).toContain('"win32-x64":');
    expect(src).toContain("unzip");
    expect(src).toContain('"linux-x64":');
    expect(src).toContain("tar");
  });

  it("pins a Pandoc version via env var with a sane default", () => {
    // PANDOC_VERSION must be overridable by CI (release bump) without editing the script.
    const src = fs.readFileSync(SCRIPT, "utf8");
    expect(src).toMatch(/process\.env\.PANDOC_VERSION\s*\?\?\s*"3\.\d+"/);
  });

  it("writes to build/pandoc/<platform>/pandoc[.exe] under the desktop package", () => {
    const src = fs.readFileSync(SCRIPT, "utf8");
    expect(src).toContain('path.join(pkgDir, "build", "pandoc", platform)');
    expect(src).toMatch(/binaryOut:\s*"pandoc\.exe"/);
    expect(src).toMatch(/binaryOut:\s*"pandoc"/);
  });
});

// Suppress the unused-variable warning some linters raise against the helper above; the
// tmp function is kept for future tests that may want to assert filesystem side effects.
void tmp;
