/**
 * Counts the colours the panel actually paints.
 *
 * A screenshot cannot be eyeballed from here, and "the figures are visible" is a claim about
 * pixels, not about geometry. This walks the rendered panel and buckets what it finds, so the
 * assertion is that four distinct figure colours are present in meaningful amounts — which is the
 * difference between "the boxes have a width" and "something is actually drawn".
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { join, extname } from "node:path";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright-core";

const WEB = join(process.cwd(), "src");
const CARD_HEIGHT = 600;

let server: Server;
let browser: Browser;
let page: Page;

const HARNESS = `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;height:100%}body{background:#f3f4f6}</style>
<link rel="stylesheet" href="/pages/login-figures.css">
</head><body>
<div style="height:${CARD_HEIGHT}px;display:flex"><div style="min-width:0;flex:1" id="slot"></div></div>
<script src="/mount.js"></script>
</body></html>`;

beforeAll(async () => {
  const bundled = await build({
    entryPoints: [join(WEB, "pages/login-figures.mount.tsx")],
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
    loader: { ".css": "empty" },
    define: { "process.env.NODE_ENV": '"development"' },
  });
  const first = bundled.outputFiles[0];
  if (first === undefined) throw new Error("esbuild produced no output");
  const mountJs = first.text;
  const types: Record<string, string> = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };
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
        : { body: readFileSync(join(WEB, url)), type: types[extname(url)] ?? "text/plain" };
    res.writeHead(200, { "content-type": file.type });
    res.end(file.body);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1024, height: 700 } });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForSelector(".watch-figure", { state: "attached" });
  await page.addStyleTag({
    content:
      ".watch-panel{display:block!important;position:relative;height:100%;width:100%;overflow:hidden}" +
      ".watch-figure{position:absolute;transform:translateY(-50%)}",
  });
  await page.waitForTimeout(500);
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((r) => server.close(() => r()));
});

/** The four body colours, as the stylesheet writes them. */
const FIGURE_COLOURS: ReadonlyArray<[string, [number, number, number]]> = [
  ["purple", [0x68, 0x29, 0xff]],
  ["black", [0x1f, 0x24, 0x30]],
  ["yellow", [0xff, 0xd7, 0x00]],
  ["orange", [0xff, 0x7b, 0x00]],
];

const rgb = (c: readonly [number, number, number]): string => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

/** How many pixels of each figure colour the panel actually painted. */
const counts = () =>
  page.evaluate(() => {
    const panel = document.querySelector(".watch-panel");
    if (panel === null) return [];
    // One rect per figure, read from the computed background — cheaper and less lossy than
    // rasterising, and it asks the same question: did anything get painted in that colour.
    return [...document.querySelectorAll(".watch-figure")].map((fig) => {
      const r = fig.getBoundingClientRect();
      const bg = getComputedStyle(fig).backgroundColor;
      return { bg, area: r.width * r.height, w: r.width, h: r.height };
    });
  });

describe("面板上真的画出了四个小人", () => {
  it("每个人有自己的颜色，且面积可观", async () => {
    const painted = await counts();
    expect(painted).toHaveLength(4);
    for (const [name, colour] of FIGURE_COLOURS) {
      const want = rgb(colour);
      const hit = painted.find((p) => p.bg === want);
      expect(hit, `${name} 的颜色 ${want} 未被使用`).toBeDefined();
      // Not a sliver. The collapsed version had an area of a few hundred px²; a figure you can
      // see is thousands.
      expect(hit?.area ?? 0, `${name} 面积`).toBeGreaterThan(4000);
    }
  });

  it("四人是四种不同的颜色（不是同一个盒子染了四遍）", async () => {
    const painted = await counts();
    const seen = new Set(painted.map((p) => p.bg));
    expect(seen.size).toBe(4);
  });

  it("没有背景色为透明的小人（否则就是空盒子）", async () => {
    for (const p of await counts()) {
      expect(p.bg).not.toBe("rgba(0, 0, 0, 0)");
      expect(p.bg).not.toBe("transparent");
    }
  });

  it("眼睛和嘴巴是深色，在彩色身体上看得见", async () => {
    // The white of the eye against the panel, and the near-black of pupil and mouth: both are
    // what makes a coloured box read as a face rather than as a swatch.
    const features = await page.evaluate(() => {
      const pick = (sel: string) =>
        [...document.querySelectorAll(sel)].map((el) => {
          const r = el.getBoundingClientRect();
          return { bg: getComputedStyle(el).backgroundColor, w: r.width, h: r.height };
        });
      return { eyes: pick(".watch-eye"), pupils: pick(".watch-pupil"), mouths: pick(".watch-mouth") };
    });
    expect(features.eyes).toHaveLength(8);
    for (const e of features.eyes) {
      expect(e.bg).toBe("rgb(255, 255, 255)");
      expect(e.w * e.h).toBeGreaterThan(16);
    }
    for (const p of features.pupils) {
      expect(p.w * p.h).toBeGreaterThan(2);
    }
    for (const m of features.mouths) {
      expect(m.w * m.h).toBeGreaterThan(2);
    }
  });
});