'use strict'
/**
 * The installer's UI.
 *
 * A flat state machine over five pages: the step strip, the footer buttons, and the answers in
 * `state` are the only places that decide anything. No framework, no build step for this file —
 * it is served as-is, so what is read here is what runs.
 *
 * The data below is taken from the app's own theme table (packages/skins/src/presets.ts) rather
 * than invented here: a swatch that does not match a real theme would be a lie the user only finds
 * out after installing.
 */
const $ = (id) => document.getElementById(id)
const api = window.installer

const state = {
  step: "lang",
  // "system", not "zh": the app's own default (locale.tsx's initialLang returns "system" when no
  // preference is stored) is to follow the device, and an installer that opened in Simplified
  // Chinese on an English machine was contradicting that before the user had chosen anything.
  lang: "system",
  target: "",
  version: "0.0.0",
  required: 0,
  free: null,
  desktop: true,
  startMenu: true,
  launch: true,
  themeId: "system",
  provider: "",
  model: "",
  baseUrl: "",
  skipModel: true,
  testOk: false,
  // Off, deliberately. The user's sessions, projects and settings are theirs; uninstalling the
  // application is not a decision to destroy them, and leaving them is what makes a reinstall find
  // the previous work still there.
  deleteData: false,
}

/**
 * Themes are NOT listed here. They come from the skins package (BUILTIN_THEMES + renderSkinCss, via
 * gen-catalog.mjs -> themes.json), each carrying its real light/dark token ramps. The hand-written
 * list this replaces had two invented ids and swatch colours I picked myself, which is why the
 * preview never looked like any actual theme.
 */
let THEMES = []

/**
 * "Follow the system" has no palette of its own, so it is the one entry added here rather than read
 * from the file. Its swatch is a light/dark split, which is what following the system means.
 */
const SYSTEM_THEME = { id: "system", name: "跟随系统", appearance: "auto", css: "", mode: "light" }

// Exactly the three the app offers (web/src/state/locale.tsx: `zh | en | system`). A "繁體中文" entry
// was invented here and does not exist in the product — the app ships only 简体 and English, so
// choosing it could not have changed anything after setup. What was missing instead was "跟随系统",
// which is the preference the app itself defaults to.
const LANGS = [
  { id: "system", label: "跟随系统", labelEn: "Follow system" },
  { id: "zh", label: "简体中文", labelEn: "Simplified Chinese" },
  { id: "en", label: "English", labelEn: "English" },
]

/**
 * Providers and models are NOT listed here. They come from core's own catalog
 * (MODEL_CATALOG / MODEL_PROVIDERS, via gen-catalog.mjs -> catalog.json), so the installer offers the
 * same 110 models the app does. The hand-written list this replaces had 5 made-up providers with
 * invented model ids and base URLs — every one of which would have failed on first use.
 */
let CATALOG = []

