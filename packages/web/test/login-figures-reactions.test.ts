/**
 * What the figures actually do as the fields are used, in a real browser.
 *
 * The three behaviours — the purple one leans at the username, everyone looks away at the
 * password, and both undo on blur — are all driven by props and CSS attributes, and all of them
 * are easy to write in a way that looks correct and does nothing. Reading the source settles none
 * of it; only the rendered box settles it.
 *
 * The blur case is the one worth being careful about. Restoring on blur means *removing* an
 * attribute, and a `transition` on the property being restored will animate the removal — so a
 * naive fix reads as working and then leaves the figures stranded part-way through the animation.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";

const WEB = join(process.cwd(), "src");
const HARNESS = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/pages/login-figures.css">
<style>
  /* The panel is container-type: size, so both of its dimensions must resolve — every figure
     dimension is a cqh against its height. The card supplies a height here, standing in for
     login.tsx's card; the width comes from the flex parent. A panel that collapsed to zero
     height resolves cqh against nothing, and the offsets come out 0 — indistinguishable from
     "the rule did not apply" unless a rule is read off a panel that has a size. */
  html, body { margin: 0; height: 100%; }
  /* Tailwind is a build-time directive this static server cannot resolve, so the utility classes
     the component's markup carries — h-full, w-full, relative, hidden, lg:block, overflow-hidden,
     lg:w-1/2 — are written out here. Without them the panel computes to position:static and
     height:0, which container-type:size then resolves every cqh against: the [data-look-away]
     rule still matches and still wins, and the offset is 0px all the same. That is what the first
     version of this harness measured, and it is indistinguishable from "the rule did not apply".

     login-figures.test.ts asserts separately that the component's markup carries these classes, so
     this copy cannot drift from the page without that failing. */
  #slot { height: 600px; }
  .watch-panel { display: block; position: relative; height: 100%; width: 100%; overflow: hidden; }
