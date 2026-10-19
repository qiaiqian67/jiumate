/**
 * The packed Windows build, driven for real.
 *
 * Everything else has been verified by reading files: the bundle contains `my-auto`, the
 * dependency list holds six more plugins than it did, the bundled CLI reports the right commit.
 * All of that is consistent with a working installer and none of it is the same thing — a bundle
 * can contain a string while the page still does not do it, and an installer can carry a file the
 * page never loads.
 *
 * So this starts `out\win-unpacked\JiuMate.exe`, waits for the server it forks, and drives the
 * login form in a browser: type into the password field, confirm the figures avert, click away,
 * confirm they come back and the pupils follow the pointer again. That last part is the fix —
 * `passwordTyped` used to be derived from the field's contents alone, so once a password was typed
 * the figures stayed looking away after blur and stopped moving entirely.
 *
 * It lives here rather than in the desktop package because that is where `playwright-core` already
 * is, and adding a browser driver to a package that has no other use for one to prove a single
 * installer is a poor trade. Skips when the installer has not been built, so the ordinary test run
 * stays green.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";

const PACKED = join(process.cwd(), "..", "desktop", "out", "win-unpacked", "JiuMate.exe");
const built = existsSync(PACKED);

let app: ChildProcess | undefined;
let browser: Browser | undefined;
let page: Page | undefined;
let baseUrl = "";
/** A data root of its own, so the packed app never touches a real installation's data. */
let root = "";
const log: string[] = [];

/** Reads the embedded server's URL out of the app's startup output. */
async function waitForServer(timeoutMs = 120_000): Promise<string> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const line = log.find((l) => l.includes("jiumate-server started:"));
    if (line !== undefined) {
      const m = /started:\s*(\S+)/.exec(line);
      if (m !== null && m[1] !== undefined) return m[1];
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `the packed app did not report a server URL within ${timeoutMs}ms:\n${log.join("\n")}`,
  );
}

beforeAll(async () => {
  if (!built) return;
  root = mkdtempSync(join(tmpdir(), "jiumate-packed-"));
  app = spawn(PACKED, [], {
    env: { ...process.env, JIUMATE_HOME: root, ELECTRON_ENABLE_LOGGING: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [app.stdout, app.stderr]) {
    stream?.setEncoding("utf8");
    stream?.on("data", (chunk: string) => {
      log.push(...chunk.split(/\r?\n/).filter((l) => l.trim() !== ""));
    });
  }
  baseUrl = await waitForServer();
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${baseUrl}/login`);
  await page.waitForSelector(".watch-panel", { state: "attached", timeout: 30_000 });
}, 180_000);

afterAll(async () => {
  await browser?.close();
  if (app !== undefined) {
    app.kill();
    // The shell spawns the server as a child; killing the parent can leave it running.
    await new Promise((r) => setTimeout(r, 2_000));
  }
  if (root !== "") rmSync(root, { recursive: true, force: true });
});

/** Each figure's eye offset, and whether the look-away attribute is set. */
const eyeShift = () =>
  page!.evaluate(() =>
    [...document.querySelectorAll(".watch-eyes")].map((el) => {
      const first = getComputedStyle(el).translate.split(" ")[0] ?? "";
      return { x: first === "none" ? 0 : Number.parseFloat(first), lookAway: el.hasAttribute("data-look-away") };
    }),
  );

describe.skipIf(!built)("打包后的 Windows 客户端", () => {
  it("启动，并使用安装包内的 web-dist", async () => {
    expect(baseUrl, "未读到服务地址").toMatch(/^http:\/\/localhost:\d+/);
    const webDist = log.find((l) => l.includes("Web dist:")) ?? "";
    expect(webDist, "未使用包内 web-dist").toContain("win-unpacked");
  });

  it("密码框输入 → 全体左看", async () => {
    await page!.fill('input[autocomplete="current-password"]', "hunter2");
    await page!.waitForTimeout(400);
    const eyes = await eyeShift();
    expect(eyes).toHaveLength(4);
    for (const [i, e] of eyes.entries()) {
      expect(e.lookAway, `第 ${i} 组眼未进入左看`).toBe(true);
      expect(e.x, `第 ${i} 组眼未左移`).toBeLessThan(-1);
    }
  });

  it("失焦 → 立即还原，且指针跟随恢复", async () => {
    // 点标题：离开密码框，但不碰任何输入。
    await page!.click("h1");
    await page!.waitForTimeout(500);
    const eyes = await eyeShift();
    for (const [i, e] of eyes.entries()) {
      expect(e.lookAway, `第 ${i} 组眼在失焦后仍处于左看`).toBe(false);
      expect(e.x, `第 ${i} 组眼在失焦后未完全还原`).toBe(0);
    }
    // 密码仍在框里 —— 修复的关键就在这里。
    expect(await page!.inputValue('input[autocomplete="current-password"]'), "失焦不应清空密码").toBe(
      "hunter2",
    );

    const pupilX = () =>
      page!.evaluate(() => {
        const p = document.querySelector(".watch-pupil");
        return p === null ? 0 : p.getBoundingClientRect().x;
      });
    const before = await pupilX();
    await page!.mouse.move(200, 200);
    await page!.mouse.move(700, 500);
    await page!.waitForTimeout(300);
    expect(Math.abs((await pupilX()) - before), "失焦后瞳孔不再跟随指针").toBeGreaterThan(0.2);
  });

  it("重新聚焦密码框 → 重新左看", async () => {
    await page!.click('input[autocomplete="current-password"]');
    await page!.waitForTimeout(400);
    for (const [i, e] of (await eyeShift()).entries()) {
      expect(e.lookAway, `第 ${i} 组眼未重新左看`).toBe(true);
    }
  });

  it("表单在品牌与版权之间居中", async () => {
    const b = await page!.evaluate(() => {
      const read = (sel: string) => {
        const r = document.querySelector(sel)?.getBoundingClientRect();
        return { top: r?.top ?? 0, bottom: r?.bottom ?? 0 };
      };
      return {
        title: read("h1"),
        form: read("form"),
        copyright: read("#root p.text-center.text-xs"),
      };
    });
    const above = b.form.top - b.title.bottom;
    const below = b.copyright.top - b.form.bottom;
    expect(above, "表单贴着品牌").toBeGreaterThan(0);
    expect(below, "表单贴着版权").toBeGreaterThan(0);
    expect(Math.abs(above - below), `上 ${above} / 下 ${below}`).toBeLessThan(40);
  });
});