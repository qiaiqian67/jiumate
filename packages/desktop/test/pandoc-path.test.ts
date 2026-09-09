/**
 * Pandoc path resolver tests — locks the lookup order that the desktop shell depends on so
 * a future reordering (or a rename of the resource directory) does not silently drop DOCX
 * / EPUB / RTF / TXT exports from a packaged build.
 *
 * Each test stages a temp directory that mirrors one of the resolution surfaces:
 *   - the packaged extraResources directory (resourcesPath/pandoc/pandoc[.exe]),
 *   - the dev staging directory (appPath/dist/bin/pandoc/pandoc[.exe]),
 *   - a fake PATH lookup root.
 *
 * The resolver only returns a path when the file is on disk; the tests assert both the
 * hit order (override > packaged > dev > PATH) and the missing-binary case.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEV_PANDOC_DIR,
  PANDOC_RESOURCE_DIR,
  pandocBinaryName,
  resolvePandocPath,
  type Resources,
} from "../src/pandoc-path.js";

const tmpRoots: string[] = [];

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "linsight-pandoc-"));
  tmpRoots.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpRoots.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function writeBin(dir: string, platform: NodeJS.Platform): string {
  // The resolver only checks existence; an empty file is sufficient and avoids spurious
  // exec warnings on hosts that respect execute bits. The empty file still satisfies
  // `fs.existsSync`.
  const binName = pandocBinaryName(platform);
  fs.mkdirSync(dir, { recursive: true });
  const binPath = path.join(dir, binName);
  fs.writeFileSync(binPath, "");
  return binPath;
}

describe("pandocBinaryName", () => {
  it("uses .exe on Windows and the bare name elsewhere", () => {
    expect(pandocBinaryName("win32")).toBe("pandoc.exe");
    expect(pandocBinaryName("darwin")).toBe("pandoc");
    expect(pandocBinaryName("linux")).toBe("pandoc");
  });
});

describe("resolvePandocPath", () => {
  let resourcesPath: string;
  let appPath: string;
  let pathEnvDir: string;

  beforeEach(() => {
    resourcesPath = tmp();
    appPath = tmp();
    pathEnvDir = tmp();
  });

  function baseOpts(platform: NodeJS.Platform = process.platform): Resources {
    return {
      isPackaged: true,
      platform,
      resourcesPath,
      appPath,
      envPath: pathEnvDir,
    };
  }

  it("returns null when nothing is staged and PATH is empty", () => {
    expect(resolvePandocPath(baseOpts())).toBeNull();
  });

  it("prefers the LINSIGHT_PANDOC override over every other source", () => {
    // Stage a binary at every other resolution surface so we can verify the override
    // wins against any of them.
    const packagedBin = writeBin(path.join(resourcesPath, PANDOC_RESOURCE_DIR), process.platform);
    writeBin(path.join(appPath, DEV_PANDOC_DIR), process.platform);
    writeBin(pathEnvDir, process.platform);

    const overrideBin = path.join(tmp(), "custom-pandoc");
    fs.writeFileSync(overrideBin, "");
    expect(resolvePandocPath({ ...baseOpts(), envOverride: overrideBin })).toBe(overrideBin);
    // Sanity check: without the override the packaged resource wins, so the override
    // is observably changing the outcome.
    expect(resolvePandocPath(baseOpts())).toBe(packagedBin);
  });

  it("drops an override that does not exist on disk and continues down the ladder", () => {
    const devBin = writeBin(path.join(appPath, DEV_PANDOC_DIR), process.platform);
    const ghost = path.join(tmp(), "never-created");
    expect(resolvePandocPath({ ...baseOpts(), envOverride: ghost })).toBe(devBin);
  });

  it("returns the packaged resource path when isPackaged and the file is present", () => {
    const packagedBin = writeBin(path.join(resourcesPath, PANDOC_RESOURCE_DIR), process.platform);
    expect(resolvePandocPath(baseOpts())).toBe(packagedBin);
  });

  it("falls through to dev staging when packaged resources are absent", () => {
    const devBin = writeBin(path.join(appPath, DEV_PANDOC_DIR), process.platform);
    expect(resolvePandocPath(baseOpts())).toBe(devBin);
  });

  it("falls through to PATH when both packaged and dev staging are absent", () => {
    const pathBin = writeBin(pathEnvDir, process.platform);
    expect(resolvePandocPath(baseOpts())).toBe(pathBin);
  });

  it("does not consult packaged resources when not running as a packaged app", () => {
    // Dev runs must not see a stale staging leak from a parallel install — the packaged
    // resource directory is for release builds only.
    const packagedDir = path.join(resourcesPath, PANDOC_RESOURCE_DIR);
    fs.mkdirSync(packagedDir, { recursive: true });
    // No file is written; the directory exists but is empty.
    const devBin = writeBin(path.join(appPath, DEV_PANDOC_DIR), process.platform);
    expect(resolvePandocPath({ ...baseOpts(), isPackaged: false })).toBe(devBin);
  });

  it("uses the platform-shaped binary name everywhere it looks", () => {
    const win32Resources = writeBin(path.join(resourcesPath, PANDOC_RESOURCE_DIR), "win32");
    expect(resolvePandocPath(baseOpts("win32"))).toBe(win32Resources);
  });

  it("skips empty PATH entries without throwing", () => {
    writeBin(path.join(appPath, DEV_PANDOC_DIR), process.platform);
    // Some shells leave a leading `:` or trailing `;`; the resolver should ignore those.
    const sep = process.platform === "win32" ? ";" : ":";
    const weirdPath = `${sep}${pathEnvDir}${sep}`;
    expect(resolvePandocPath({ ...baseOpts(), envPath: weirdPath })).toBe(
      path.join(appPath, DEV_PANDOC_DIR, pandocBinaryName(process.platform)),
    );
  });
});

describe("resource path constants", () => {
  it("pins the locations build-assets and electron-builder rely on", () => {
    // The two staging dirs are part of the build contract: build-assets.mjs writes
    // dev-mode copies to DEV_PANDOC_DIR, electron-builder.yml ships packaged copies
    // under PANDOC_RESOURCE_DIR. A rename without updating both sides silently breaks
    // DOCX/EPUB/RTF/TXT exports — fail loudly if either moves.
    expect(PANDOC_RESOURCE_DIR).toBe("pandoc");
    expect(DEV_PANDOC_DIR).toBe(path.join("dist", "bin", "pandoc"));
  });
});
