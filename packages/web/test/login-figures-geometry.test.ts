/**
 * Checks the login watchers' rendered geometry against what the CSS says it should be.
 *
 * The first version of this page shipped broken twice, and both times a test suite was green:
 * once because the panel had no height, once because `font-size: <percentage>` was used as a
 * scale basis and resolved against the inherited font size rather than any height. Neither showed
 * up as an assertion failure, because every assertion was about the source text containing
 * certain strings — and the source did contain them.
 *
 * So this parses the built CSS, resolves the units by hand against a known panel size, and
 * asserts that a figure actually comes out with a visible body, visible eyes, and eyes that fit
 * inside its body. That is the class of check that would have caught both.
 *
 * Not a substitute for looking at it, but it is the check that a unit mistake cannot survive.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** The card's height in login.tsx (lg:h-[600px]). */
const PANEL_HEIGHT = 600;
/** The window height the window-minimum size implies, for the short-panel case. */
const SHORT_PANEL_HEIGHT = 380;

const cssPath = join(process.cwd(), "src/pages/login-figures.css");
const css = readFileSync(cssPath, "utf8");
const FIGURES = readFileSync(join(process.cwd(), "src/pages/login-figures.tsx"), "utf8");

/** The height percentage the component passes for a figure, read off its spec table. */
function heightPct(key: string): number {
  const m = new RegExp(`key: "${key}", height: "([\\d.]+)%"`).exec(FIGURES);
  if (m?.[1] === undefined) throw new Error(`no height for ${key}`);
  return Number(m[1]);
}

/**
 * The declaration block of `selector`, ignoring anything inside `@keyframes`.
 *
 * Anchored on a class boundary rather than a substring: `.watch-eye` also occurs inside
 * `.watch-eyes`, so a plain indexOf matched the comment or the wrong rule and the numbers came
 * from the wrong place. The `(?<![\w-])` keeps it from matching a longer class of the same name.
 *
 * The keyframes are excluded because `watch-blink` animates `.watch-eye`'s own `height`, so an
 * unfiltered search can land inside them and report a number from the animation rather than from
 * the rule it was asked about.
 */
function ruleOutsideKeyframes(selector: string): string | null {
  const cut = css.indexOf("@keyframes");
  const scoped = cut === -1 ? css : css.slice(0, cut);
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`(?<![\\w-])${escaped}\\s*\\{([^}]*)\\}`).exec(scoped);
  return m?.[1] ?? null;
}

/** One declaration's numeric value, e.g. `("width", ".watch-eye")` → 14. */
function value(prop: string, selector: string): number {
  const block = ruleOutsideKeyframes(selector);
  if (block === null) throw new Error(`no rule for ${selector}`);
  const m = new RegExp(`${prop}:\\s*([\\d.]+)(cqh|px|em)`).exec(block);
  if (m === null) throw new Error(`no ${prop} in ${selector}`);
  const n = Number(m[1]);
  // Everything is expected to be in cqh; the others are here so a regression to px is a value,
  // not a crash — and the assertions below then fail on the size.
  if (m[2] === "cqh") return (n * PANEL_HEIGHT) / 100;
  if (m[2] === "em") return n * 16;
  return n;
}

/** Resolves against an arbitrary panel height, for the "does it still work when short" case. */
function at(px: number, panel: number): number {
  return (px / PANEL_HEIGHT) * panel;
}

const FIGURE_HEIGHTS = { purple: 44, black: 32, yellow: 21, orange: 14 } as const;

/**
 * The design's original pixel dimensions, on a 600px panel.
 *
 * This is the table every `cqh` value has to reproduce. It exists because the conversion was done
 * twice and was wrong once: the purple width came out as `47cqh`, which is its *aspect ratio*
 * (125/265) rather than its *share of the panel* (125/600 ≈ 20.8cqh). Every figure rendered twice
 * as wide as intended, with eyes a third of the body across — and every geometry assertion still
 * passed, because each one only checked bounds ("the eyes are inside the body"), never the size.
 *
 * A bound cannot tell a correct figure from a bloated one. Pinning the numbers themselves can.
 */
const DESIGN_PX = {
  widths: { purple: 125, black: 80, yellow: 73, orange: 150 } as const,
  heights: { purple: 265, black: 190, yellow: 125, orange: 84 } as const,
  eye: 14, // not the original 10: the travel budget needs it, see the note in .watch-eye
  eyesTop: 20,
  eyesGap: 22,
  mouthTop: 50,
  mouthW: 12,
  mouthH: 4,
  mouthOpen: 9,
  borderRadius: 8,
} as const;

