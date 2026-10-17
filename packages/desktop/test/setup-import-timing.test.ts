/**
 * The two defects that made the installer's choices look like they had been ignored.
 *
 * Both were invisible to unit tests, which is why they survived: each link of the chain is correct
 * on its own, and the failure is in *when* and *whether anything reads the result*. These tests
 * read the source, the same approach as `account-menu.test.ts` — what is worth pinning is the
 * wiring, not the pixels.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = (p: string) =>
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), p), "utf8");

const MAIN = src("../src/main.ts");
const PRELOAD = src("../src/preload.ts");
const SETUP_MODEL = src("../../web/src/lib/setup-model.ts");
const TRAY = src("../src/tray.ts");
const ROUTER = src("../../web/src/router.tsx");

describe("安装器选择的生效时机", () => {
  it("seed 由 preload 同步写入，不再用 dom-ready", () => {
    // `dom-ready` 对 302 之后的最终文档才触发，那时 React 已挂载、store 已从 localStorage 建好
    // 初始状态；写入落在一个没人再读的键上，所以选择永远不生效。
    expect(MAIN).not.toMatch(/on\("dom-ready"/);
    expect(MAIN).not.toContain("seedSetupPreferences");
    // preload 是唯一保证早于页面脚本的时机。
    expect(PRELOAD).toContain("--jiumate-setup-seed=");
    expect(PRELOAD).toContain("localStorage.setItem(key, value)");
  });

  it("seed 通过 additionalArguments 传入，而不是 IPC", () => {
    // IPC 是异步的：preload await 的那一刻就会把执行权让出去，页面脚本插进来 —— 竞态只是换了
    // 个位置，没有消失。
    expect(MAIN).toContain("additionalArguments: setupSeedArg()");
    expect(PRELOAD).not.toMatch(/await ipcRenderer\.invoke\("setup:/);
    expect(PRELOAD).not.toMatch(/ipcRenderer\s*\.\s*invoke\("setup:/);
  });

  it("模型选择有读取方了", () => {
    // 曾经只写 setup-model.json 而无人读取：文件是 bug 的可见的那一半。
    expect(MAIN).toContain("--jiumate-setup-model=");
    expect(PRELOAD).toContain("jiumateSetup");
    expect(SETUP_MODEL).toContain("window.jiumateSetup");
    // 组件挂载在 ProjectProvider 内，因为默认模型是 project-scoped。
    expect(ROUTER).toContain("<SetupModelApplier />");
  });

  it("模型只应用一次，不会覆盖用户之后的选择", () => {
    expect(SETUP_MODEL).toContain("jiumate.setupModelConsumed");
    expect(SETUP_MODEL).toContain("notYetApplied");
  });

  it("skipModel 表示用户选择稍后配置，不应用任何模型", () => {
    expect(SETUP_MODEL).toMatch(/raw\.skipModel === true[\s\S]{0,80}return null/);
  });
});

describe("系统托盘", () => {
  it("只有一个托盘，宠物开关在同一菜单里", () => {
    expect(TRAY).toContain("new Tray(icon)");
    // 托盘随窗口创建而建，不随桌宠开关而开关 —— 否则托盘会在用户没要求的时候消失。
    expect(MAIN).toContain("ensureAppTray(appTrayDeps())");
    // 曾经有两个 Tray 对象（pet-tray.ts + tray.ts），通知区里一个应用两个图标。现在只剩一个。
    expect(MAIN).not.toContain("syncPetTray");
    expect(MAIN).not.toContain("destroyPetTray");
    expect(MAIN).not.toContain("wirePetTrayIpc");
    // 宠物的启用状态只作为复选框状态镜像进这一个菜单。
    expect(MAIN).toContain('ipcMain.handle("pet:setEnabled"');
    expect(MAIN).toContain("setPetEnabled");
    expect(TRAY).toContain("setPetEnabled");
  });

  it("会话列表由渲染进程推送，主进程不自己拉", () => {
    // 主进程没有 Project/Agent，无法向服务端要列表；那是渲染进程的状态。
    expect(MAIN).toContain('ipcMain.handle("tray:setRecent"');
    expect(PRELOAD).toContain("trayRecent");
    expect(ROUTER).toContain("<TrayRecentSync />");
  });

  it("托盘点击由页面路由，shell 不自己导航", () => {
    expect(MAIN).toContain('win?.webContents.send("tray:navigate", path)');
    expect(PRELOAD).toContain("trayNavigate");
  });

  it("关闭按钮只是隐藏窗口", () => {
    expect(MAIN).toMatch(/win\.on\("close",[\s\S]{0,220}preventDefault\(\)/);
    expect(MAIN).toMatch(/win\.on\("close",[\s\S]{0,220}win\?\.hide\(\)/);
  });

  it("退出走 quitting 标志，所以应用仍可退出", () => {
    // 没有这个标志，close 拦截会让托盘菜单里的「退出」也变成隐藏窗口，应用就无法退出了。
    expect(MAIN).toMatch(/function quitApp\(\)[\s\S]{0,120}quitting = true/);
    expect(MAIN).toMatch(/win\.on\("close",[\s\S]{0,120}if \(quitting\) return/);
    expect(MAIN).toContain("destroyAppTray()");
  });

  it("唤醒隐藏窗口时先 show 再 restore", () => {
    // 隐藏的窗口不是最小化的：只 restore() 会让它依然不可见，托盘点击和二次启动都会像没反应。
    expect(MAIN).toMatch(/function focusMain[\s\S]{0,260}win\.show\(\);[\s\S]{0,120}restore\(\)/);
    expect(MAIN).toMatch(/second-instance[\s\S]{0,400}focusMain\(\)/);
  });

  it("托盘图标缺失时安静降级，而不是崩溃", () => {
    expect(TRAY).toContain("if (deps.iconPath === null) return");
    expect(TRAY).toContain("icon.isEmpty()");
  });
});