/**
 * Builds the installer app.
 *
 * Three jobs, in order:
 *
 *  1. Stage the sources into dist/ — main and preload are already CommonJS and run under Node
 *     inside Electron, so they are copied rather than bundled. Only the payload is built.
 *  2. Pack `packages/desktop/out/win-unpacked` into payload.7z. It goes in as an archive on
 *     purpose: expanded it is ~466 MB, and an installer that left a second expanded copy of the
 *     application on the user's disk would be a poor trade for saving one archive.
 *  3. Write meta.json, because the window shows a size and a version and both must come from what
 *     actually shipped rather than from constants in the UI.
 */
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, "..", "..")
const desktopPkg = path.join(repoRoot, "packages", "desktop")
const unpacked = path.join(desktopPkg, "out", "win-unpacked")
const dist = path.join(here, "dist")
const payload = path.join(dist, "payload.7z")

const pkg = JSON.parse(fs.readFileSync(path.join(here, "package.json"), "utf8"))

function find7za() {
  const cacheRoot = path.join(process.env.LOCALAPPDATA || "", "electron-builder", "Cache")
  const stack = [cacheRoot]
  while (stack.length) {
    const dir = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) stack.push(full)
      else if (e.name === "7za.exe") return full
    }
  }
  throw new Error(
    "7za.exe not found under the electron-builder cache. Run a desktop pack once (pnpm --dir packages/desktop pack:win) so electron-builder downloads it.",
  )
}

function dirSize(dir) {
  let total = 0
  const stack = [dir]
  while (stack.length) {
    const d = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) stack.push(full)
      else {
        try {
          total += fs.statSync(full).size
        } catch {
          // A file that vanished mid-walk is not worth failing the build over.
        }
      }
    }
  }
  return total
}

/**
 * Refuse to build an installer whose payload is older than the sources it is supposed to contain.
 *
 * ## Why this exists
 *
 * The payload is `packages/desktop/out/win-unpacked`, which is produced by a *separate* command
 * (`pnpm --dir packages/desktop pack:win`) from `pnpm -r build`. Nothing in the normal build chain
 * connects the two, so it is entirely possible — and happened — to build the desktop app, edit
 * three files, run the installer build, and ship an installer carrying the *previous* build.
 *
 * The failure is silent and it looks like a bug in the product: the app launches, the code is
 * subtly the old behaviour, and every symptom is something a user would report as "this feature
 * does not work". In this repository's case the shipped payload predated the entire
 * setup-import feature, so a language, a theme and a model chosen in the installer had no effect at
 * all — and the obvious conclusion ("the importer is broken") was wrong, because the importer was
 * not in the artifact. Chasing that inside the code would have found nothing.
 *
 * So the check is here rather than in a checklist: the newest source file under the desktop
 * package (and core, which it bundles) must not be newer than the payload directory. That is the
 * one condition under which the artifact is definitely wrong, so it is the one worth failing on.
 * An override exists for the case where someone genuinely needs the old payload.
 */
function newestSourceMtime(dir) {
  const stack = [dir]
  let newest = 0
  let newestFile = ""
  while (stack.length) {
    const d = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      // Skip build output and dependencies: their timestamps move for reasons that have nothing to
      // do with the sources, and node_modules alone would always look newer than any artifact.
      if (e.name === "node_modules" || e.name === "dist" || e.name === "out" || e.name === "build") {
        continue
      }
      const full = path.join(d, e.name)
      if (e.isDirectory()) stack.push(full)
      else if (/\.(ts|tsx|mjs|cjs|js|json|css)$/.test(e.name)) {
        try {
          const m = fs.statSync(full).mtimeMs
          if (m > newest) {
            newest = m
            newestFile = full
          }
        } catch {
          // A file that vanished mid-walk is not worth failing the build over.
        }
      }
    }
  }
  return { newest, newestFile }
}

/**
 * `--stage-only` stages the installer's own UI and stops before touching the payload.
 *
 * This exists because `pnpm -r build` walks every package including this one, and this package's
 * real `build` needs a payload that only `pack:win` can produce. Left as one script, the
 * recursive build could never pass on a clean checkout — the freshness check would correctly
 * refuse, and `pnpm -r build` would fail for a reason that has nothing to do with what it is for.
 *
 * So the split is: `build` is the shipping path and enforces that the payload is current;
 * `build:stage` is the recursive-build path and only stages the UI, which is all a plain
 * `pnpm -r build` needs to do for this package. `pack` never passes the flag, so shipping always
 * goes through the check.
 */
