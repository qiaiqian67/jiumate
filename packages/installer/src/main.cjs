"use strict";
/**
 * The JiuMate installer.
 *
 * This is a small Electron app whose UI *is* the installer. It exists because the design the
 * installer has to match is a rendered one — rounded frameless window, custom title bar, a step
 * strip, pill buttons, a swatch grid — and NSIS has no web view to render it with. electron-builder's
 * assisted installer is a fixed set of Win32 dialogs; the pages it can reach cannot look like that.
 * So the shell does the installing itself, driven by a normal web UI.
 *
 * What it owns, and why each part exists:
 *
 * - Frameless window (`frame: false`) plus an HTML title bar. The reference has no OS chrome.
 * - Extracting a payload archive of `out/win-unpacked` into the chosen folder, with real progress.
 *   The reference's "正在解压文件 15%" is a progress bar over an actual copy, not a timer.
 * - Writing %APPDATA%\JiuMate\setup.ini so the installed app can pick the answers up.
 * - Registering uninstall info and creating shortcuts.
 *
 * What it deliberately does not do: keep the API key. It is read from the field so the user can see
 * what they typed, and passed to the "test connection" button, and then dropped. A secret written
 * by an installer lands in a plaintext file beside the install tree, and the app asks for it once
 * itself, in a process that can hand it to the OS credential store.
 */
const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

const PRODUCT = "JiuMate";
const UNINSTALL_KEY = "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\JiuMate";

/** Filled in at runtime from the bundle, so the numbers cannot drift from what shipped. */
let META = { version: "0.0.0", requiredBytes: 0, defaultTarget: "" };

let win = null;
/** Kept out of the handler: a second install must not race the first. */
let installing = false;