const I18N = {
  zh: {
    continue: "继续", installTitle: "安装 JiuMate", installPath: "安装路径", browse: "浏览",
    need: "所需空间", avail: "可用空间", options: "安装选项", desktop: "创建桌面快捷方式",
    startMenu: "添加到开始菜单", switchLang: "切换语言", install: "安装", installing: "安装中",
    provider: "选择模型提供商", apiKey: "API密钥", endpoint: "服务端点", model: "选择模型",
    presetNote: "当前显示的是常用预设模型", advanced: "高级设置", proxy: "代理", test: "测试连接",
    // These two were dropped from the table while the layout was being reworked, which left the page
    // rendering the raw keys: the heading read "modelTitle" instead of 连接模型.
    modelTitle: "连接模型", modelSub: "选择服务商并填写 API 密钥，也可以进入应用后配置。",
    later: "稍后配置", nextTheme: "下一步：主题", themeTitle: "选择外观",
    themeSub: "点击主题即可预览，之后也可以随时更换。", done: "完成", show: "显示", hide: "隐藏",
    uninstallTitle: "卸载 JiuMate", uninstallSub: "将移除应用文件与快捷方式。你的会话、项目和设置默认保留。",
    uninstallItems: "将要移除", uninstallApp: "应用文件", uninstallLinks: "快捷方式",
    uninstallPrefs: "设置与凭据（%APPDATA%\\JiuMate）", reclaim: "可释放",
    uninstall: "卸载", uninstalling: "正在卸载", cancel: "取消",
    // Uninstall progress steps, keyed by what the main process sends. The main process deliberately
    // sends keys rather than sentences so the wording follows the UI language.
    unStep_closing: "正在关闭应用", unStep_links: "正在移除快捷方式",
    unStep_registry: "正在清理注册表", unStep_prefs: "正在移除设置与凭据",
    unStep_files: "正在删除应用文件", unStep_done: "卸载完成",
    unStep_failed: "未能删除应用文件", unStep_data: "正在删除用户数据",
    unStep_prefs: "正在清理安装记录",
    uninstallData: "历史数据",
    uninstallDataNote: "会话、项目与设置。重新安装后会继续使用。",
    uninstallDataSize: "历史数据",
    uninstallDone: "卸载完成", uninstallDoneSub: "应用、快捷方式与设置项已移除。",
    uninstallPurge: "彻底删除",
    uninstallPurgeFailed: "无法自动删除，请稍后重试。",
    uninstallPurge: "彻底删除",
    close: "关闭",    unprogSub: "请稍候，正在移除 JiuMate。",    langTitle: "选择语言", langSub: "用于安装过程与应用首次启动。", version: "版本",
    steps: ["语言", "安装", "模型", "外观"],
  },
  en: {
    continue: "Continue", installTitle: "Install JiuMate", installPath: "Install path", browse: "Browse",
    need: "Required", avail: "Available", options: "Install options", desktop: "Create a desktop shortcut",
    startMenu: "Add to the Start menu", switchLang: "Switch language", install: "Install", installing: "Installing",
    provider: "Provider", apiKey: "API key", endpoint: "Endpoint", model: "Model",
    presetNote: "Showing common preset models", advanced: "Advanced", proxy: "Proxy", test: "Test connection",
    modelTitle: "Connect a model", modelSub: "Choose a provider and enter an API key, or configure this later in the app.",
    later: "Do this later", nextTheme: "Next: theme", themeTitle: "Choose an appearance",
    themeSub: "Click a theme to preview it. You can change it later.", done: "Done", show: "Show", hide: "Hide",
    uninstallTitle: "Uninstall JiuMate", uninstallSub: "Removes the application files and shortcuts. Your sessions, projects and settings are kept by default.",
    uninstallItems: "Will be removed", uninstallApp: "Application files", uninstallLinks: "Shortcuts",
    uninstallPrefs: "Settings and credentials (%APPDATA%\\JiuMate)", reclaim: "Reclaimable",
    uninstall: "Uninstall", uninstalling: "Uninstalling", cancel: "Cancel",
    unStep_closing: "Closing the application", unStep_links: "Removing shortcuts",
    unStep_registry: "Cleaning the registry", unStep_prefs: "Removing settings and credentials",
    unStep_files: "Deleting application files", unStep_done: "Uninstall complete",
    unStep_failed: "Could not delete the application files", unStep_data: "Deleting your data",
    unStep_prefs: "Cleaning the install record",
    uninstallData: "History",
    uninstallDataNote: "Sessions, projects and settings. A reinstall will pick these back up.",
    uninstallDataSize: "History",
    uninstallDone: "Uninstall complete", uninstallDoneSub: "The application, its shortcuts and its settings are gone.",
    uninstallPurge: "Delete remaining files",
    uninstallPurgeFailed: "Could not delete automatically. Please try again.",
    uninstallPurge: "Delete remaining files",
    close: "Close",
    unprogSub: "Please wait while JiuMate is removed.",    langTitle: "Select a language", langSub: "Used during setup and on first launch.", version: "Version",
    steps: ["Language", "Install", "Model", "Appearance"],
  },
}