const stageOnly = process.argv.includes("--stage-only")

if (!fs.existsSync(unpacked) && !stageOnly) {
  throw new Error(
    `${unpacked} is missing. Build the desktop app first:\n  pnpm --dir packages/desktop build\n  pnpm --dir packages/desktop pack:win`,
  )
}

// The payload is a directory, so compare against the oldest thing inside it that must have been
// written during packing: the app directory itself. Using the directory's own mtime would miss an
// artifact whose contents were refreshed without the top level changing.
if (!stageOnly) {
  const payloadMtime = fs.statSync(unpacked).mtimeMs
  for (const pkgDir of ["desktop", "core", "web"]) {
    const { newest, newestFile } = newestSourceMtime(path.join(repoRoot, "packages", pkgDir))
    if (newest > payloadMtime && !process.env.JIUMATE_ALLOW_STALE_PAYLOAD) {
      const rel = path.relative(repoRoot, newestFile)
      throw new Error(
        `The payload is older than the sources it is meant to contain.\n\n` +
          `  newest source: ${rel}\n` +
          `  payload:       ${path.relative(repoRoot, unpacked)}\n\n` +
          `Rebuild it, or the installer will ship the previous build:\n` +
          `  pnpm --dir packages/desktop build\n` +
          `  pnpm --dir packages/desktop pack:win\n\n` +
          `Set JIUMATE_ALLOW_STALE_PAYLOAD=1 only if you mean to ship the old payload.`,
      )
    }
  }
}

// dist is wiped first, then the catalog is generated into it — the other order deletes the file it
// just wrote. The catalog is generated here rather than expected to be there: it describes the
// models and themes this build is about to ship, so it cannot be a file that a previous build
// left behind.
fs.rmSync(dist, { recursive: true, force: true })
fs.mkdirSync(path.join(dist, "renderer"), { recursive: true })

execFileSync(process.execPath, [path.join(here, "gen-catalog.mjs")], { stdio: "inherit" })

for (const file of ["main.cjs", "preload.cjs"]) {
  fs.copyFileSync(path.join(here, "src", file), path.join(dist, file))
}
for (const file of ["index.html", "renderer.js"]) {
  fs.copyFileSync(path.join(here, "src", "renderer", file), path.join(dist, "renderer", file))
}
// The project's own icon, copied into dist so it exists in both run modes. The title bar and the
// two hero spots used to draw a CSS approximation and a hand-written SVG hexagon instead, which is
// not the project's icon at all.
fs.copyFileSync(path.join(desktopPkg, "build", "icon.png"), path.join(dist, "icon.png"))

const sevenZip = find7za()
fs.copyFileSync(sevenZip, path.join(dist, "7za.exe"))

if (stageOnly) {
  // The UI is staged and the payload is untouched: this run exists for `pnpm -r build`, and the
  // shipping `pack` re-runs without the flag and does the archiving below.
  console.log("[build] staged UI only (--stage-only); payload not repacked")
} else {
  const expandedBytes = dirSize(unpacked)
  console.log(`[build] payload source: ${(expandedBytes / 1024 / 1024).toFixed(1)} MB`)

  if (fs.existsSync(payload)) fs.rmSync(payload)
  console.log("[build] packing payload.7z ...")
  // `cd` into the folder rather than `-w`: 7za's -w sets the *working directory for the archive*,
  // not the source root, so passing it alongside "." pulled in the whole `out` directory and the
  // archive grew to 619 MB with an `out\win-unpacked\` prefix on every entry. Running from inside
  // win-unpacked with a relative "." is what makes the entries land at the archive root.
  execFileSync(sevenZip, ["a", "-t7z", payload, ".", "-mx=3", "-bso0", "-bsp0"], {
    cwd: path.join(desktopPkg, "out", "win-unpacked"),
    stdio: ["ignore", "inherit", "inherit"],
  })

  const payloadBytes = fs.statSync(payload).size
  console.log(`[build] payload.7z: ${(payloadBytes / 1024 / 1024).toFixed(1)} MB`)

  fs.writeFileSync(
    path.join(dist, "meta.json"),
    JSON.stringify(
      {
        version: pkg.version,
        // The number the window shows. The expanded size rather than the compressed one: it is what
        // the folder will actually occupy, and it is the figure a user choosing a drive cares about.
        requiredBytes: expandedBytes,
        payloadBytes,
      },
      null,
      2,
    ),
  )
}

console.log("[build] done")