function createWindow() {
  // Launched with `--uninstall`, this program is the uninstaller rather than the installer: same
  // window, same stylesheet, same icon, but it opens on the removal page and installs nothing. The
  // copy placed in the install folder is how Apps & features and the shortcut reach it.
  const isUninstall = process.argv.includes("--uninstall");
  // The uninstall page is shorter than the install flow's tallest step, and reusing 668 for it left
  // a band of empty space at the bottom. Height is chosen per mode rather than fixed, because these
  // two windows do not show the same content.
  // The uninstaller opens at exactly the installer's size. It was shorter on purpose once, on the
  // theory that a shorter window is tidier — but the two windows are opened minutes apart, often from
  // the same place in Windows, and a frame that resizes between them reads as a different program.
  win = new BrowserWindow({
    width: 880,
    height: 560,
    minWidth: 880,
    minHeight: 560,
    frame: false,
    // Paired with the CSS radius in renderer/index.html, which is what actually draws the rounded
    // corner: a frameless window on its own is still a rectangle, and `border-radius` on an opaque
    // window is clipped away by the window frame. These only work together, and `backgroundColor`
    // must stay transparent — with an opaque colour here Chromium keeps the window opaque and the
    // corners are never rounded, which is exactly what pixel-sampling the corners shows.
    transparent: true,
    backgroundColor: "#00000000",
    resizable: true,
    maximizable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  // Diagnostics only: Electron honours --remote-debugging-port itself when it is passed to the
  // process, so nothing extra is needed here — the packaged app opens a devtools port only when
  // launched with the flag, which is how the verification scripts drive the real UI instead of
  // clicking blind. A shipped installer is launched without it and exposes no port.
  win.once("ready-to-show", () => {
    // Startup timing, printed only when JIUMATE_TIMING=1. Measured from the process's own start rather
    // than from module load, because on Windows the gap between the two is Electron's own launch.
    //
    // It exists because a double-click that shows nothing for several seconds has to be attributed to a
    // specific step before anything is changed. Polling for the window from outside cannot do that: three
    // identical runs measured 1.3 s, 3.5 s and 4.2 s, because each poll spawned a PowerShell process and
    // the contention became the number being reported.
    if (process.env.JIUMATE_TIMING === "1") {
      const up = process.uptime();
      process.stdout.write(`[timing] ready-to-show at ${up.toFixed(2)}s\n`);
    }
    win.show();
    if (process.env.JIUMATE_TIMING === "1") {
      process.stdout.write(`[timing] shown at ${process.uptime().toFixed(2)}s\n`);
    }
  });
  win.webContents.once("did-finish-load", () => {
    if (process.env.JIUMATE_TIMING === "1") {
      process.stdout.write(`[timing] did-finish-load at ${process.uptime().toFixed(2)}s\n`);
    }
  });
}

app.whenReady().then(() => {
  // Paired with the timings in createWindow: this is the moment the app became able to create a window,
  // and together with `ready-to-show` it says whether a slow double-click is Electron's launch or this
  // app's own work. Printed only under JIUMATE_TIMING=1, so a shipped installer stays silent.
  if (process.env.JIUMATE_TIMING === "1") {
    process.stdout.write(`[timing] whenReady at ${process.uptime().toFixed(2)}s\n`);
  }
  // Single instance: a second launch would mean two installers racing for the same folder.
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.setAppUserModelId("com.jiumate.installer");
  buildMeta();
  createWindow();
});

/**
 * Push a progress frame to the renderer.
 *
 * Module-level, not local to the install handler, because the uninstaller needs it too. It was
 * declared inside `installer:start`, so the uninstall steps had no way to report progress and the
 * bar could only be advanced by a guess in the renderer — which left the window sitting at 0% while
 * it was actually removing files, so an uninstall looked stuck and got killed instead of waited out.
 */
function send(event, stage, ratio, detail) {
  if (!event.sender.isDestroyed()) {
    event.sender.send("installer:progress", { stage, ratio, detail });
  }
}

function buildMeta() {
  // stagedRoots(), not __dirname. `files` puts the app's own code in resources/app/dist/, while
  // meta.json is one of the extraResources copied to resources/ — so under a packaged run __dirname
  // pointed at a directory with no meta.json in it, the read failed silently, and the window showed
  // "版本 0.0.0" for a 0.3.0 build. stagedRoots() checks both, so it works under `electron .` and
  // packaged alike.
  let version = "0.0.0";
  let requiredBytes = 0;
  try {
    const metaPath = stagedPath("meta.json");
    const raw = metaPath ? JSON.parse(fs.readFileSync(metaPath, "utf8")) : {};
    version = raw.version ?? version;
    requiredBytes = raw.requiredBytes ?? requiredBytes;
  } catch {
    // A build without meta.json still installs; it just cannot promise a size.
  }
  META = {
    version,
    requiredBytes,
    defaultTarget: path.join(
      process.env.LOCALAPPDATA || process.env.USERPROFILE,
      "Programs",
      PRODUCT,
    ),
  };
}

/**
 * Free bytes on the volume holding `target`, or null when it cannot be determined.
 *
 * `statfsSync` is called on the nearest ancestor that exists: the default target does not exist yet
 * on a first install, and statfs on a missing path throws — which is why the window showed "—"
 * against a perfectly valid path with plenty of room. Walking up is also what a user who typed a
 * brand-new folder path into the field gets.
 */
function freeBytes(target) {
  let dir = path.resolve(String(target || ""));
  for (;;) {
    try {
      const st = fs.statfsSync(dir);
      return st.bsize * st.bfree;
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  }
}

function defaultInstallDir() {
  const base = process.env.LOCALAPPDATA || process.env.USERPROFILE;
  return path.join(base, "Programs", PRODUCT);
}

/**
 * The payload: a 7z archive of out/win-unpacked, staged next to the app's sources by build.mjs.
 * Kept as an archive rather than a loose tree on purpose — expanded it is ~466 MB, and an
 * installer that left a second expanded copy of the application on the user's disk would be a poor
 * trade for saving one archive.
 *
 * Two roots, because the app runs two ways: unpacked (`electron .` during development, where the
 * extraResources-style staging is just `dist/`) and packaged (portable target, where `dist/` is
 * inside app.asar and the same files are unpacked to resources/). Checking only resourcesPath is
 * what made every install fail with `no-unpacker` when run unpacked.
 */
function stagedRoots() {
  return [__dirname, process.resourcesPath].filter(Boolean);
}

function stagedPath(name) {
  for (const root of stagedRoots()) {
    const full = path.join(root, name);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

function payloadPath() {
  const found = stagedPath("payload.7z");
  if (!found) throw new Error("no-payload");
  return found;
}

function sevenZip() {
  const found = stagedPath("7za.exe");
  if (!found) throw new Error("no-unpacker");
  return found;
}

ipcMain.handle("installer:info", () => ({
  product: PRODUCT,
  version: META.version,
  requiredBytes: META.requiredBytes,
  defaultTarget: defaultInstallDir(),
  free: freeBytes(defaultInstallDir()),
  // Tells the renderer which of the two flows to open on. The uninstaller is the same program, so
  // without this it would start at "select a language" and offer to install itself.
  mode: process.argv.includes("--uninstall") ? "uninstall" : "install",
}));

ipcMain.handle("installer:space", (_e, target) => ({
  free: freeBytes(target),
  required: META.requiredBytes,
}));

ipcMain.handle("installer:browse", async () => {
  const res = await dialog.showOpenDialog(win, {
    title: "选择安装位置",
    defaultPath: defaultInstallDir(),
    properties: ["openDirectory", "createDirectory"],
  });
  return res.canceled || !res.filePaths.length ? null : res.filePaths[0];
});

/**
 * Extract the payload into `target`.
 *
 * 7za reports progress on stderr as a percentage; that is what the progress bar shows, so the bar
 * tracks real work rather than a fabricated timer. `x` runs it with the absolute target path and
 * the `-y` so a pre-existing folder is overwritten instead of stalling on a prompt the user cannot
 * see (the window is ours, not a console).
 */
ipcMain.handle("installer:start", async (event, opts) => {
  if (installing) return { ok: false, error: "install-already-running" };
  installing = true;
  const target = String(opts?.target || "").trim();
  try {
    if (!target) throw new Error("no-target");
    const exe = sevenZip();
    if (!exe) throw new Error("no-unpacker");
    const archive = payloadPath();
    if (!fs.existsSync(archive)) throw new Error("no-payload");

    await fsp.mkdir(target, { recursive: true });

    const send = (stage, ratio, detail) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send("installer:progress", { stage, ratio, detail });
      }
    };
    send("preparing", 0.02, "正在准备工作空间");

    await new Promise((resolve, reject) => {
      const child = spawn(exe, ["x", archive, `-o${target}`, "-y", "-bsp1"], {
        windowsHide: true,
      });
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        const text = String(chunk);
        stderr += text;
        // 7za's -bsp1 emits lines like "  45% 5 - filename".
        const matches = [...text.matchAll(/(\d{1,3})%/g)];
        if (matches.length) {
          const last = matches[matches.length - 1][1];
          const ratio = Math.max(0, Math.min(100, Number(last))) / 100;
          send("extracting", ratio, "正在解压文件");
        }
      });
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`unpack-failed:${code}:${stderr.slice(-400)}`)),
      );
    });

    send("finishing", 0.99, "正在创建快捷方式");
    await writeUninstallRecord(target, opts);

    send("done", 1, "安装完成");
    return { ok: true, target };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  } finally {
    installing = false;
  }
});