describe("小人渲染后的实际尺寸", () => {
  it("cqh 数值换算回原始设计的像素", () => {
    // 换算错误是两次修复里唯一没被任何断言抓到的问题：范围检查（"眼睛在身体内"）对胖一圈
    // 的小人照样成立。必须把数值本身钉死。
    for (const [key, design] of Object.entries(DESIGN_PX.widths)) {
      expect(value("width", `.watch-figure.${key}`), `${key} 宽`).toBeCloseTo(design, 0);
    }
    expect(value("width", ".watch-eye")).toBeCloseTo(DESIGN_PX.eye, 1);
    expect(value("height", ".watch-eye")).toBeCloseTo(DESIGN_PX.eye, 1);
    expect(value("top", ".watch-eyes")).toBeCloseTo(DESIGN_PX.eyesTop, 0);
    expect(value("gap", ".watch-eyes")).toBeCloseTo(DESIGN_PX.eyesGap, 0);
    expect(value("width", ".watch-mouth")).toBeCloseTo(DESIGN_PX.mouthW, 0);
    expect(value("height", ".watch-mouth")).toBeCloseTo(DESIGN_PX.mouthH, 1);
  });

  it("身高与原始设计一致（百分比）", () => {
    // 这几个是 TS 里的百分比，同样对：265/600 = 44.17%，而不是 44% 之外的任何东西。
    for (const [key, design] of Object.entries(DESIGN_PX.heights)) {
      const pct = (heightPct(key) / 100) * PANEL_HEIGHT;
      expect(pct, `${key} 高`).toBeCloseTo(design, -1); // 百分比取整，容 10px
    }
  });

  it("眼睛是身体的合理比例，不是三分之一", () => {
    // 换算错成 47cqh 时眼宽 33.6px 对上 125px 的身体 —— 27%。当前 14/125 = 11.2%，
    // 最窄的黑色小人 14/80 = 17.5%，所以上界取 20%：能挡住"胖了一圈"，又不误伤天生窄的那个。
    const eye = value("width", ".watch-eye");
    for (const [key, design] of Object.entries(DESIGN_PX.widths)) {
      expect(eye / design, `${key} 眼睛占身宽`).toBeLessThan(0.2);
    }
  });

  it("面板是尺寸容器，否则 cqh 无参照", () => {
    // container-type: size 而非 inline-size —— cqh 需要容器的高度是已定义的。
    expect(css).toContain("container-type: size");
    expect(css).not.toContain("container-type: inline-size");
  });

  it("每个小人的身体在 600px 面板下是可见的尺寸", () => {
    for (const [key, heightPct] of Object.entries(FIGURE_HEIGHTS)) {
      const width = value("width", `.watch-figure.${key}`);
      const height = (heightPct / 100) * PANEL_HEIGHT;
      // 之前的 em 版本：宽度约 7px、高度 264px —— 一根线。现在两者都必须是几十像素量级。
      expect(width, `${key} 宽`).toBeGreaterThan(20);
      expect(width, `${key} 高`).toBeGreaterThan(40);
      // 身体不能是一根线：宽高比失衡到看不出是个形体。
      expect(width / height, `${key} 宽高比`).toBeGreaterThan(0.15);
    }
  });

  it("眼睛在身体里、且不是隐形的", () => {
    const eye = value("width", ".watch-eye");
    expect(eye).toBeGreaterThan(6);
    for (const [key, heightPct] of Object.entries(FIGURE_HEIGHTS)) {
      const bodyHeight = (heightPct / 100) * PANEL_HEIGHT;
      const bodyWidth = value("width", `.watch-figure.${key}`);
      // 眼睛偏移必须落在身体内。之前 em 版本里 top: 0.16em ≈ 1px，缩到矮面板上会掉到身体外。
      const eyesTop = value("top", ".watch-eyes");
      expect(eyesTop, `${key} 眼睛位置`).toBeLessThan(bodyHeight);
      // 两眼加上间距必须放得进身体宽度，否则会从两侧溢出。
      const gap = value("gap", ".watch-eyes");
      expect(eye * 2 + gap, `${key} 两眼+间距`).toBeLessThan(bodyWidth);
      // 嘴同理。
      const mouthTop = value("top", ".watch-mouth");
      expect(mouthTop, `${key} 嘴巴位置`).toBeLessThan(bodyHeight);
      const mouthW = value("width", ".watch-mouth");
      expect(mouthW, `${key} 嘴巴宽度`).toBeLessThan(bodyWidth);
    }
  });

  it("瞳孔小于眼白，否则黑瞳盖满眼睛看不出是眼睛", () => {
    const eye = value("width", ".watch-eye");
    const scale = Number(/transform: scale\(([\d.]+)\)/.exec(ruleOutsideKeyframes(".watch-pupil") ?? "")?.[1]);
    expect(scale).toBeGreaterThan(0);
    expect(scale).toBeLessThan(1);
    // 瞳孔填满眼白后缩到 scale —— 可见的黑就是 scale 那一块，必须明显小于眼白。
    expect(scale).toBeLessThanOrEqual(0.7);
    expect(eye * scale).toBeLessThan(eye);
  });

  it("小紫朝输入框方向（右侧）倾，不是相反方向", () => {
    // 表单在卡片右半边、小人在左半边。倾过去凑近看用户名框就该向右倾。原来是
    // translate(-10px) rotate(-8deg)，往左——那是背离它要读的东西，读起来像躲开页面。
    expect(css).toMatch(
      /\.watch-figure\[data-leaning\] \{[^}]*translate\(10px, -50%\) rotate\(8deg\)/s,
    );
  });

  it("瞳孔够大、行程够长，看得出在跟随", () => {
    // 眼白 14px、瞳孔 scale(0.45) → 可见直径 6.3px，行程 0.55 × 6.3 ≈ 3.5px（眼白的 25%）。
    // 原来是眼白 10px、scale(0.5)、行程 0.3 → 可见 5px、行程 1.5px（眼白的 15%）——
    // 每次移动不到 0.3px，看不出在动。
    //
    // 注意：行程占眼白的比例**只由 scale 决定**，与眼白大小无关（都是 (1-scale)/2）。
    // 所以想加大行程只能减小 scale，而想同时让瞳孔看得见就得放大眼白——两者一起才行。
    const scale = Number(/transform: scale\(([\d.]+)\)/.exec(ruleOutsideKeyframes(".watch-pupil") ?? "")?.[1]);
    expect(scale, "瞳孔要够大").toBeGreaterThanOrEqual(0.4);
    expect(scale, "但不能太大，否则没行程").toBeLessThanOrEqual(0.5);
    const eye = value("width", ".watch-eye");
    const travel = Number(/const PUPIL_TRAVEL = ([\d.]+)/.exec(FIGURES)?.[1]);
    const reach = eye * scale * travel;
    // 行程至少要达到眼白的五分之一，否则看不出在跟随。
    expect(reach / eye, "行程要够长").toBeGreaterThan(0.2);
    // 不能超出眼白：可见瞳孔从中心移到边缘最多走 (1 - scale) / 2 × 眼白。
    // 还要留出余量——实际渲染时尺寸带亚像素，恰好贴边会因舍入溢出（渲染测试抓到过 1.5px 的越界）。
    const maxSafe = ((1 - scale) / 2) * eye;
    expect(reach, "行程不能超出眼白").toBeLessThanOrEqual(maxSafe);
    expect(maxSafe - reach, "行程需留亚像素余量").toBeGreaterThan(0.4);
  });

  it("输入密码 → 整只眼睛往左看，不只是瞳孔", () => {
    // 只移瞳孔读起来是眼睛歪了；眼白带着瞳孔一起左移才是"视线转开"。
    expect(FIGURES).toContain(
      '<div className="watch-eyes" data-look-away={passwordTyped || undefined}>',
    );
    expect(css).toMatch(/\.watch-eyes\[data-look-away\] \{[^}]*translate: -[\d.]+cqh/s);
    // 幅度要够明显（约眼白的五分之一以上），3px 的瞳孔位移是不够看的。
    const awayBlock = css.split(".watch-eyes[data-look-away]")[1] ?? "";
    const away = Number(/translate: -([\d.]+)cqh/.exec(awayBlock)?.[1]);
    expect(away * (PANEL_HEIGHT / 100) / value("width", ".watch-eye")).toBeGreaterThan(0.2);
  });

  it("矮面板下仍然成立（笔记本 768px 高的屏幕）", () => {
    // 比例单位的意义就在这里：面板矮下来，所有尺寸跟着缩，但布局关系不变。
    const eye = at(value("width", ".watch-eye"), SHORT_PANEL_HEIGHT);
    expect(eye).toBeGreaterThan(3);
    for (const [key, heightPct] of Object.entries(FIGURE_HEIGHTS)) {
      const bodyHeight = at((heightPct / 100) * PANEL_HEIGHT, SHORT_PANEL_HEIGHT);
      const bodyWidth = at(value("width", `.watch-figure.${key}`), SHORT_PANEL_HEIGHT);
      expect(bodyWidth, `${key} 矮面板宽`).toBeGreaterThan(12);
      expect(at(value("top", ".watch-eyes"), SHORT_PANEL_HEIGHT)).toBeLessThan(bodyHeight);
      expect(eye * 2 + at(value("gap", ".watch-eyes"), SHORT_PANEL_HEIGHT)).toBeLessThan(bodyWidth);
    }
  });

  it("眨眼的闭合帧是一条细缝，不是把眼睛关掉", () => {
    // 之前是 1px 固定值：小人身上几乎看不出变化，大个子身上把眼睛压扁。这里按比例。
    const at = css.indexOf("@keyframes watch-blink");
    const block = css.slice(at, css.indexOf("}", css.indexOf("}", at) + 1));
    // Raw cqh here, converted the same way `value` does — comparing the keyframes' unconverted
    // number against a converted one is how this read 5.6 against 33.6.
    const heights = [...block.matchAll(/height:\s*([\d.]+)cqh/g)].map(
      (m) => (Number(m[1]) * PANEL_HEIGHT) / 100,
    );
    expect(heights.length).toBeGreaterThanOrEqual(2);
    const open = Math.max(...heights);
    const shut = Math.min(...heights);
    expect(shut).toBeGreaterThan(0);
    expect(shut).toBeLessThan(open);
    // 闭合后仍应保留一丝高度，否则是"消失"而不是"眨眼"。
    expect(shut / open).toBeGreaterThan(0.03);
    expect(shut / open).toBeLessThan(0.4);
    // 张开的那一帧必须与眼白本身一致，否则眨眼结束的瞬间眼睛会跳一下尺寸。
    expect(open).toBeCloseTo(value("width", ".watch-eye"), 5);
  });
});