// "system" resolves before any of these run, so the table always has a real entry. The `?.[key]` is
// kept as a backstop: a key missing from the active language must not render as its own name, which
// is what the page showed when modelTitle/modelSub went missing from this table.
const t = (key) => I18N[activeLang()]?.[key] ?? I18N.zh[key] ?? key

function bytes(n) {
  if (!n || n < 0) return "—"
  const units = ["B", "KB", "MB", "GB", "TB"]
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

function applyI18n() {
  document.documentElement.lang = state.lang === "system" ? "" : state.lang
  for (const el of document.querySelectorAll("[data-i18n]")) {
    el.textContent = t(el.dataset.i18n)
  }
  $("launchLabel").textContent =
    activeLang() === "en" ? `Launch ${"JiuMate"} after install` : `安装后启动 JiuMate`
  $("brandVer").textContent = `${t("version")} ${state.version}`
  $("progSub").textContent = activeLang() === "en" ? "Preparing your workspace." : "正在为你准备工作空间。"
  $("langTitle").textContent = t("langTitle")
  $("langSub").textContent = t("langSub")
  $("reveal").textContent = $("apiKey").type === "password" ? t("show") : t("hide")
  renderSteps()
}

function renderSteps() {
  const names = I18N[activeLang()].steps
  const order = ["lang", "install", "model", "theme"]
  const cur = order.indexOf(state.step)
  // The uninstall pages have no step strip, and neither do the progress ones. `cur` is -1 for those
  // and the loop below then marks nothing current, which happens to be right; skipping explicitly
  // keeps that from depending on a coincidence.
  if (cur < 0) return
  for (const host of ["steps2", "steps4", "steps5"]) {
    const box = $(host)
    if (!box) continue
    box.innerHTML = ""
    order.forEach((key, i) => {
      const span = document.createElement("span")
      span.textContent = names[i]
      if (key === state.step) span.className = "on"
      else if (i < cur) span.className = "done"
      if (i < cur) {
        span.onclick = () => {
          // "Installed" is not re-enterable: the payload is already unpacked, so going back to the
          // install page would offer a folder that is no longer empty.
          if (key === "lang") {
            state.step = "lang"
            show()
            applyI18n()
          }
        }
      }
      box.appendChild(span)
    })
  }
}

function show() {
  for (const p of ["lang", "install", "prog", "model", "theme", "uninstall", "unprog", "undone"]) {
    $("p-" + p).classList.toggle("on", p === state.step)
  }
  renderSteps()
  document.querySelector(".page.on")?.scrollTo(0, 0)
}

function goto(step) {
  state.step = step
  show()
}

/**
 * The language this window actually renders in.
 *
 * "system" is a real preference, not a display string: it has no dictionary of its own, so it is
 * resolved through the same rule the app uses (web/src/state/locale.tsx) — the device language, and
 * anything not Chinese is English. Keeping `state.lang` as the raw preference and resolving here is
 * what lets the choice be written to setup.ini as `system`, which is the value the app's store
 * accepts.
 */
function activeLang() {
  if (state.lang !== "system") return state.lang
  const tag = (navigator.language || "").toLowerCase()
  return tag.startsWith("zh") ? "zh" : "en"
}

/** The label for a language row, shown in the user's current UI language. */
function langLabel(id) {
  const current = activeLang()
  const row = LANGS.find((l) => l.id === id)
  return row ? (current === "en" ? row.labelEn : row.label) : id
}

function renderLang() {
  const list = $("langList")
  list.innerHTML = ""
  for (const l of LANGS) {
    const row = document.createElement("div")
    row.className = "opt" + (state.lang === l.id ? " sel" : "")
    row.innerHTML = `<div class="dot"></div><span>${langLabel(l.id)}</span>`
    row.onclick = () => {
      state.lang = l.id
      renderLang()
      applyI18n()
    }
    list.appendChild(row)
  }
}

function renderThemes() {
  const list = $("themeList")
  list.innerHTML = ""
  for (const th of THEMES) {
    const row = document.createElement("div")
    row.className = "opt" + (state.themeId === th.id ? " sel" : "")
    row.dataset.theme = th.id
    const c = th.colors || {}
    const swatch =
      th.id === "system"
        ? `<div class="sw" style="background:linear-gradient(90deg,#f6f6f6 50%,#1a1a1a 50%)"></div>`
        : `<div class="sw" style="background:linear-gradient(90deg,${c.background || "#fff"} 0 52%, ${c.accent || "#888"} 52% 100%)"></div>`
    row.innerHTML = `<div class="dot"></div><span>${th.name}</span>${swatch}`
    row.onclick = () => {
      state.themeId = th.id
      renderThemes()
      applyThemePreview()
    }
    list.appendChild(row)
  }
}

/**
 * Apply the chosen theme to the whole installer, using the theme's own rendered token ramps.
 *
 * Two earlier attempts were wrong in ways worth recording. The first repainted document.body with a
 * single background colour and left every other colour hard-coded, so a dark theme produced dark text
 * on a dark page. The second removed the repaint entirely, on the grounds that a two-colour swatch is
 * preview enough — which is why selecting a theme appeared to do nothing at all. Neither used the
 * themes the app actually ships.
 *
 * What this does instead: the theme's own CSS (rendered by skins' renderSkinCss, carrying the full
 * light/dark ramp) is attached under a scoped attribute, and the installer's own tokens are defined in
 * terms of it. So the page genuinely becomes the theme, including text, borders and accent, rather
 * than a background colour with a fixed palette fighting it.
 *
 * The attribute is scoped to the theme id rather than written onto :root, because skins' CSS is
 * written as :root[data-skin="..."] and the app's own selector is the one thing that should decide
 * which block applies.
 */
function applyThemePreview() {
  const th = THEMES.find((x) => x.id === state.themeId)
  const holder = $("themeCss")
  if (!holder) return
  if (!th || th.id === "system" || !th.css) {
    holder.textContent = ""
    document.documentElement.removeAttribute("data-skin")
    document.documentElement.removeAttribute("data-mode")
    return
  }
  const mode = th.mode === "dark" ? "dark" : "light"
  holder.textContent = th.css
  document.documentElement.setAttribute("data-skin", th.id)
  document.documentElement.setAttribute("data-mode", mode)
  // skins emits `.dark` as a separate class on the same selector; the preview mirrors that.
  document.documentElement.classList.toggle("dark", mode === "dark")
}

function renderProvider() {
  const sel = $("provider")
  if (sel.options.length) return
  for (const p of CATALOG) {
    const o = document.createElement("option")
    o.value = p.id
    o.textContent = p.label
    sel.appendChild(o)
  }
  // DeepSeek rather than a blank first entry: the reference opens on a real provider, and a
  // dropdown whose default is "nothing" leaves the model list empty until the user picks, which
  // reads as a broken page.
  const preferred = CATALOG.find((p) => p.id === "deepseek") || CATALOG[0]
  state.provider = preferred ? preferred.id : ""
  sel.value = state.provider
  sel.onchange = () => {
    state.provider = sel.value
    applyProvider()
  }
  applyProvider()
}

/** Point endpoint and model at whatever provider is selected, using that provider's own base URL. */
function applyProvider() {
  const p = CATALOG.find((x) => x.id === state.provider)
  state.baseUrl = p?.baseUrl || ""
  state.model = p?.models?.[0]?.id || ""
  fillModels()
}

function fillModels() {
  const p = CATALOG.find((x) => x.id === state.provider)
  const sel = $("model")
  sel.innerHTML = ""
  for (const m of p?.models || []) {
    const o = document.createElement("option")
    o.value = m.id
    // The display name is what the app's settings show ("DeepSeek V4 Flash"), and the raw id is what
    // gets sent; the reference lists by name with the id behind it.
    o.textContent = m.name && m.name !== m.id ? `${m.name}  ·  ${m.id}` : m.id
    sel.appendChild(o)
  }
  sel.onchange = () => {
    state.model = sel.value
    const chosen = p?.models?.find((m) => m.id === sel.value)
    if (chosen?.baseUrl) state.baseUrl = chosen.baseUrl
  }

  // Direct vendors deliberately carry no baseUrl in core's catalog: their endpoints are resolved by
  // AgentHub's own clients, and only the six gateways pin a preset URL. Offering an empty
  // "endpoint" dropdown for those providers looked like a broken control, so it says so instead —
  // in the user's own language, which the previous version did not: both branches were Chinese, so
  // an English install showed "由应用自动解析" there.
  const urls = $("baseUrl")
  urls.innerHTML = ""
  const opt = document.createElement("option")
  opt.value = state.baseUrl || ""
  opt.textContent = p?.baseUrl
    ? activeLang() === "en" ? "Default" : "默认"
    : activeLang() === "en" ? "Resolved by the app" : "由应用自动解析"
  urls.appendChild(opt)
  urls.disabled = !p?.baseUrl
  const note = $("presetNote")
  if (note) note.textContent = `${t("presetNote")}（${(p?.models || []).length}）`
}

async function refreshSpace() {
  const res = await api.space(state.target)
  state.free = res.free
  state.required = res.required
  $("reqSize").textContent = bytes(res.required)
  $("freeSize").textContent = bytes(res.free)
  // A folder that cannot hold the payload is a dead end the user can only discover by waiting for a
  // failed copy, so it is said here instead.
  const btn = $("doInstall")
  if (res.free != null && res.required > 0 && res.free < res.required) {
    btn.disabled = true
    $("reqSize").textContent = bytes(res.required)
    $("reqSize").style.color = "#d0342c"
  } else {
    btn.disabled = false
    $("reqSize").style.color = ""
  }
}

function wire() {
  $("btnMin").onclick = () => api.minimize()
  $("btnClose").onclick = () => api.close()
  $("langNext").onclick = () => goto("install")
  $("uninstallCancel").onclick = () => api.close()
  $("uninstallGo").onclick = () => runUninstall()
  $("undoneClose").onclick = () => api.close()
  // The second click. The window closes and the app quits, which is what lets the last folder be removed:
  // the uninstaller's own executable is mapped inside it, and Windows will not delete a directory
  // holding a running image. So the exit is the first step of the deletion, not a side effect of it.
  $("undonePurge").onclick = async () => {
    $("undonePurge").disabled = true
    const res = await api.finalizeUninstall()
    if (res && res.ok === false) {
      // Left open on failure: closing here would hide the one thing the user needs to act on.
      $("undonePurge").disabled = false
      $("undoneSub").textContent = res.error || t("uninstallPurgeFailed")
      return
    }
    await api.close()
  }
  // The data checkbox drives what the main process deletes, and the size shown next to it, so the
  // user can see what ticking it costs before ticking it.
  $("ckData").onclick = () => {
    state.deleteData = !state.deleteData
    $("ckData").classList.toggle("on", state.deleteData)
    $("uninstallDataSizeWrap").classList.toggle("hidden", !state.deleteData)
    refreshUninstallSizes()
  }
  $("switchLang").onclick = () => {
    state.step = "lang"
    show()
    applyI18n()
  }
  $("browse").onclick = async () => {
    const picked = await api.browse()
    if (!picked) return
    state.target = picked
    $("target").value = picked
    await refreshSpace()
  }
  $("target").oninput = (e) => {
    state.target = e.target.value.trim()
    refreshSpace()
  }
  for (const [id, key] of [["ckDesktop", "desktop"], ["ckMenu", "startMenu"], ["ckLaunch", "launch"]]) {
    $(id).onclick = () => {
      state[key] = !state[key]
      $(id).classList.toggle("on", state[key])
    }
  }
  $("reveal").onclick = () => {
    const input = $("apiKey")
    input.type = input.type === "password" ? "text" : "password"
    $("reveal").textContent = input.type === "password" ? t("show") : t("hide")
  }
  $("advToggle").onclick = () => {
    const box = $("advBox")
    const open = box.classList.toggle("hidden")
    $("advToggle").classList.toggle("open", !open)
  }
  $("testConn").onclick = async () => {
    const msg = $("testMsg")
    msg.textContent = activeLang() === "en" ? "Testing…" : "测试中…"
    msg.className = ""
    const res = await api.testModel({
      baseUrl: state.baseUrl,
      apiKey: $("apiKey").value,
      model: state.model,
    })
    state.testOk = res.ok
    msg.textContent = res.ok ? res.detail : res.error
    msg.className = res.ok ? "ok" : "err"
  }
  $("later").onclick = () => {
    state.skipModel = true
    goto("theme")
  }
  $("toTheme").onclick = () => {
    // Not skipped just because both fields are empty: an empty key is a legitimate "decide later",
    // and the only thing that would be wrong is pretending a connection was verified.
    state.skipModel = !$("apiKey").value.trim()
    goto("theme")
  }
  $("doInstall").onclick = () => runInstall()
  $("finish").onclick = () => finish()
}

/**
 * Remove the app.
 *
 * The same progress page the install uses, driven by the same `onProgress` channel, so removing the
 * application looks like installing it. The heavy part — the install folder — cannot be deleted from
 * here: this executable lives inside it, and Windows will not remove a directory a running process
 * holds open. The main process moves that folder aside with a rename (which Windows does allow) and a
 * helper finishes the job, and it reports back whether that actually worked.
 *
 * The window then stays open on a "done" page rather than closing, because when the user's data was
 * kept they need to be told where it went. Closing silently is what makes an uninstall read as data
 * loss.
 */
/**
 * Both figures the uninstall page shows: what the application occupies, and what the user's data
 * would add if they chose to remove it.
 *
 * Measured rather than declared, because the second number decides whether ticking the box is a
 * reasonable thing to do — and on a machine that has been used it is hundreds of megabytes of real
 * work, which is not a decision to make from a label alone.
 */
async function refreshUninstallSizes() {
  $("uninstallSize").textContent = bytes(await api.uninstallSize().catch(() => 0))
  if (state.deleteData) {
    $("uninstallDataSize").textContent = bytes(await api.dataSize().catch(() => 0))
  }
}

async function runUninstall() {
  state.step = "unprog"
  show()
  const off = api.onProgress((p) => {
    $("unbarFill").style.width = `${Math.round((p.ratio || 0) * 100)}%`
    // The stage is a key, not a sentence: the main process sends `unStep_files` for each step and the
    // wording lives here, so an English install does not watch Chinese progress text scroll past.
    $("unprogStage").textContent = t(p.stage || "") || p.detail || p.stage
    $("unprogPct").textContent = `${Math.round((p.ratio || 0) * 100)}%`
  })
  const res = await api.uninstall({ deleteData: state.deleteData })
  off()
  if (!res.ok) {
    $("unprogStage").textContent =
      activeLang() === "en" ? `Uninstall failed: ${res.error}` : `卸载失败：${res.error}`
    $("unbarFill").style.background = "#d0342c"
    return
  }
  $("unbarFill").style.width = "100%"
  $("unprogPct").textContent = "100%"
  $("unprogStage").textContent = t("unStep_done")
  setTimeout(() => {
    state.step = "undone"
    show()
  }, 600)
}

async function runInstall() {
  if (!state.target) {
    $("target").focus()
    return
  }
  state.step = "prog"
  show()
  const off = api.onProgress((p) => {
    $("barFill").style.width = `${Math.round((p.ratio || 0) * 100)}%`
    $("progStage").textContent = p.detail || p.stage
    $("progPct").textContent = `${Math.round((p.ratio || 0) * 100)}%`
  })
  const res = await api.start({
    target: state.target,
    desktop: state.desktop,
    startMenu: state.startMenu,
  })
  off()
  if (!res.ok) {
    $("progStage").textContent =
      activeLang() === "en" ? `Install failed: ${res.error}` : `安装失败：${res.error}`
    $("barFill").style.background = "#d0342c"
    return
  }
  await saveAnswers()
  goto("model")
}

async function saveAnswers() {
  const th = THEMES.find((x) => x.id === state.themeId)
  // `mode` follows the theme's own `appearance`, which is what the app reads (theme.tsx's `pinnedMode`):
  // "dark" pins the mode, "light" pins it the other way, and "auto" means the theme follows the
  // device — so it is stored as "system". Coarse-mapping appearance to light/dark the way this did
  // before turned every auto theme into a light one, which is why a theme picked here looked
  // different from the same theme picked in the app's own Appearance settings.
  await api.save({
    lang: state.lang,
    mode: state.themeId === "system" ? "system" : th?.appearance === "dark" ? "dark" : th?.appearance === "light" ? "light" : "system",
    themeId: state.themeId,
    provider: state.provider,
    model: state.model,
    baseUrl: state.baseUrl,
    skipModel: state.skipModel,
    apiKey: $("apiKey")?.value?.trim() ?? "",
  })
}

async function finish() {
  const btn = $("finish")
  btn.disabled = true
  await saveAnswers()
  if (state.launch) await api.launch(state.target)
  await api.close()
}

/**
 * Run a render step, keeping one failure from taking the rest of boot() with it.
 *
 * A throw inside any of these used to abort boot() partway, which left applyI18n() uncalled and the
 * page showing raw i18n keys (`modelTitle`, `modelSub`) — a blank page whose cause was nowhere near
 * the symptom. Recording the error also makes it inspectable instead of silent.
 */
function step(name, fn) {
  try {
    fn()
  } catch (err) {
    console.error(`[installer] ${name} failed:`, err)
  }
}

async function boot() {
  // Both lists come from the main process, which reads files generated from core and skins. Loading
  // them is awaited together and before anything renders: when the catalog came back empty, the
  // code below threw on it, boot() never finished, and i18n never ran — which is how the packaged
  // build showed a blank provider dropdown and raw `modelTitle` / `modelSub` on the page.
  const [catalog, themes, icon, info] = await Promise.all([
    api.catalog().catch(() => []),
    api.themes().catch(() => []),
    api.icon().catch(() => null),
    api.info(),
  ])
  CATALOG = Array.isArray(catalog) ? catalog : []
  THEMES = [SYSTEM_THEME, ...(Array.isArray(themes) ? themes : [])]
  state.version = info.version
  state.target = info.defaultTarget
  state.required = info.requiredBytes
  state.free = info.free
  $("target").value = info.defaultTarget
  $("titleName").textContent = "JiuMate"
  if (icon) {
    for (const img of document.querySelectorAll("img[data-icon]")) img.src = icon
  }
  step("renderLang", renderLang)
  step("renderProvider", renderProvider)
  step("renderThemes", renderThemes)
  step("wire", wire)
  step("applyI18n", applyI18n)
  step("applyThemePreview", applyThemePreview)

  // The same program run as the uninstaller: open on the removal page instead of offering to
  // install. It reuses this file's own stylesheet and icon, so the two windows match.
  if (info.mode === "uninstall") {
    state.step = "uninstall"
    state.lang = await readUninstallLang()
    applyI18n()
    await refreshUninstallSizes()
    show()
    return
  }
  await refreshSpace()
  show()
}

/**
 * The uninstaller's language: whatever setup recorded, else the system's.
 *
 * Read from setup.ini through the main process rather than from localStorage: the uninstaller is a
 * separate executable with its own storage, so the installer's localStorage is not visible to it and
 * every attempt to read it here returns nothing — the uninstall window came up in English on a
 * Chinese install.
 */
async function readUninstallLang() {
  const saved = await api.uninstallLang().catch(() => "")
  if (saved === "zh" || saved === "en") return saved
  const tag = (navigator.language || "").toLowerCase()
  // A Traditional Chinese Windows resolves to 简体 here, because the app ships only that dictionary
  // (web/src/state/locale.tsx: Locale is "zh" | "en"). There is no zh-TW to fall back to.
  return tag.startsWith("zh") ? "zh" : "en"
}

boot()