function appExe(target) {
  return path.join(target, `${PRODUCT}.exe`);
}

/**
 * Register the install and create the shortcuts the user asked for.
 *
 * electron-builder's own uninstaller covers the installer app, not the folder this writes, so the
 * record and an uninstaller script are created here. The script is deliberately a plain .cmd: it
 * has to keep working after this app is gone, and after an update, and in whatever shell the user
 * has. It removes the folder, the registry keys, and the shortcuts, then deletes itself last.
 */
async function writeUninstallRecord(target, opts) {
  const exe = appExe(target);
  const menu = process.env.APPDATA;
  const desktop = path.join(process.env.USERPROFILE, "Desktop");
  const startMenuDir = path.join(menu, "Microsoft", "Windows", "Start Menu", "Programs");

  // shell.writeShortcutLink is synchronous and returns a boolean; there is no promise to await or
  // catch. Calling .catch on it is what made every install die at 99% with
  // "shell.writeShortcutLink(...).catch is not a function", after the payload had already unpacked.
  // A shortcut that fails to write is not worth aborting an otherwise complete install over.
  const link = (dest) => {
    try {
      shell.writeShortcutLink(dest, { target: exe, cwd: target, description: PRODUCT });
    } catch {
      // Left to the OS; the app is installed either way.
    }
  };
  if (opts?.desktop) link(path.join(desktop, `${PRODUCT}.lnk`));
  if (opts?.startMenu) link(path.join(startMenuDir, `${PRODUCT}.lnk`));

  // The uninstaller is THIS program, told to uninstall — not a copy of itself dropped into the
  // install folder.
  //
  // Copying it was wrong twice over, and both failures looked identical: a window that never
  // appeared. A portable build's real file is a 239 MB launcher that needs the resources/ directory
  // beside it; copied into the app folder it has none of them. A dev run's file is electron.exe,
  // which shows nothing either. And an uninstaller that is a third 239 MB copy of the installer is a
  // poor trade for deleting one folder.
  //
  // Pointing at the real program keeps its resources working and makes the registry entry self-contained:
  // the installer file is one portable exe the user may move or delete, so the entry names the copy
  // unpacked next to the app instead, which is what stays put.
  // resources/ has to sit beside the uninstaller exe or the window never appears: Electron resolves
  // it relative to the running binary, not relative to whatever launched it.
  //
  // A junction rather than a second 240 MB copy, pointing back at the directory this program is
  // running out of. For a portable build that is a temp folder the launcher clears on exit, so the
  // link is made now while it exists and the uninstaller only ever runs from the app folder.
  //
  // The app's own resources/ is named differently below, so the two do not collide: the app's
  // directory keeps `resources` for JiuMate.exe, and the uninstaller lives in its own subfolder with
  // its own `resources` — that way neither can shadow the other and the junction is a real
  // self-contained uninstaller directory rather than something that overwrites the app's files.
  // Electron resolves its runtime beside the executable, not just resources/: locales/*.pak,
  // v8_context_snapshot.bin and the DLLs are all siblings. A junction for resources/ alone therefore
  // produced `Invalid file descriptor to ICU data` and the process died before a window appeared —
  // which looked exactly like "nothing happened", twice.
  //
  // So the whole runtime set is copied. That is the 240 MB the user already has, but a symlink per
  // file is not an option either: a junction cannot cover the parent directory without also covering
  // the exe, and covering both means the exe runs from the temp folder that the launcher deletes.
  // OUTSIDE the install folder, as a sibling: `%LOCALAPPDATA%\Programs\JiuMate Uninstaller\`.
  //
  // This is the whole reason the folder could never be deleted. While the uninstaller lived in
  // `<install>\JiuMate Uninstaller\`, its own exe was one of the files being removed — four live
  // processes were observed holding that directory, and Windows refuses to rename or delete a
  // directory containing a running executable. Every workaround (taskkill by pid, waiting for "no
  // tasks", rename instead of delete) failed for that one reason, and the only honest way out is for
  // the uninstaller not to live inside the thing it deletes.
  //
  // A sibling directory also makes the registry entry meaningful: it survives the install folder
  // being wiped and replaced by a reinstall.
  //
  // The runtime set is copied wholesale because Electron resolves it beside the executable, not in
  // resources/: locales/*.pak, v8_context_snapshot.bin and the DLLs are all siblings. A junction for
  // resources/ alone produced `Invalid file descriptor to ICU data` and the process died before a
  // window appeared — which looked exactly like "nothing happened", twice.
  const uninstallerDir = path.join(target, `${PRODUCT} Uninstaller`);
  let uninstaller = path.join(uninstallerDir, `${PRODUCT} Uninstaller.exe`);
  try {
    const src = path.dirname(process.execPath);
    await fsp.mkdir(uninstallerDir, { recursive: true });
    // Hard links where possible: same volume, no second copy on disk, and the file is a real file
    // rather than a link into a temp directory that may be cleaned up before the user ever uninstalls.
    const linkOrCopy = async (from, to) => {
      try {
        await fsp.link(from, to);
      } catch {
        await fsp.copyFile(from, to);
      }
    };
    for (const entry of await fsp.readdir(src, { withFileTypes: true })) {
      // The payload is the install archive, 150+ MB of application files. The uninstaller only ever
      // deletes things, so it never opens it, and copying it would double the app's footprint on
      // disk for no benefit. `uninstall.cmd` is the previous uninstaller, replaced by this one.
      if (entry.name === "payload.7z" || entry.name === "uninstall.cmd") continue;
      const from = path.join(src, entry.name);
      const to = path.join(uninstallerDir, entry.name);
      if (entry.isDirectory()) {
        // resources/ is a directory tree, so it is copied rather than linked; it is the small part.
        await fsp.cp(from, to, { recursive: true }).catch(() => {});
      } else if (entry.isFile()) {
        // Per-file, because one that cannot be linked or copied — a file still held open by the
        // running app, most likely — must not abandon the rest. Skipping one runtime file costs a
        // window that may not open; aborting the loop costs an uninstaller that definitely will not.
        await linkOrCopy(from, to).catch(() => {});
      }
    }
    // The program keeps its own file name — a portable build's is "JiuMate Installer.exe" — and
    // Electron locates resources/ by the directory, not by the name, so the file can be renamed to
    // match the entry that points at it. Left as-is the registry pointed at a path that did not
    // exist, because nothing here was ever named `JiuMate Uninstaller.exe`.
    const actualExe = path.join(uninstallerDir, `${PRODUCT} Installer.exe`);
    if (fs.existsSync(actualExe)) {
      await fsp.rename(actualExe, uninstaller).catch(async (err) => {
        // A rename across the link boundary can fail; a copy of the same file still works.
        if (err && err.code !== "ENOENT") {
          await fsp.copyFile(actualExe, uninstaller);
          await fsp.rm(actualExe, { force: true });
        }
      });
    }
  } catch (err) {
    // The app is installed either way. Without an uninstaller the user can still delete the folder
    // by hand, which is what the registry entry would otherwise be advertising.
    process.stdout.write(`[install] could not write the uninstaller: ${String(err)}\n`);
  }
  const quoted = `"${uninstaller}"`;

  // One `reg add` per value. `reg add` accepts a single `/v name /d data` pair per invocation —
  // passing several `/v` flags in one command is rejected outright, so the whole call fails and the
  // entry is never written at all. With one value it happened to work; adding QuietUninstallString
  // silently broke DisplayName and DisplayVersion too.
  const values = [
    ["DisplayName", PRODUCT],
    ["DisplayVersion", META.version],
    ["InstallLocation", target],
    ["UninstallString", `${quoted} --uninstall`],
    // Windows "Apps & features" builds its own command line from this when the user removes the
    // app from Settings rather than from the shortcut, and passes no flag of ours — so the mode has
    // to be a second string, not a flag the UI supplies.
    ["QuietUninstallString", `${quoted} --uninstall --quiet`],
    ["NoModify", "1"],
    ["NoRepair", "1"],
  ];
  for (const [name, data] of values) {
    await new Promise((resolve) => {
      const reg = spawn(
        "reg.exe",
        ["add", `HKCU\\${UNINSTALL_KEY}`, "/v", name, "/t", "REG_SZ", "/d", String(data), "/f"],
        { windowsHide: true },
      );
      reg.on("close", resolve);
      reg.on("error", resolve);
    });
  }
}

