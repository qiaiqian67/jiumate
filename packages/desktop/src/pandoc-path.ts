/**
 * Pure path resolver for the Pandoc binary the installer (or a dev run) stages.
 *
 * The desktop app exports Markdown → DOCX/EPUB/RTF/TXT through Pandoc: the server spawns it
 * as a child process once the page has serialized Markdown to HTML. The shell's job here is
 * just to hand the server a path it can spawn. Bundling rule (mirrors the `git` binary the
 * Windows installer ships under resourcesPath/git):
 *
 *   - Packaged app → `<resourcesPath>/pandoc/<bin>` where `<bin>` is platform-shaped
 *     (`pandoc.exe` on Windows, `pandoc` elsewhere).
 *   - Dev run (`pnpm desktop`, unpackaged) → `<appPath>/dist/bin/pandoc/<bin>`, the location
 *     scripts/build-assets.mjs stages platform binaries to. May be absent — the caller
 *     decides how to handle a missing file (we return `null` and let the server report
 *     `pandoc_unavailable` rather than guessing).
 *
 * Pure: no Electron, no `app.isPackaged` / `app.getAppPath()`. Callers inject those via the
 * `Resources` record so this file unit-tests under plain vitest.
 */
import path from "node:path";
import fs from "node:fs";

export interface Resources {
  /** Mirrors `app.isPackaged` — true for a release build, false for `pnpm desktop`. */
  isPackaged: boolean;
  /** Mirrors `process.platform` (`"win32" | "darwin" | "linux"`). */
  platform: NodeJS.Platform;
  /** `process.resourcesPath` — set by Electron for packaged apps. */
  resourcesPath: string | null;
  /** `app.getAppPath()` — the directory Electron resolves the app from. */
  appPath: string;
  /**
   * A PATH-like string consulted when neither packaged resources nor dev assets provide a
   * binary. Mirrors what `process.env.PATH` looks like at runtime; injected so tests don't
   * touch the host's actual environment. Multiple paths are separated by `:` on POSIX and
   * `;` on Windows.
   */
  envPath?: string;
  /** Override the location the resolver looks at — used by the dev mode and CI staging. */
  envOverride?: string | null;
}

/** The directory under resourcesPath that holds the pandoc binary. */
export const PANDOC_RESOURCE_DIR = "pandoc";
/** The directory under appPath/dist/bin that dev staging writes to. */
export const DEV_PANDOC_DIR = path.join("dist", "bin", "pandoc");

/** The binary name per platform. */
export function pandocBinaryName(platform: NodeJS.Platform): string {
  return platform === "win32" ? "pandoc.exe" : "pandoc";
}

/**
 * Returns the absolute path to the bundled pandoc binary, or `null` if no copy is on disk.
 *
 * Resolution order:
 *   1. `JIUMATE_PANDOC` env override (lets a user / smoke harness point at their own copy).
 *   2. Packaged app's extraResources (`<resourcesPath>/pandoc/<bin>`).
 *   3. Dev staging (`<appPath>/dist/bin/pandoc/<bin>`).
 *   4. PATH lookup (`<envPath dirs>/pandoc[.exe]`).
 *
 * A missing file at any step falls through to the next; the resolver only reports success
 * when the path exists on disk.
 */
export function resolvePandocPath(opts: Resources): string | null {
  const override = opts.envOverride ?? null;
  if (override !== null && override !== "") {
    if (fs.existsSync(override)) return override;
  }
  const bin = pandocBinaryName(opts.platform);

  if (opts.isPackaged && opts.resourcesPath !== null) {
    const packaged = path.join(opts.resourcesPath, PANDOC_RESOURCE_DIR, bin);
    if (fs.existsSync(packaged)) return packaged;
  }
  // Dev mode falls back to the staging dir even when isPackaged is true (smoke harness
  // running a packaged build against a working tree). Both branches share the bin name.
  const dev = path.join(opts.appPath, DEV_PANDOC_DIR, bin);
  if (fs.existsSync(dev)) return dev;

  if (opts.envPath !== undefined && opts.envPath !== "") {
    const sep = opts.platform === "win32" ? ";" : ":";
    for (const dir of opts.envPath.split(sep)) {
      if (dir === "") continue;
      const candidate = path.join(dir, bin);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}
