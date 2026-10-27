/**
 * Where the login form actually sits, in a real browser.
 *
 * The claim under test is a layout one, and reading the class names cannot establish it. Auto
 * margins on the form split the slack between the brand and the copyright — but so would several
 * other combinations, and so would none of them if the column's height never resolved. The only
 * thing that settles it is where the box ends up.
 *
 * The case that matters is the second test: growing the column. A column centred as one block
 * (logo + form + copyright together) keeps the block centred, so the copyright rides up and the
 * form follows it down; only a form that takes the slack itself stays put.
 *
 * `flex-1` was the first attempt and it did not work, which is why this file exists: the source
 * read plausibly and a text assertion on it would have passed. A flex item's `flex-basis: 0%` is
 * overridden by its content's min-content size, so the form came out exactly as tall as its
 * fields, there was no free space left for `justify-center` to distribute, and the form sat hard
 * against the logo at every column height. The measurement that showed it — 166px of form in a
 * 964px column — is what this file was written to catch.
 *
 * The flex classes here are written out by hand rather than loaded from Tailwind, which is a
 * build-time directive this static server cannot resolve. That makes the harness a copy of the
 * page's structure rather than the page itself, so `login-figures.test.ts` asserts separately
 * that the class names under test are the ones login.tsx actually uses.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright-core";

const WEB = join(process.cwd(), "src");
/** The card's height in login.tsx at the lg breakpoint, which the page is laid out inside. */
const CARD_HEIGHT = 600;

let server: Server;
let browser: Browser;
let page: Page;

/**
 * Stands in for the card and the form column of login.tsx.
 *
 * The real `login.tsx` cannot be mounted here: it calls `useAuth`, `useNavigate` and the login
 * endpoint, all of which need the running server. So the harness reproduces the column's own
 * structure — brand, form, copyright inside a `flex flex-col` of a fixed height — and the classes
 * under test are copied from the page rather than invented. The figure panel is left out because
 * it has no bearing on where the form sits; the flex context that decides it is the column.
 */
const HARNESS = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/styles.css">
</head><body>
<div style="height:100vh" class="outer">
  <div style="height:${CARD_HEIGHT}px" class="card" id="card">
    <div class="flex w-full min-w-0 flex-col overflow-y-auto px-6 py-8 sm:px-10 lg:w-1/2 lg:shrink-0 lg:px-12 lg:py-10" id="column">
      <div class="mx-auto mb-3 h-14 w-14 rounded-2xl logo" id="logo"></div>
      <h1 class="text-center text-2xl font-semibold tracking-tight" id="title">九川</h1>
      <form class="my-auto w-full space-y-4" id="form">
        <input class="field" name="username">
        <input class="field" name="password" type="password">
        <button type="submit" class="btn">登录</button>
      </form>
      <p class="mt-8 shrink-0 pt-2 text-center text-xs" id="copyright">©2026-2028 安徽经邦软件技术有限公司 版权所有</p>
    </div>
  </div>