/**
 * The answers, for the app to read on its first launch.
 *
 * Written to %APPDATA%\JiuMate, which is the packaged app's userData — app.setName("JiuMate") runs
 * before anything reads it (app-identity.ts). The reader is packages/desktop/src/setup-import.ts;
 * the key names there (lang / mode / theme) are the ones the app's own locale and theme stores
 * expect, which is why `mode` is written here and not the `appearance` the theme grid shows.
 *
 * The API key is written only when the user actually typed one and did not choose to configure the
 * model later. It lands in a plaintext file in the user's profile — the same place the app keeps its
 * other settings — and is removed once the settings page has adopted it.
 */
ipcMain.handle("installer:save", async (_e, answers) => {
  const dir = path.join(process.env.APPDATA, PRODUCT);
  await fsp.mkdir(dir, { recursive: true });
  const ini = path.join(dir, "setup.ini");
  const lines = ["[setup]"];
  const put = (k, v) => lines.push(`${k}=${v ?? ""}`);
  put("lang", answers?.lang ?? "zh");
  put("mode", answers?.mode ?? "system");
  put("theme", answers?.themeId ?? "system");
  put("provider", answers?.provider ?? "");
  put("model", answers?.model ?? "");
  put("baseUrl", answers?.baseUrl ?? "");
  put("skipModel", answers?.skipModel ? "1" : "0");
  if (!answers?.skipModel && answers?.apiKey) put("apiKey", answers.apiKey);
  put("installerVersion", META.version);
  await fsp.writeFile(ini, lines.join("\r\n") + "\r\n", "utf8");
  return { ok: true, path: ini };
});

