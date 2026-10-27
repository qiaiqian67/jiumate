// Drives the full uninstall and reads the helper's own log, so the second step's outcome is measured
// rather than inferred.
//
// The failure this replaces was diagnosed by the absence of output: the .ps1 reached TEMP, no .log
// appeared, and "the helper was killed with the uninstaller" was concluded and acted on for six rounds.
// The helper now logs its first statement before anything else, so every run answers the question
// directly — did it start, did the uninstaller go, and did the folders go.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const PORT = 9222;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const target = path.join(process.env.LOCALAPPDATA, "Programs", "JiuMate");
const selfDir = path.join(target, "JiuMate Uninstaller");
const dataRoot = path.join(os.homedir(), ".jiumate", "data");
const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"));

function count(dir) {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    n += e.isDirectory() ? count(path.join(dir, e.name)) : 1;
  }
  return n;
}
const tmpFiles = (suffix) =>
  fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith("JiuMate-remove-") && f.endsWith(suffix));

async function ev(expr) {
  try {
    const t = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const p = t.find((x) => x.type === "page");
    if (!p) return "<no page>";
    const ws = new WebSocket(p.webSocketDebuggerUrl);
    await new Promise((r, j) => {
      ws.addEventListener("open", r);
      ws.addEventListener("error", j);
    });
    const v = await new Promise((res) => {
      ws.addEventListener("message", (e) => {
        const m = JSON.parse(e.data);
        if (m.id === 1) res(m.result?.result?.value);
      });
      ws.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: { expression: expr, returnByValue: true },
        }),
      );
    });
    ws.close();
    return v;
  } catch {
    return "<gone>";
  }
}
async function waitForPage(sec = 40) {
  for (let i = 0; i < sec * 2; i++) {
    if ((await ev("1+1")) === 2) return true;
    await sleep(500);
  }
  return false;
}

const dataBefore = count(dataRoot);
console.log(`历史数据: ${dataBefore} 文件\n=== 安装 ===`);
spawn(
  path.join(ROOT, "out", "win-unpacked", "JiuMate Installer.exe"),
  [`--remote-debugging-port=${PORT}`],
  { detached: true, stdio: "ignore" },
);
if (!(await waitForPage())) throw new Error("安装器未启动");
await sleep(1200);
await ev(
  `window.__r = 1; window.installer.start({ target: ${JSON.stringify(target)}, desktop: true, startMenu: true }).then(r => { window.__r = JSON.stringify(r) }); 1`,
);
for (let i = 0; i < 200; i++) {
  const v = await ev("String(window.__r)");
  if (v && v !== "1") break;
  await sleep(1000);
}
console.log("安装:", await ev("String(window.__r)"));

console.log("\n=== 卸载：第一次点击 ===");
spawnSync("taskkill", ["/IM", "JiuMate Installer.exe", "/T", "/F"], { stdio: "ignore" });
await sleep(2500);
spawn(
  path.join(selfDir, "JiuMate Uninstaller.exe"),
  ["--uninstall", `--remote-debugging-port=${PORT}`],
  { detached: true, stdio: "ignore" },
);
if (!(await waitForPage())) throw new Error("卸载器未启动");
await sleep(1500);
await ev("document.getElementById('uninstallGo').click(); 1");
await sleep(7000);
console.log("剩余:", count(target), "文件");

console.log("\n=== 卸载：彻底删除 ===");
await ev("document.getElementById('undonePurge').click(); 1");

// The window is expected to close, so this stops talking to it. The filesystem and the helper's log are
// the only things that matter from here.
await sleep(3000);
let gone = !fs.existsSync(target);
for (const w of [2000, 4000, 6000, 10000]) {
  await sleep(w);
  gone = !fs.existsSync(target);
  if (gone) break;
}

console.log("\n=== helper 日志 ===");
const logs = tmpFiles(".log");
if (!logs.length) console.log("(无日志 -> PowerShell 未执行)");
for (const f of logs) {
  console.log(f + ":");
  console.log(fs.readFileSync(path.join(os.tmpdir(), f), "utf8"));
}

console.log("=== 结果 ===");
console.log("软件目录已删除:", gone ? "✓" : "✗ 仍有 " + count(target) + " 文件");
console.log("历史数据:", count(dataRoot) === dataBefore ? "✓ 完好保留" : "✗ 变了");
console.log(
  "桌面快捷方式:",
  fs.existsSync(path.join(os.homedir(), "Desktop", "JiuMate.lnk")) ? "✗ 残留" : "✓ 已清",
);
console.log("TEMP 残留:", tmpFiles(""));
