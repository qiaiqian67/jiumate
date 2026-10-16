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
const catalogSrc = path.join(here, "dist", "catalog.json")
if (!fs.existsSync(catalogSrc)) throw new Error("dist/catalog.json missing; run gen-catalog.mjs first")

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

if (!fs.existsSync(unpacked)) {
  throw new Error(
    `${unpacked} is missing. Build the desktop app first:\n  pnpm --dir packages/desktop build\n  pnpm --dir packages/desktop pack:win`,
  )
}

// dist is wiped first, then the catalog is generated into it — the other order deletes the file it
// just wrote.
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

console.log("[build] done")