/**
 * Probe a provider so the button reports what the server said, not a guess. Only runs when the
 * user pressed it — nothing here is contacted without them asking.
 */
ipcMain.handle("installer:test-model", async (_e, opts) => {
  const key = String(opts?.apiKey || "").trim();
  if (!key) return { ok: false, error: "请先填写 API 密钥。" };
  // Direct vendors carry no preset URL in the catalog — AgentHub resolves those endpoints itself
  // (see gen-catalog.mjs). Probing an empty base URL produced a confusing fetch error, so the button
  // says what is actually true instead: a key cannot be verified without an endpoint to send it to.
  const base = String(opts?.baseUrl || "")
    .trim()
    .replace(/\/+$/, "");
  if (!base) {
    return {
      ok: false,
      error: "该提供商的端点由应用自动解析,安装器无法直接测试。请在应用中验证连接。",
    };
  }
  const model = String(opts?.model || "").trim();
  const url = model ? `${base}/v1/messages` : `${base}/v1/models`;
  try {
    const res = await fetch(url, {
      method: model ? "POST" : "GET",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        authorization: `Bearer ${key}`,
      },
      body: model
        ? JSON.stringify({ model, max_tokens: 1, messages: [{ role: "user", content: "hi" }] })
        : undefined,
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) return { ok: true, detail: `连接成功（HTTP ${res.status}）。` };
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      const msg = body?.error?.message || body?.message;
      if (msg) detail = String(msg);
    } catch {
      // A non-JSON error body is not worth reporting verbatim.
    }
    return { ok: false, error: `服务端返回：${detail}` };
  } catch (err) {
    return { ok: false, error: `无法连接：${err?.message || err}` };
  }
});

ipcMain.handle("installer:launch", async (_e, target) => {
  const exe = appExe(String(target || ""));
  if (!fs.existsSync(exe)) return { ok: false, error: "找不到已安装的程序。" };
  const child = spawn(exe, [], { detached: true, stdio: "ignore", windowsHide: false });
  child.unref();
  return { ok: true };
});

ipcMain.handle("installer:catalog", () => readStagedJson("catalog.json", []));
ipcMain.handle("installer:themes", () => readStagedJson("themes.json", []));
// Returns base64 rather than a path: a preload with contextIsolation has no filesystem access, and
// the renderer needs a data URL anyway under its CSP.
ipcMain.handle("installer:icon", () => {
  const file = stagedPath("icon.png");
  if (!file) return null;
  try {
    return fs.readFileSync(file).toString("base64");
  } catch {
    return null;
  }
});

/**
 * Remove the app: the running process, the shortcuts, the registry entry, the app's own settings,
 * then the install folder.
 *
 * The folder is the awkward part and the reason a helper exists. This program sits inside the
 * directory being deleted, and Windows refuses to remove a directory a running process holds open —
 * which is why the `uninstall.cmd` this replaced could delete itself and still leave the folder
 * behind. So the deletion is handed to a detached cmd that waits for this process to be gone, and
 * the caller is told the window is closing rather than being told the work is finished.
 *
 * Shortcuts are removed as plain files: a .lnk is a file, and deleting one needs no COM object.
 */
