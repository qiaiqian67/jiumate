/**
 * electron-builder.yml extraResources for Pandoc.
 *
 * Locks the four platform entries (win / mac / linux) so a rename of the staging
 * directory or a path typo surfaces here, not as a packaged build that silently loses
 * DOCX / EPUB / RTF / TXT exports. The resolver (src/pandoc-path.ts) reads from
 * `resources/pandoc/pandoc[.exe]`; a missing `to: pandoc` mapping breaks it for
 * every installed user.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = path.join(pkgDir, "electron-builder.yml");

function loadConfig(): string {
  return fs.readFileSync(CONFIG, "utf8");
}

describe("electron-builder.yml pandoc extraResources", () => {
  it("stages win32-x64 as `to: pandoc`", () => {
    const src = loadConfig();
    expect(src).toMatch(
      /win:[\s\S]*?extraResources:[\s\S]*?build\/pandoc\/win32-x64[\s\S]*?to:\s*pandoc/,
    );
  });

  it("stages both darwin-arm64 and darwin-x64 from the matching build dir", () => {
    const src = loadConfig();
    expect(src).toMatch(/mac:[\s\S]*?extraResources:[\s\S]*?build\/pandoc\/darwin-arm64/);
    expect(src).toMatch(/build\/pandoc\/darwin-x64/);
    expect(src).toMatch(/to:\s*pandoc/);
  });

  it("stages linux-x64 as `to: pandoc`", () => {
    const src = loadConfig();
    expect(src).toMatch(
      /linux:[\s\S]*?extraResources:[\s\S]*?build\/pandoc\/linux-x64[\s\S]*?to:\s*pandoc/,
    );
  });

  it("matches the platforms the download script stages", () => {
    // A new platform added in one file must be added in both — otherwise one side picks
    // up a binary the other refuses to ship.
    const yml = loadConfig();
    const downloadScript = fs.readFileSync(
      path.join(pkgDir, "scripts", "download-pandoc.mjs"),
      "utf8",
    );
    for (const plat of ["win32-x64", "darwin-arm64", "darwin-x64", "linux-x64"]) {
      expect(downloadScript).toContain(plat);
      // electron-builder.yml references every platform's staging dir literally:
      // darwin-arm64 and darwin-x64 are two separate extraResources entries so each
      // pandoc binary lands under resources/pandoc/pandoc on its own arch.
      expect(yml).toContain(`build/pandoc/${plat}`);
    }
  });
});

describe("pandoc staging directories exist with a .gitkeep", () => {
  // electron-builder trips when an extraResources `from:` directory is missing; the
  // .gitkeep markers (one per platform) keep local non-CI builds happy.
  const platforms = ["win32-x64", "darwin-arm64", "darwin-x64", "linux-x64"];
  for (const plat of platforms) {
    it(`build/pandoc/${plat}/ has a marker so electron-builder does not trip`, () => {
      const dir = path.join(pkgDir, "build", "pandoc", plat);
      // Either the dir has the downloaded pandoc binary, or it has a .gitkeep marker.
      // electron-builder is happy with either; what it rejects is the absent directory.
      expect(fs.existsSync(dir)).toBe(true);
      const hasBinary =
        fs.existsSync(path.join(dir, "pandoc.exe")) || fs.existsSync(path.join(dir, "pandoc"));
      const hasGitkeep = fs.existsSync(path.join(dir, ".gitkeep"));
      expect(hasBinary || hasGitkeep).toBe(true);
    });
  }
});
