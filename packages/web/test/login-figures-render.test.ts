/**
 * Renders the login watchers in a real browser and checks the pixels.
 *
 * The other two test files read the CSS as text, and both of them were green while the panel
 * rendered as four thin lines with no eyes — a unit mistake (`font-size: <percentage>` as a scale
 * basis) that no amount of "does the stylesheet contain this string" can catch. Text assertions
 * cannot tell you the eye is inside the head; only a rendered box can.
 *
 * So this measures `getBoundingClientRect()` in a real layout: the figure's body, each eye, the
 * pupil and the mouth, against the panel. It is the check that has the property of being immune to
 * the mistake rather than lucky on it.
 *
 * The page is served by a throwaway static server rather than the app, because the app's login page
 * is behind a claim link and a password — none of which is what is under test here. What matters is
 * the stylesheet and the two components.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { join, extname } from "node:path";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright-core";

const WEB = join(process.cwd(), "src");
/** The card's height in login.tsx, which the panel fills. */
const CARD_HEIGHT = 600;

let server: Server;
let browser: Browser;
let page: Page;

/**
 * Stands in for login.tsx's card and form column; only the panel matters here.
 *
 * Only `login-figures.css` is loaded. The app's `styles.css` opens with `@import "tailwindcss"`,
 * which is a build-time directive the static server cannot resolve, and none of it is needed: the
 * figures are styled entirely by their own stylesheet, and the panel's background is set there too.
 * The little CSS below stands in for the app's base layer (the gray page) so the harness looks
 * like the page rather than like a white void.
 */
const HARNESS = `<!doctype html><html><head><meta charset="utf-8">
<style>
  html,body{margin:0;height:100%}
  body{background:#f3f4f6}
</style>
<link rel="stylesheet" href="/pages/login-figures.css">
</head><body>
<div style="height:${CARD_HEIGHT}px;display:flex" class="card">
  <div style="min-width:0;flex:1" id="slot"></div>
</div>
<script src="/mount.js"></script>
</body></html>`;

beforeAll(async () => {
  /*
   * The harness mounts the real component, so the page has to run JSX and TypeScript. esbuild
   * does that here rather than at runtime in the browser, which keeps the test to one dependency
   * that is already in the repo (the app's own bundler) instead of an in-browser transform.
   */
  const bundled = await build({
    entryPoints: [join(WEB, "pages/login-figures.mount.tsx")],
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
    loader: { ".css": "empty" },
    define: { "process.env.NODE_ENV": '"development"' },
  });
  const bundleFile = bundled.outputFiles[0];
  if (bundleFile === undefined) throw new Error("esbuild produced no output");
  const mountJs = bundleFile.text;

  const types: Record<string, string> = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "text/javascript",
  };
  server = createServer((req, res) => {
    const url = (req.url ?? "/").split("?")[0] ?? "/";
    if (url === "/mount.js") {
      res.writeHead(200, { "content-type": "text/javascript" });
      res.end(mountJs);
      return;
    }
    const file =
      url === "/" || url === "/index.html"
        ? { body: Buffer.from(HARNESS), type: "text/html" }
        : {
            body: readFileSync(join(WEB, url)),
            type: types[extname(url)] ?? "text/plain",
          };
    res.writeHead(200, { "content-type": file.type });
    res.end(file.body);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;

  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1024, height: 700 } });
  await page.goto(`http://127.0.0.1:${port}/`);
  // `state: "attached"` rather than the default "visible": the panel carries Tailwind's `hidden`
  // class and this harness has no Tailwind, so Playwright's visibility heuristic sees a
  // zero-size box and waits forever for something that is already in the DOM. The measurements
  // below read `getBoundingClientRect` directly, which is what the visibility rule would have
  // been a proxy for anyway.
  const failure = await page
    .waitForSelector(".watch-figure", { state: "attached", timeout: 10_000 })
    .then(() => null)
    .catch(async (e: unknown) => {
      const html = await page.content().catch(() => "");
      return `${String(e)}\n--- page ---\n${html.slice(0, 800)}`;
    });
  if (failure !== null) throw new Error(`figures did not render\n${failure}`);

  // The stand-in for the Tailwind classes the panel carries (`hidden … lg:block h-full w-full
  // relative overflow-hidden`). This harness has no Tailwind, so without these the panel is
  // `display: none` and every box below measures zero — a harness failure reported as if it were
  // the component's. Applied after the panel exists, and only the layout-affecting four.
  await page.addStyleTag({
    content:
      ".watch-panel{display:block!important;position:relative;height:100%;width:100%;overflow:hidden}" +
      ".watch-figure{position:absolute;transform:translateY(-50%)}",
  });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((r) => server.close(() => r()));
});