ipcMain.handle("installer:uninstall", async (event, opts) => {
  // The directory to remove is the INSTALL folder, not the one this file sits in.
  //
  // The uninstaller runs from `<install>\JiuMate Uninstaller\`, so path.dirname(process.execPath)
  // is that subfolder — deleting it would leave the whole application behind, which is exactly
  // what it looked like: the shortcut and registry entry gone, 380 files still on disk. The install
  // folder is one level up.
  //
  // Refused outright when this is not a real installed copy. Under `electron .` process.execPath is
  // Electron's own install directory, and an earlier version happily pointed the helper at THAT and
  // reported success — so every development-mode test was deleting Electron and leaving the
  // application untouched, which is why the folder appeared to survive deletion for so long.
  const self = path.dirname(process.execPath);
  const isInstalledCopy = path.basename(process.execPath).startsWith(`${PRODUCT} Uninstaller`);
  if (!isInstalledCopy) {
    return {
      ok: false,
      error: "未从安装目录运行，无法卸载。请从「设置 - 应用」或安装目录中的卸载程序启动。",
    };
  }
  // The install folder is this directory's PARENT: the uninstaller lives at
  // `<install>/JiuMate Uninstaller/`, so path.dirname(self) is the install folder itself. That was
  // briefly written as a sibling join while the uninstaller was living outside the install folder, and
  // left behind it pointed at a directory that does not exist — the readdir came back empty, the
  // handler reported success, and all 417 files stayed.
  const dir = path.dirname(self);
  // Each step reports a KEY, not a sentence. The wording is the renderer's to choose, which is why
  // this does not interpolate Chinese into a channel an English install also reads: the progress bar
  // used to scroll past Chinese text on an English machine.
  const step = (key, ratio) => send(event, key, ratio, key);

  // Where the user's sessions, projects and settings live, resolved exactly as the app resolves it
  // (core/src/state/paths.ts: `JIUMATE_HOME ?? ~/.jiumate/data`).
  //
  // The uninstaller was deleting %APPDATA%\JiuMate, which does not exist on this machine — the real
  // data is in ~/.jiumate (564 MB, 8687 files on the machine this was tested on). So the old "removed
  // your settings" claim was removing nothing, and the actual data was never offered to the user at
  // all. `dev-data` sits beside `data` and is deliberately not included: it is a development
  // artifact, not something an uninstaller has any business touching.
  const dataRoot = process.env.JIUMATE_HOME || path.join(os.homedir(), ".jiumate", "data");

  try {
    step("unStep_closing", 0.08);
    await new Promise((resolve) => {
      // The tree, not just the main process: Electron's renderer and GPU children keep the
      // application's files mapped, and those are the files about to be deleted.
      const killer = spawn("taskkill.exe", ["/IM", `${PRODUCT}.exe`, "/T", "/F"], {
        windowsHide: true,
      });
      killer.on("close", resolve);
      killer.on("error", resolve);
    });

    step("unStep_links", 0.25);
    // Only the desktop path comes from Electron. `app.getPath("startMenu")` throws when it cannot
    // be resolved, and it threw here — which aborted the whole handler, so the registry entry and
    // the folder deletion never ran and the uninstall reported a failure while removing nothing. The
    // per-user Start Menu location is spelled out below instead, which is also where a shortcut
    // installed by the app actually lives.
    const desktopDir = app.getPath("desktop");
    for (const link of [
      path.join(desktopDir, `${PRODUCT}.lnk`),
      path.join(
        process.env.APPDATA || "",
        "Microsoft",
        "Windows",
        "Start Menu",
        "Programs",
        `${PRODUCT}.lnk`,
      ),
    ]) {
      try {
        fs.rmSync(link, { force: true });
      } catch {
        // Already gone, or held open by the shell. The registry entry below is what actually hides
        // it from Apps & Features, so a surviving .lnk is cosmetic rather than a failed uninstall.
      }
    }

    step("unStep_registry", 0.45);
    await new Promise((resolve) => {
      const reg = spawn("reg.exe", ["delete", `HKCU\\${UNINSTALL_KEY}`, "/f"], {
        windowsHide: true,
      });
      reg.on("close", resolve);
      reg.on("error", resolve);
    });

    // Setup's own record of the answers, which tells the uninstaller which language to speak and
    // tells a future install which language/theme to pre-select. Small, and not user content, so it
    // goes with the application rather than being offered as a choice.
    try {
      fs.rmSync(path.join(process.env.APPDATA || "", PRODUCT), { recursive: true, force: true });
    } catch {
      // A single locked file should not block removing the rest.
    }

    // The user's own data, only when asked. Off by default: this is their sessions, projects and
    // settings, and a reinstall afterwards should find them intact. Removing it is a decision, not a
    // side effect of uninstalling.
    if (opts?.deleteData) {
      step("unStep_data", 0.7);
      try {
        fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 6, retryDelay: 400 });
      } catch {
        // Reported through the same channel as the folder removal: the caller checks what is left.
      }
    }

    // The uninstaller's own directory is removed LAST, after the application folder. It is a sibling
    // rather than a child precisely so that it is not holding the target directory open — the one
    // thing that made the target undeletable. By the time this runs the app is gone, nothing else is
    // running, and the two directories can be removed together.
    step("unStep_files", 0.8);
    // First pass: everything except the uninstaller's own subfolder goes, and this process is alive
    // to see it happen. `final` is set by the second click, which is the only way to remove the last
    // directory — the one holding this executable.
    const cleared = await removeInstallFolder(dir, self, event, false);
    if (!cleared) {
      return { ok: false, error: "应用文件未能完全删除，请关闭相关程序后重试。" };
    }
    step("unStep_done", 1);
    return {
      ok: true,
      // The window stays up and offers the second click. Closing here would leave the uninstaller's
      // own folder behind with nothing to remove it — which is what "it says it's gone but the folder
      // is still there" looked like.
      pending: true,
    };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

/**
 * The second click: remove what is left, including the directory the uninstaller is running from.
 *
 * Separate from `installer:uninstall` on purpose. That one runs with a window up and can report what it
 * achieved; this one cannot report anything, because the helper's work begins after this process has
 * gone. It therefore returns immediately and the caller closes the window.
 */
/**
 * A Windows path as a PowerShell single-quoted string literal.
 *
 * Single quotes are literal in PowerShell, so only the quote itself needs handling — doubled. A path
 * containing a quote is vanishingly rare, but silently generating a broken script would leave the
 * folder behind with nothing to show why.
 */
function psLiteral(p) {
  return "'" + p.replace(/'/g, "''") + "'";
}

/**
 * The purge helper: a PowerShell script run from TEMP, launched detached by `cmd /c start`.
 *
 * It exists because the uninstaller cannot delete the folder it is running from — its own mapped
 * executable is in there. The sequence is: write this, launch it, close the window, exit, and the
 * script waits for that exit and then removes what is left.
 *
 * PowerShell rather than JavaScript for one concrete reason. A JS helper had to be launched by
 * `process.execPath`, which IS the uninstaller — an executable inside the folder being removed — and
 * Windows accounts for a mapped image by its own path, so it held open the very file the purge existed
 * to release. PowerShell lives in System32, outside the install tree, so it shares no file and no lock
 * with the target.
 *
 * ASCII throughout: Windows PowerShell reads .ps1 as the system ANSI code page, so a non-ASCII comment
 * arrives as mojibake and the parser reports errors against lines that are correct.
 *
 * The first statement writes a log line, before any waiting. A helper's fate has to be read from what it
 * did; inferring it from the absence of output is what sent six rounds of redesign after a cause — a
 * `detached` flag — that was present in the very first version.
 */
const HELPER_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$appDir = @@DIR@@
$selfDir = @@SELF@@
$log = @@LOG@@
Add-Content -LiteralPath $log -Value ('helper started pid=' + $PID) -Encoding UTF8

# Wait for the uninstaller to go. It closes its own window and exits, which releases every mapped file;
# until then the folder cannot be removed. A pid lookup, not an image-name one — the helper must not
# share an image with anything it is trying to delete.
$gone = $false
for ($i = 0; $i -lt 60; $i++) {
  if (-not (Get-Process -Id @@PID@@ -ErrorAction SilentlyContinue)) { $gone = $true; break }
  Start-Sleep -Milliseconds 500
}
Add-Content -LiteralPath $log -Value ('uninstaller gone=' + $gone) -Encoding UTF8
if (-not $gone) { Add-Content -LiteralPath $log -Value 'giving up' -Encoding UTF8; exit 1 }

# The application folder, then the uninstaller's own directory — siblings under the same parent, which
# is what keeps this one directory for one program. The retries cover the lag between the process
# exiting and Windows actually releasing its files.
$removed = $false
for ($i = 0; $i -lt 40; $i++) {
  try { Remove-Item -LiteralPath $appDir -Recurse -Force -ErrorAction Stop } catch { }
  if (-not (Test-Path -LiteralPath $appDir)) { $removed = $true; break }
  Start-Sleep -Milliseconds 750
}
Add-Content -LiteralPath $log -Value ('app dir removed=' + $removed) -Encoding UTF8
if ($removed) {
  for ($i = 0; $i -lt 20; $i++) {
    try { Remove-Item -LiteralPath $selfDir -Recurse -Force -ErrorAction Stop } catch { }
    if (-not (Test-Path -LiteralPath $selfDir)) { break }
    Start-Sleep -Milliseconds 500
  }
  Add-Content -LiteralPath $log -Value ('self dir removed=' + (-not (Test-Path -LiteralPath $selfDir))) -Encoding UTF8
}
if ($removed) { exit 0 } else { exit 1 }
`;

ipcMain.handle("installer:finalizeUninstall", async (event) => {
  try {
    const self = path.dirname(process.execPath);
    if (!path.basename(process.execPath).startsWith(`${PRODUCT} Uninstaller`)) {
      return { ok: false, error: "未从安装目录运行，无法完成卸载。" };
    }
    const scheduled = await removeInstallFolder(path.dirname(self), self, event, true);
    return { ok: scheduled };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

async function removeInstallFolder(dir, self, event, final) {
  // Pass one removes everything except the uninstaller's own subfolder, with this process alive and
  // the window up. That is the part the user watches, and it leaves the application uninstalled in
  // every sense that matters: no executable, no shortcut, no registry entry.
  if (!final) {
    const pending = [];
    let entries = [];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return true;
    }
    for (const e of entries) {
      if (path.join(dir, e.name) === self) continue;
      pending.push(path.join(dir, e.name));
    }
    for (const p of pending) {
      try {
        await fsp.rm(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
      } catch {
        // A file the shell still holds is retried on a later run.
      }
    }
    const left = await fsp.readdir(dir).catch(() => []);
    return left.length === 1 && left[0] === path.basename(self);
  }

  // What is left is the uninstaller's own subfolder, and it cannot be removed from inside it: this
  // process's mapped executable sits in there, and Windows will not remove a directory holding a
  // running image. So the removal goes to a script in TEMP, launched through `cmd /c start` so that it
  // survives this process exiting. The caller closes the window immediately afterwards, and that exit
  // is the first step of the deletion rather than a side effect of it.
  const stamp = Date.now() + "-" + process.pid;
  const tmp = process.env.TEMP || os.tmpdir();
  const helper = path.join(tmp, PRODUCT + "-remove-" + stamp + ".ps1");
  const log = path.join(tmp, PRODUCT + "-remove-" + stamp + ".log");
  // replaceAll, not replace: the template mentions @@PID@@ more than once, and a single replacement
  // leaves the rest in the generated script — which parses, runs, and then waits on a pid that is
  // literally the text '@@PID@@'.
  const script = HELPER_SCRIPT.replaceAll("@@DIR@@", psLiteral(dir))
    .replaceAll("@@SELF@@", psLiteral(self))
    .replaceAll("@@LOG@@", psLiteral(log))
    .replaceAll("@@PID@@", String(process.pid));

  try {
    fs.writeFileSync(helper, script, "utf8");
  } catch {
    return false;
  }

  // `cmd /c start "" /b` — and the empty string is not optional. `start` takes the first quoted
  // argument as the window title, so without it a quoted script path is consumed as the title and
  // nothing runs.
  //
  // This is also the only launch form measured to both run the script and outlive this process.
  // Spawning powershell directly runs it but ties its lifetime to this one, so it dies when the app
  // quits — which is precisely when it is needed. `detached: true` looks like the fix and is not: it
  // stops the script running altogether, no output and no log, every time. Measured side by side on
  // the same script: powershell-detached "did not run", cmd-start "RAN".
  spawn(
    "cmd.exe",
    [
      "/c",
      "start",
      "",
      "/b",
      "powershell.exe",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      helper,
    ],
    { stdio: "ignore", windowsHide: true },
  );
  return true;
}
ipcMain.handle("installer:uninstallLang", () => {
  try {
    const ini = fs.readFileSync(path.join(process.env.APPDATA || "", PRODUCT, "setup.ini"), "utf8");
    const m = /^lang=(.+)$/m.exec(ini);
    const lang = m ? m[1].trim() : "";
    return lang === "zh" || lang === "en" ? lang : "";
  } catch {
    return "";
  }
});

/**
 * Total bytes under a directory, for the size figures the uninstall page shows.
 *
 * One function for both figures so they cannot drift: it is the same walk, and the two numbers are
 * the same kind of number. A missing directory is 0 rather than an error — a machine that has never
 * run the app has no data folder, and that is a fact about the machine, not a failure.
 */
function dirBytes(dir) {
  let total = 0;
  const walk = (d) => {
    let entries = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else {
        try {
          total += fs.statSync(full).size;
        } catch {
          // A file that vanished mid-walk; the total is an estimate either way.
        }
      }
    }
  };
  walk(dir);
  return total;
}

/** Bytes the uninstall would reclaim from the application itself. */
ipcMain.handle("installer:uninstallSize", () => dirBytes(path.dirname(process.execPath)));

/**
 * Bytes of the user's own data, shown when the "also remove my data" box is on.
 *
 * The same root the app resolves (core/src/state/paths.ts), and deliberately only `data` — the
 * `dev-data` sibling is a development artifact that an uninstaller has no business counting or
 * removing. On a used machine this is the larger number by a wide margin, which is the point: it is
 * what makes the checkbox a decision instead of a formality.
 */
ipcMain.handle("installer:dataSize", () =>
  dirBytes(process.env.JIUMATE_HOME || path.join(os.homedir(), ".jiumate", "data")),
);

ipcMain.handle("installer:minimize", () => win?.minimize());
ipcMain.handle("installer:close", () => app.quit());

/**
 * Read one of the generated data files.
 *
 * Defaults to an empty list rather than throwing: a missing file leaves the page visibly empty,
 * which is diagnosable, whereas an exception in a handler blanks the window with no explanation.
 */
function readStagedJson(name, fallback) {
  const file = stagedPath(name);
  if (!file) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}