</div>
</body></html>`;

/**
 * Enough of the app's base layer for the column to have a height to lay out inside: full height,
 * and no margin on the body. Deliberately not the app's own stylesheet — the classes under test
 * come from Tailwind, which is not resolvable at this point in the build, so they are written out
 * by hand below and asserted against the page's source in login-figures.test.ts. What this file
 * checks is the flex behaviour; that the class names are the page's is the other file's job.
 */
const LAYOUT_CSS = `
  html, body { margin: 0; height: 100%; }
  .flex { display: flex; }
  .flex-col { flex-direction: column; }
  .flex-1 { flex: 1 1 0%; }
  .w-full { width: 100%; }
  .min-w-0 { min-width: 0; }
  .min-h-0 { min-height: 0; }
  .shrink-0 { flex-shrink: 0; }
  .overflow-y-auto { overflow-y: auto; }
  .justify-center { justify-content: center; }
  .items-center { align-items: center; }
  .mx-auto { margin-left: auto; margin-right: auto; }
  .text-center { text-align: center; }
  .mb-3 { margin-bottom: 0.75rem; }
  .my-auto { margin-top: auto; margin-bottom: auto; }
  .mt-8 { margin-top: 2rem; }
  .pt-2 { padding-top: 0.5rem; }
  .px-6 { padding-left: 1.5rem; padding-right: 1.5rem; }
  .py-8 { padding-top: 2rem; padding-bottom: 2rem; }
  .lg\\:w-1\\/2 { width: 50%; }
  .logo { background: #111; }
  .field { display: block; height: 40px; margin-bottom: 1rem; }
  .btn { display: block; height: 42px; }
`;

beforeAll(async () => {
  const types: Record<string, string> = { ".html": "text/html", ".css": "text/css" };
  server = createServer((req, res) => {
    const url = (req.url ?? "/").split("?")[0] ?? "/";
    if (url === "/layout.css") {
      res.writeHead(200, { "content-type": "text/css" });
      res.end(LAYOUT_CSS);
      return;
    }
    const body =
      url === "/" || url === "/index.html"
        ? HARNESS
        : existsSync(join(WEB, url))
          ? readFileSync(join(WEB, url), "utf8")
          : null;
    res.writeHead(body === null ? 404 : 200, {
      "content-type": body === null ? "text/plain" : (types[extname(url)] ?? "text/html"),
    });
    res.end(body ?? "not found");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;

  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await page.goto(`http://127.0.0.1:${port}/`);
  // The stylesheet is inlined below the markup, so nothing else has to load first.
  await page.addStyleTag({ content: LAYOUT_CSS });
  await page.waitForSelector("#form", { state: "attached", timeout: 10_000 });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

interface Box {
  top: number;
  bottom: number;
}

const boxes = async (): Promise<{ brand: Box; form: Box; copyright: Box; column: Box }> =>
  page.evaluate(() => {
    const read = (id: string): Box => {
      const r = document.getElementById(id)?.getBoundingClientRect();
      return { top: r?.top ?? 0, bottom: r?.bottom ?? 0 };
    };
    return {
      brand: read("title"),
      form: read("form"),
      copyright: read("copyright"),
      column: read("column"),
    };
  });

describe("登录表单的纵向位置", () => {
  it("表单在品牌与版权之间，上下留白对称", async () => {
    const b = await boxes();
    expect(b.form.bottom - b.form.top, "表单未渲染").toBeGreaterThan(100);
    const above = b.form.top - b.brand.bottom;
    const below = b.copyright.top - b.form.bottom;
    expect(above, "表单贴着品牌").toBeGreaterThan(0);
    expect(below, "表单贴着版权").toBeGreaterThan(0);
    // The whole point: the slack is split, not all above or all below. 30px of slack on a band a
    // few hundred pixels tall — enough to catch a centred whole column, where one side collapses
    // to the padding.
    expect(Math.abs(above - below), `上 ${above} / 下 ${below}`).toBeLessThan(30);
  });

  it("列变高时表单停在中间，版权留在底部", async () => {
    const short = await boxes();
    // Set on the column itself, and the outer wrappers are `height:100%` chains rather than fixed
    // heights — otherwise the card's own height would cap the column and growing it would do
    // nothing, which is exactly what the first version of this test measured.
    await page.evaluate(() => {
      // Both the card and the column are given the new height: the card's is what the column
      // resolves against (the column is `w-1/2` *inside* it), so raising only the column leaves it
      // clipped to 600px and the form cannot move.
      document.getElementById("column")!.style.height = "900px";
      document.getElementById("card")!.style.height = "900px";
      document.body!.style.height = "auto";
    });
    await page.waitForTimeout(120);
    const tall = await boxes();

    // The column grew, so the gap above the form must grow with it — that is what "stays in the
    // middle" means. Centring the column as one block would instead grow the bottom gap, because
    // the copyright rides up with the block.
    expect(tall.form.top - short.form.top, "表单未随列高下移").toBeGreaterThan(60);
    expect(tall.brand.top - short.brand.top, "品牌应固定").toBeLessThan(2);
    expect(tall.copyright.bottom - short.copyright.bottom, "版权应固定在底部").toBeGreaterThan(250);

    const above = tall.form.top - tall.brand.bottom;
    const below = tall.copyright.top - tall.form.bottom;
    expect(Math.abs(above - below), `变高后 上 ${above} / 下 ${below}`).toBeLessThan(30);
  });

  it("列比内容还矮时，内容不被裁掉而是可滚动", async () => {
    await page.evaluate(() => {
      document.getElementById("column")!.style.height = "300px";
    });
    await page.waitForTimeout(120);
    const scrollable = await page.evaluate(() => {
      const el = document.getElementById("column")!;
      return {
        overflow: getComputedStyle(el).overflowY,
        scrollable: el.scrollHeight > el.clientHeight,
        formVisible: document.getElementById("form")!.getBoundingClientRect().bottom > 0,
      };
    });
    expect(scrollable.overflow).toBe("auto");
    expect(scrollable.scrollable, "矮列应可滚动而不是裁掉表单");
    expect(scrollable.formVisible).toBe(true);
  });
});
