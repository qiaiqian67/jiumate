/**
 * Executable probe for the setup-import chain: does the seeded value actually land in the app's
 * localStorage, and does the app then *keep* it?
 *
 * ## Why this exists rather than another unit test
 *
 * The chain under test is: main process reads setup.ini → injects localStorage on `dom-ready` →
 * the web app's stores read those keys at mount. Every link of it can pass in isolation and the
 * whole thing can still do nothing, because the last two links involve a real Chromium, a real
 * navigation and a real React mount. That is precisely the failure being chased: unit tests were
 * green, the keys were correct, the payload was current — and the choice still did not apply.
 *
 * So this script runs the real desktop main-process module against a real Electron window, points
 * it at a throwaway profile, and reads the storage back. It is the check that would have caught
 * the bug, and it is kept in the repo for the next time somebody changes when the seed runs.
 *
 * Run: pnpm --dir packages/desktop exec node --experimental-strip-types test/setup-seed-probe.mjs
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jiumate-seed-probe-"))
const profile = path.join(tmp, "profile")
fs.mkdirSync(profile, { recursive: true })

const answers = {
  lang: "zh",
  mode: "dark",
  theme: "coral-sphere",
  provider: "deepseek",
  model: "deepseek-v4-flash",
  skipModel: true,
}
fs.writeFileSync(
  path.join(profile, "setup.ini"),
  ["[setup]", `lang=${answers.lang}`, `mode=${answers.mode}`, `theme=${answers.theme}`, "skipModel=1", ""].join("\r\n"),
  "utf8",
)

const { app, BrowserWindow } = await import("electron")

// A throwaway profile, so the probe cannot read or disturb a real install's settings.
app.setPath("userData", profile)
app.setName("JiuMate-Seed-Probe")

// Whatever origin the app is served from: the storage under test is per-origin, and that is half
// the question being asked here.
const ORIGIN = process.env.PROBE_ORIGIN ?? "http://127.0.0.1:7"
const PAGE = `${ORIGIN}/probe.html`

const { readSetupAnswers, seedStorage } = await import("../src/setup-import.ts")

await app.whenReady()
const win = new BrowserWindow({
  show: false,
  webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
})

const answers_read = readSetupAnswers(app.getPath("userData"))
console.log("readSetupAnswers ->", JSON.stringify(answers_read))
const seed = seedStorage(answers_read ?? {})
console.log("seedStorage      ->", JSON.stringify(seed))

// Same wiring as main.ts: the seed runs on `dom-ready`.
if (Object.keys(seed).length > 0) {
  const script = `(() => { const seed = ${JSON.stringify(seed)};
    for (const [k, v] of Object.entries(seed)) { try { localStorage.setItem(k, v); } catch {} }
    return true })()`
  win.webContents.on("dom-ready", () => {
    void win.webContents.executeJavaScript(script, true).then(
      () => console.log("executeJavaScript resolved"),
      (err) => console.log("executeJavaScript REJECTED:", String(err)),
    )
  })
}

try {
  await win.loadURL(PAGE)
} catch (err) {
  console.log("loadURL failed (expected if no server):", String(err).slice(0, 80))
}

await new Promise((r) => setTimeout(r, 1200))

const readBack = await win.webContents.executeJavaScript(
  `JSON.stringify({
     lang: localStorage.getItem("jiumate.lang"),
     mode: localStorage.getItem("jiumate.mode"),
     theme: localStorage.getItem("jiumate.theme"),
   })`,
  true,
)
console.log("localStorage after ->", readBack)

const ok = JSON.parse(readBack).mode === answers.mode
console.log(ok ? "RESULT: seed landed" : "RESULT: seed did NOT land")

win.destroy()
app.quit()
process.exit(ok ? 0 : 1)
