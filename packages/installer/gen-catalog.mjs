// Generates dist/catalog.json (providers/models) and dist/themes.json (each theme's real token ramps)
// from the project's own core and skins packages.
//
// Both lists used to be hand-written in the renderer, which is how the installer ended up offering
// five invented providers with made-up model ids, and a theme grid whose swatches were two colours I
// picked rather than the theme's actual palette. Reading them from the packages that own the data
// removes the copy that could drift.
import { createRequire } from "node:module"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

function load(pkg, entry, hint) {
  const file = path.resolve(here, "..", pkg, "dist", entry)
  if (!fs.existsSync(file)) {
    throw new Error(`${file} is missing. Build it first:\n  ${hint}`)
  }
  return require(file)
}

const core = load("core", "index.js", "pnpm --dir packages/core build")
const skins = load("skins", "index.js", "pnpm --dir packages/skins build")

// ---- providers + models ----

const providers = core.MODEL_PROVIDERS || []
const catalog = core.MODEL_CATALOG || []
if (!providers.length || !catalog.length) {
  throw new Error(`core exported ${providers.length} providers / ${catalog.length} models; expected a populated catalog`)
}

// `custom` is the app's escape hatch for a hand-typed endpoint. The installer has no field for it,
// so offering it would lead to a choice with nowhere to go.
const modelsByProvider = {}
for (const m of catalog) {
  if (m.provider === "custom") continue
  ;(modelsByProvider[m.provider] ||= []).push({
    id: m.modelId,
    name: m.displayName,
    baseUrl: m.baseUrl || "",
    clientType: m.clientType || "",
    contextWindow: m.contextWindow || 0,
  })
}

const out = providers
  .filter((p) => p.id !== "custom")
  .map((p) => ({
    id: p.id,
    label: p.label,
    envKey: p.envKey,
    envBaseUrlKey: p.envBaseUrlKey || "",
    baseUrl: (modelsByProvider[p.id] || [])[0]?.baseUrl || "",
    models: modelsByProvider[p.id] || [],
  }))
  .filter((p) => p.models.length > 0)
if (!out.length) throw new Error("no provider ended up with models; the catalog shape changed?")

// ---- themes ----

// Each theme carries its own light/dark ramps, rendered to CSS by skins' own renderer rather than
// approximated. The installer preview applies these to itself, so "click to preview" shows the real
// theme rather than a guess -- and the appearance field says which ramp the host shell should use.
const themes = skins.BUILTIN_THEMES.map((t) => {
  const pkg = skins.builtinThemePackage(t)
  const css = skins.renderSkinCss(pkg, {})
  return {
    id: t.id,
    name: t.name,
    appearance: t.appearance,
    colors: t.colors,
    css,
    mode: t.appearance === "dark" ? "dark" : "light",
  }
})
if (!themes.length) throw new Error("skins exported no builtin themes")

const distDir = path.join(here, "dist")
fs.mkdirSync(distDir, { recursive: true })
fs.writeFileSync(path.join(distDir, "catalog.json"), JSON.stringify(out, null, 2))
fs.writeFileSync(path.join(distDir, "themes.json"), JSON.stringify(themes, null, 2))

const totalModels = out.reduce((n, p) => n + p.models.length, 0)
console.log(`[build] catalog: ${out.length} providers, ${totalModels} models`)
console.log(`[build] themes:  ${themes.length}`)