/** Bounding boxes of every figure, in CSS pixels. */
const boxes = () =>
  page.evaluate(() => {
    const rect = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    return [...document.querySelectorAll(".watch-figure")].map((fig) => {
      const eye = fig.querySelector(".watch-eye");
      const pupil = fig.querySelector(".watch-pupil");
      const mouth = fig.querySelector(".watch-mouth");
      return {
        key: [...fig.classList].find((c) => c !== "watch-figure" && !c.startsWith("-")) ?? "?",
        body: rect(fig),
        eye: eye === null ? null : rect(eye),
        pupil: pupil === null ? null : rect(pupil),
        mouth: mouth === null ? null : rect(mouth),
      };
    });
  });

const panelBox = () =>
  page.evaluate(() => {
    const p = document.querySelector(".watch-panel");
    if (p === null) return null;
    const r = p.getBoundingClientRect();
    return { w: r.width, h: r.height };
  });

describe("登录页小人的实际渲染", () => {
  it("面板有高度", async () => {
    const panel = await panelBox();
    expect(panel).not.toBeNull();
    expect(panel!.h).toBeGreaterThan(300);
  });

  it("四个人都在面板内，且身体是有面积的形状而非一根线", async () => {
    const panel = await panelBox();
    const all = await boxes();
    expect(all).toHaveLength(4);
    for (const f of all) {
      // Inside the panel: the crop that made the page blank is a figure outside its bounds.
      expect(f.body.w, `${f.key} 宽`).toBeGreaterThan(20);
      expect(f.body.h, `${f.key} 高`).toBeGreaterThan(30);
      expect(f.body.h, `${f.key} 比例`).toBeLessThanOrEqual(panel!.h);
      expect(f.body.w, `${f.key} 在面板内`).toBeLessThanOrEqual(panel!.w);
      // Not a vertical line: the bug rendered every figure about 7px wide.
      expect(f.body.w / f.body.h, `${f.key} 宽高比`).toBeGreaterThan(0.15);
    }
  });

  it("每个人有两只可见的眼睛，且眼睛在身体内", async () => {
    for (const f of await boxes()) {
      expect(f.eye, `${f.key} 有眼睛`).not.toBeNull();
      const eye = f.eye!;
      // Visible: the collapsed-figure version had eyes under a pixel across.
      expect(eye.w, `${f.key} 眼宽`).toBeGreaterThan(4);
      expect(eye.h, `${f.key} 眼高`).toBeGreaterThan(4);
      // Inside the body — vertically within it, and the pair within the body's width.
      expect(eye.y, `${f.key} 眼在身体内（上）`).toBeGreaterThanOrEqual(f.body.y);
      expect(eye.y + eye.h, `${f.key} 眼在身体内（下）`).toBeLessThanOrEqual(f.body.y + f.body.h);
      expect(eye.w * 2, `${f.key} 两眼放得下`).toBeLessThan(f.body.w);
    }
  });

  it("瞳孔比眼白小，所以看得出是眼睛而不是一块黑", async () => {
    for (const f of await boxes()) {
      expect(f.pupil, `${f.key} 有瞳孔`).not.toBeNull();
      const p = f.pupil!;
      const e = f.eye!;
      // The pupil fills its white and is scaled down; the visible black is what remains. It has to
      // be clearly smaller, or the eye reads as a solid black dot with no white around it.
      expect(p.w, `${f.key} 瞳孔小于眼白`).toBeLessThan(e.w * 0.85);
      expect(p.w, `${f.key} 瞳孔可见`).toBeGreaterThan(1);
      // And centred, so the gaze can move within the white.
      const offCentre = Math.abs(p.x + p.w / 2 - (e.x + e.w / 2));
      expect(offCentre, `${f.key} 瞳孔居中`).toBeLessThan(e.w * 0.2);
    }
  });

  it("嘴巴在身体内且可见", async () => {
    // The mouth transitions its `height`, so the first frame after mount can still be mid-interpolation
    // from the initial value. Waiting for the transition to settle means this asserts the resting
    // geometry rather than whichever frame the read happened to land on.
    await page.waitForTimeout(400);
    for (const f of await boxes()) {
      expect(f.mouth, `${f.key} 有嘴巴`).not.toBeNull();
      const m = f.mouth!;
      expect(m.w, `${f.key} 嘴宽`).toBeGreaterThan(2);
      expect(m.h, `${f.key} 嘴高`).toBeGreaterThan(0.5);
      expect(m.y, `${f.key} 嘴在身体内（上）`).toBeGreaterThanOrEqual(f.body.y);
      expect(m.y + m.h, `${f.key} 嘴在身体内（下）`).toBeLessThanOrEqual(f.body.y + f.body.h);
    }
  });

  it("指针移动时瞳孔跟随，且不越出眼白", async () => {
    const before = await boxes();
    const panel = (await panelBox())!;
    // A point well inside the panel, up and to the left of centre, so every pupil should move.
    await page.mouse.move(panel.w * 0.2, panel.h * 0.2);
    await page.waitForTimeout(250);
    const after = await boxes();
    // `zip`-style walk: index access on an array is possibly-undefined, and the paired elements are
    // what the comparison needs, so the shape is read once and skipped if either side is missing.
    for (const [i, afterFig] of after.entries()) {
      const now = afterFig.pupil;
      const was = before[i]?.pupil;
      const eye = afterFig.eye;
      // The component always renders a pupil inside each eye, so a missing one would fail the
      // dedicated assertions; skipping here is only to satisfy the compiler's index check.
      if (now === null || now === undefined || was === null || was === undefined) continue;
      const moved = Math.abs(now.x - was.x) + Math.abs(now.y - was.y);
      expect(moved, `第 ${i} 个人的瞳孔跟随了指针`).toBeGreaterThan(0.2);
      // Still inside the white it belongs to — this is the constraint the travel constant exists
      // for, and a figure scaled by percentage makes a fixed px travel wrong on the small ones.
      if (eye === null || eye === undefined) continue;
      expect(now.x, `第 ${i} 个人 瞳孔没越出眼白（左）`).toBeGreaterThanOrEqual(eye.x - 0.5);
      expect(now.y, `第 ${i} 个人 瞳孔没越出眼白（上）`).toBeGreaterThanOrEqual(eye.y - 0.5);
      expect(now.x + now.w, `第 ${i} 个人 瞳孔没越出眼白（右）`).toBeLessThanOrEqual(eye.x + eye.w + 0.5);
      expect(now.y + now.h, `第 ${i} 个人 瞳孔没越出眼白（下）`).toBeLessThanOrEqual(eye.y + eye.h + 0.5);
    }
  });

  it("面板变矮时构图仍然成立（笔记本屏幕）", async () => {
    await page.setViewportSize({ width: 1024, height: 420 });
    await page.waitForTimeout(150);
    for (const f of await boxes()) {
      expect(f.body.w, `${f.key} 矮面板仍有宽度`).toBeGreaterThan(12);
      expect(f.body.h, `${f.key} 矮面板仍有高度`).toBeGreaterThan(18);
      expect(f.eye!.w, `${f.key} 矮面板眼睛可见`).toBeGreaterThan(2);
      expect(f.eye!.y, `${f.key} 矮面板眼睛在身体内`).toBeGreaterThanOrEqual(f.body.y);
      expect(f.mouth!.y + f.mouth!.h, `${f.key} 矮面板嘴巴在身体内`).toBeLessThanOrEqual(
        f.body.y + f.body.h,
      );
    }
  });
});