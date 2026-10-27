/**
 * Renders the login watchers and writes a screenshot, so the thing can be looked at.
 *
 * The render test asserts the geometry; this one produces the image. Both exist because the page
 * was broken twice with a green suite, and the failure mode in both cases was something only a
 * picture or a measured box would have shown — a zero-height panel, and a `font-size` percentage
 * used as a scale basis that collapsed every figure to a line.
 */
import { afterAll, beforeAll, describe, it } from "vitest";
import { createServer, type Server } from "node:http";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, extname } from "node:path";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright-core";

const WEB = join(process.cwd(), "src");
const OUT = join(process.cwd(), "test-output");
const CARD_HEIGHT = 600;

let server: Server;
let browser: Browser;
let page: Page;

const HARNESS = `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;height:100%}body{background:#f3f4f6}</style>
<link rel="stylesheet" href="/pages/login-figures.css">
</head><body>
<div style="height:${CARD_HEIGHT}px;display:flex">
  <div style="min-width:0;flex:1" id="slot"></div>
  <div style="width:50%;background:#fff"></div>
</div>
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
        : { body: readFileSync(join(WEB, url)), type: types[extname(url)] ?? "text/plain" };
    res.writeHead(200, { "content-type": file.type });
    res.end(file.body);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;

  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForSelector(".watch-figure", { state: "attached" });
  // Stands in for the Tailwind classes the panel and figures carry; this harness has no Tailwind.
  await page.addStyleTag({
    content:
      ".watch-panel{display:block!important;position:relative;height:100%;width:100%;overflow:hidden}" +
      ".watch-figure{position:absolute;transform:translateY(-50%)}",
  });
  // Let the mouth's height transition settle so the shot shows the resting state.
  await page.waitForTimeout(500);
  mkdirSync(OUT, { recursive: true });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((r) => server.close(() => r()));
});

describe("登录页小人截图", () => {
  it("渲染静息状态", async () => {
    writeFileSync(join(OUT, "login-watchers.png"), await page.screenshot());
  });

  it("渲染深色模式", async () => {
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await page.waitForTimeout(400);
    writeFileSync(join(OUT, "login-watchers-dark.png"), await page.screenshot());
    await page.evaluate(() => document.documentElement.classList.remove("dark"));
  });

  it("渲染惊讶状态（空提交）", async () => {
    // The same component, startled — the state the page enters on a submit with both fields empty.
    await page.evaluate(() => {
      const figs = document.querySelectorAll(".watch-figure");
      figs.forEach((f) => {
        f.setAttribute("data-surprised", "");
        f.querySelector(".watch-mouth")?.setAttribute("data-surprised", "");
      });
    });
    await page.waitForTimeout(500);
    writeFileSync(join(OUT, "login-watchers-surprised.png"), await page.screenshot());
  });
});