</style>
</head><body>
<div id="slot"></div>
<script src="/mount.js"></script>
</body></html>`;

let server: Server;
let browser: Browser;
let page: Page;

/**
 * The stylesheet is served as-is.
 *
 * An *undeclared* `@layer components { … }` still applies — the layer is ordered last relative to
 * unlayered rules rather than being inert, so the figures style correctly here with no Tailwind
 * build present. Injecting `@layer components;` first also works and is harmless, and dropping the
 * wrapper entirely is what breaks: it unbalances the braces and the browser discards the sheet,
 * which presents as every rule silently doing nothing.
 */

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
  const out = bundled.outputFiles[0];
  if (out === undefined) throw new Error("esbuild produced no output");
  const mountJs = out.text;

  server = createServer((req, res) => {
    const url = (req.url ?? "/").split("?")[0] ?? "/";
    if (url === "/mount.js") {
      res.writeHead(200, { "content-type": "text/javascript" });
      res.end(mountJs);
      return;
    }
    if (url === "/" || url === "/index.html") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(HARNESS);
      return;
    }
    res.writeHead(200, { "content-type": "text/css" });
    res.end(readFileSync(join(WEB, url), "utf8"));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1024, height: 700 } });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForSelector(".watch-figure", { state: "attached", timeout: 10_000 });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

/**
 * The purple figure's lean, as its computed `transform`.
 *
 * Read `transform` rather than the individual `rotate` property: the lean is written as
 * `translate(10px, -50%) rotate(8deg)` in one `transform`, so an element at rest computes to
 * `none` and a leaning one to a matrix. Reading `rotate` — the first version of this file did —
 * returns `none` in both states, and the assertion passed on a figure that never moved.
 */
const purpleTilt = () =>
  page.evaluate(() => {
    const el = document.querySelector(".watch-figure.purple");
    return el === null ? null : getComputedStyle(el).transform;
  });

/**
 * The translate offset of an element, in px.
 *
 * Read from the computed style rather than from the class list, and parsed leniently: an element
 * the stylesheet has not offset at all computes to `none`, which is not a length and has no sign.
 * That is the state the "restored" assertion has to accept alongside `0px` — both mean "not
 * displaced", and demanding exactly `0` would fail on the `none` spelling for no reason while
 * still catching a transition left stranded at some fraction of a pixel.
 */
const offsetX = (translate: string): number => {
  const first = translate.split(" ")[0] ?? "";
  return first === "none" || first === "" ? 0 : Number.parseFloat(first);
};

/**
 * Each figure's eye assembly: the computed offset, and whether the look-away attribute is set.
 *
 * `data-look-away` sits on `.watch-eyes` — the wrapper around both eyes of one figure — because
 * the whole eye white slides left rather than the pupil sliding inside a fixed white, which reads
 * as a gaze turning rather than as eyes going crooked.
 */
const eyeShift = () =>
  page.evaluate(() =>
    [...document.querySelectorAll(".watch-eyes")].map((el) => ({
      translate: getComputedStyle(el).translate,
      lookAway: el.hasAttribute("data-look-away"),
    })),
  );

describe("小人的三种反应与还原", () => {
  it("输入账号 → 只有小紫倾斜", async () => {
    const before = await purpleTilt();
    await page.evaluate(() => window.__watchers({ usernameTyped: true }));
    await page.waitForTimeout(400);
    const after = await purpleTilt();
    expect(before, "初始应无倾斜").not.toBe(after);
    await page.evaluate(() => window.__watchers({}));
  });

  it("输入密码 → 四组眼睛左移并带上 data-look-away", async () => {
    await page.evaluate(() => window.__watchers({ passwordTyped: true }));
    await page.waitForTimeout(400);
    const eyes = await eyeShift();
    expect(eyes).toHaveLength(4);
    for (const [i, e] of eyes.entries()) {
      expect(e.lookAway, `第 ${i} 组眼缺 data-look-away`).toBe(true);
      // 负值 = 向左。CSS 写的是 -0.55cqh，600px 高的面板约合 3.3px。
      expect(offsetX(e.translate), `第 ${i} 组眼未左移（${e.translate}）`).toBeLessThan(-1);
    }
  });

  it("失焦 → 眼睛完全还原，且属性真的被移除", async () => {
    await page.evaluate(() => window.__watchers({}));
    await page.waitForTimeout(500);
    const eyes = await eyeShift();
    for (const [i, e] of eyes.entries()) {
      expect(e.lookAway, `第 ${i} 组眼的 data-look-away 未移除`).toBe(false);
      // 恰好 0，不是「接近 0」：transition 若被卡住，残留正是零点几像素 —— 这正是「不能动」的形态。
      expect(offsetX(e.translate), `第 ${i} 组眼未完全还原（${e.translate}）`).toBe(0);
    }
  });

  it("还原后指针跟随仍然工作", async () => {
    // 「不能动」的另一种表现：还原之后眼睛再也不跟指针了。写一个已知的指针位置，检查位移。
    const before = await page.evaluate(() => {
      const p = document.querySelector(".watch-pupil") as HTMLElement | null;
      return p === null ? 0 : p.getBoundingClientRect().x;
    });
    await page.evaluate(() => {
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 200, clientY: 200 }));
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 400, clientY: 350 }));
    });
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => {
      const p = document.querySelector(".watch-pupil") as HTMLElement | null;
      return p === null ? 0 : p.getBoundingClientRect().x;
    });
    expect(Math.abs(after - before), "指针移动后瞳孔未位移").toBeGreaterThan(0.2);
  });
});

describe("反应跟随焦点，而不是跟随输入框里的内容", () => {
  /**
   * Read straight from the page source.
   *
   * These two are a rule about *when* a flag may be true, and it lives in login.tsx rather than in
   * the component: the component cannot know whether the cursor is still in the field. Asserting it
   * on the source is the only way to state it without mounting the whole page, which needs the
   * auth context, the router and a live server.
   */
  const PAGE = readFileSync(join(WEB, "pages/login.tsx"), "utf8");

  it("两个反应都由焦点把关，内容只是附加条件", () => {
    // 光标离开密码框 → 立即还原，哪怕密码还在框里。这是「输入密码后全体不能动」的修复点。
    expect(PAGE, "密码反应未要求焦点").toMatch(/passwordHasText\s*&&\s*passwordFocused/);
    expect(PAGE, "账号反应未要求焦点").toMatch(/usernameTyped\s*&&\s*usernameFocused/);
    // 只看内容、不看焦点的旧写法不能回来。
    expect(PAGE).not.toMatch(/const\s+passwordTyped\s*=/);
    expect(PAGE).not.toMatch(/const\s+usernameTyped\s*=\s*userId\.trim\(\)\s*&&\s*!?\w*Focused/);
  });

  it("两个输入框都接了焦点事件", () => {
    // 没有 onBlur 就没有还原 —— 状态永远回不到 false，焦点逻辑等于没写。
    const blur = PAGE.match(/onBlur=\{\(\)\s*=>\s*set\w+Focused\(false\)\}/g) ?? [];
    const focus = PAGE.match(/onFocus=\{\(\)\s*=>\s*set\w+Focused\(true\)\}/g) ?? [];
    expect(blur, "缺少 onBlur").toHaveLength(2);
    expect(focus, "缺少 onFocus").toHaveLength(2);
  });

  it("空密码框获得焦点不触发左看", () => {
    // 没有密码可遮掩的时候没什么要避讳的：一个空框让四双眼睛一起扭头，看着像坏了。
    expect(PAGE).toMatch(/passwordHasText\s*&&\s*passwordFocused/);
  });
});