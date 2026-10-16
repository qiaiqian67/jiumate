/**
 * The login page's watchers panel: four CSS figures, and the three reactions they make.
 *
 * The figures are drawn with plain CSS boxes and the reactions are driven by attributes on those
 * boxes, so what is worth pinning here is *which attribute each input sets* — that mapping is
 * the whole design, and it is easy to get subtly wrong in a way no type checker notices. For
 * instance: leaning toward the username only while the password is empty is what stops the
 * purple one from reading over the user's shoulder while they type a password.
 *
 * The component itself cannot be rendered here (this package's vitest runs in node, no DOM), so
 * these read the source — the same approach as `account-menu.test.ts`. What is asserted is the
 * wiring, not the pixels: the geometry numbers are checked for the range that keeps a pupil
 * inside its eye, because that is the one place a plausible-looking value is actually wrong.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = (p: string) =>
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), p), "utf8");

const FIGURES = src("../src/pages/login-figures.tsx");
const CSS = src("../src/pages/login-figures.css");
const PAGE = src("../src/pages/login.tsx");

describe("小人的形体", () => {
  it("四个，颜色各不相同", () => {
    for (const key of ["purple", "black", "yellow", "orange"]) {
      expect(FIGURES, key).toContain(`key: "${key}"`);
      expect(CSS, key).toContain(`.watch-figure.${key}`);
    }
    // 黑小人在深色下要单独提亮，否则它会消失在深色面板上只剩两只眼睛。
    expect(CSS).toContain(".dark .watch-figure.black");
  });

  it("眨眼周期各不相同（周期相同会像一个人在眨而不是四个人）", () => {
    const periods = [...FIGURES.matchAll(/blink: ([\d.]+)/g)].map((m) => m[1]);
    expect(periods).toHaveLength(4);
    expect(new Set(periods).size).toBe(4);
    // 周期通过自定义属性交给 CSS，keyframes 只在样式表里定义一次。
    expect(FIGURES).toContain('"--watch-blink"');
    expect(CSS).toContain("var(--watch-blink");
  });

  it("瞳孔移动范围不超过眼睛能容纳的距离", () => {
    // 白色眼球和黑色瞳孔同样大小，瞳孔靠缩到一半露出来，所以它最多只能在眼球里挪动
    // （眼白半径 - 瞳孔半径）≈3px。参考实现里的 translate(-8px) 会把瞳孔推出眼白。
    const travel = Number(/const PUPIL_TRAVEL = (\d+)/.exec(FIGURES)?.[1]);
    expect(travel).toBeGreaterThan(0);
    expect(travel).toBeLessThanOrEqual(4);
    // 左看时用的偏移同样必须在这个范围内。
    const away = /translate\((-?\d+)px, 0\) scale/.exec(CSS)?.[1];
    expect(Math.abs(Number(away))).toBeLessThanOrEqual(travel);
  });

  it("嘴巴张开时是圆的不是更高的方块", () => {
    // 只加高不圆化会读成"一条更粗的线"，不是张开的嘴。
    expect(CSS).toMatch(/\.watch-mouth\[data-surprised\] \{[^}]*height: 9px;[^}]*border-radius: 50%/s);
  });
});

describe("三种反应", () => {
  it("输入账号 → 只有小紫倾斜", () => {
    expect(FIGURES).toContain('spec.key === "purple" && usernameTyped && !passwordTyped');
    // 且输入密码时不再倾斜 —— 它不该在用户打密码时凑过去看。
    expect(FIGURES).toContain("!passwordTyped");
  });

  it("输入密码 → 全体把眼睛移开", () => {
    expect(FIGURES).toContain("data-look-away={passwordTyped || undefined}");
    expect(CSS).toContain(".watch-pupil[data-look-away]");
  });

  it("输入密码时指针不再驱动眼睛，并立即回到中间", () => {
    // 指针可能在用户读自己刚输入的密码时停在面板上——这时候眼睛跟着走，正好是最不该发生的。
    expect(FIGURES).toContain("if (passwordTyped)");
    expect(FIGURES).toContain('pupil.style.transform = "translate(0px, 0px)"');
  });

  it("空提交 → 全体张嘴并站直", () => {
    expect(PAGE).toContain("setStartled(userId.trim() === \"\" && password.trim() === \"\")");
    expect(FIGURES).toContain("data-surprised={surprised || undefined}");
    // 惊讶时必须站直（只留 translateY），否则读成"摔倒"而不是"吃惊"。
    expect(CSS).toMatch(/\.watch-figure\[data-surprised\] \{[^}]*transform: translateY\(-50%\);/s);
  });

  it("开始输入就停止惊讶", () => {
    // 否则用户已经在改正了，四个人还张着嘴盯着。
    expect(PAGE).toContain("setStartled(false)");
  });
});

describe("页面", () => {
  it("保留原有的登录流程与文案，没有引入注册或找回密码", () => {
    // 参考设计有「记住密码」和「忘记密码?」。本项目没有自助注册（账号由管理员创建），
    // 也没有找回密码功能——放一个点不动的链接比不放更糟。
    expect(PAGE).toContain("await login(userId.trim(), password)");
    expect(PAGE).toContain("S.auth.defaultAdminNote");
    expect(PAGE).toContain("S.auth.forgotAdminNote");
    // 断言的是没有对应的**控件**，而不是源码里没有这些词——本页的注释本来就解释了
    // 为什么不做它们（"remember me" / "forgot password?" 出现在那段说明里）。
    expect(PAGE).not.toMatch(/<(input|button|a)[^>]*type="checkbox"/);
    expect(PAGE).not.toMatch(/rememberMe|forgotPassword|onForgot/);
  });

  it("电路背景已移除，相关的 CSS 也一起删干净", () => {
    expect(PAGE).not.toContain("LoginCircuit");
    const styles = src("../src/styles.css");
    // 同样只看规则不看注释：文件头那段历史说明里就写着电路背景的去向。
    expect(styles).not.toMatch(/^\.login-trace|^\.login-via|^@keyframes login-/m);
    // 通用 reduced-motion 规则必须还在（login-figures.css 之外的东西还靠它）。
    expect(styles).toContain("prefers-reduced-motion");
  });

  it("面板在 lg 以下隐藏，表单占满宽度", () => {
    // 断点是 Tailwind 的 lg: 变体，直接写在组件的 className 上，不是自定义 CSS。
    expect(FIGURES).toContain("hidden w-full overflow-hidden bg-gray-100 lg:block");
  });

  it("面板是装饰性的，不进无障碍树", () => {
    // 读屏念出"四个 watchers"只会是噪音；表单才是内容。
    expect(FIGURES).toContain("aria-hidden");
  });

  it("尊重系统的减少动态偏好", () => {
    expect(CSS).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    // 眨眼和倾斜都要停：面板不能自己在动。
    expect(CSS).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[^}]*animation: none/s);
  });
});
