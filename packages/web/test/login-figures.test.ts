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
    // 白色眼白和黑色瞳孔的关系：瞳孔填满眼白再缩小，所以它能从中心移到边缘的最大距离是
    // (1 - scale) / 2 × 眼白。
    //
    // 这里曾经断言 `PUPIL_TRAVEL <= 0.5`，那个数不是几何约束：行程是"可见瞳孔尺寸的一个
    // 比例"，可见瞳孔又只有眼白的 scale，所以真实上限是 `travel × scale ≤ (1 - scale) / 2`。
    // 0.5 在 scale=0.62 时是超标的（0.31 > 0.19），几何测试抓到了——而当时这条断言拦下了
    // 正确的 0.55。断言了一个看起来合理却与几何无关的数，会挡住修复它自己该挡的东西。
    const travel = Number(/const PUPIL_TRAVEL = ([\d.]+)/.exec(FIGURES)?.[1]);
    const scale = Number(
      /transform: scale\(([\d.]+)\)/.exec(CSS.split(".watch-pupil {")[1] ?? "")?.[1],
    );
    expect(travel).toBeGreaterThan(0);
    expect(scale).toBeGreaterThan(0);
    // 行程不越界。
    expect(travel * scale, "瞳孔不能移出眼白").toBeLessThanOrEqual((1 - scale) / 2);
    // 但要够明显，否则看不出在跟随。
    expect(travel * scale, "行程要够长").toBeGreaterThan(0.15);
    // 位移按瞳孔自身尺寸算，不写死像素。
    expect(FIGURES).toContain("box.width * PUPIL_TRAVEL");
    // 偏移走 translate 属性，不碰 transform —— 后者归样式表的 scale 所有（见下）。
    expect(FIGURES).toContain("pupil.style.translate");
    expect(FIGURES).not.toContain("pupil.style.transform");
  });

  it("瞳孔的缩放由样式表拥有，脚本只写位移", () => {
    // transform: scale(...) 是让瞳孔在眼白里露出来的唯一原因。脚本若写 transform 就会把它
    // 整个替换掉，指针一动八个瞳孔同时涨回全尺寸、盖住眼白。
    expect(CSS).toMatch(/\.watch-pupil \{[^}]*transform: scale\([\d.]+\)/s);
    expect(CSS).toMatch(/\.watch-pupil \{[^}]*translate: 0 0/s);
  });

  it("小紫朝右倾（输入框在右侧）", () => {
    // 表单在右半边、小人在左半边，倾过去读用户名就该向右。原来往左倾，是背离它要看的东西。
    expect(CSS).toMatch(
      /\.watch-figure\[data-leaning\] \{[^}]*translate\(10px, -50%\) rotate\(8deg\)/s,
    );
  });

  it("输入密码时整只眼睛左移，不只瞳孔", () => {
    // 只移瞳孔读起来是眼睛歪了；眼白带着瞳孔一起移才是"视线转开"。
    expect(FIGURES).toContain('className="watch-eyes" data-look-away=');
    expect(CSS).toMatch(/\.watch-eyes\[data-look-away\] \{[^}]*translate: -[\d.]+cqh/s);
  });

  it("小人的尺寸全部用 cqh 相对面板高度，所以面板高度变化时构图不变", () => {
    // 曾经是写死的像素（最高的 265px），只对 600px 高的卡片是对的：窗口一矮，要么被裁掉，
    // 要么顶部空一大片。现在一切都相对面板高度。
    //
    // 关键：不能用 `em` + `font-size: 百分比` 来间接表达 —— font-size 的百分比是相对父元素
    // 的字号（约 16px），不是高度，基准会变成约 7px，整个小人塌成细线、眼睛嘴巴消失。
    // cqh 才是"容器高度的 1%"这个意思。
    expect(CSS).toContain("container-type: size");
    expect(CSS).toMatch(/\.watch-figure \{[^}]*width: [\d.]+cqh/s);
    expect(CSS).not.toMatch(/\.watch-figure \{[^}]*font-size/s);
    expect(FIGURES).not.toContain("fontSize: spec.height");
    // 不再有写死的 px 尺寸。
    expect(CSS).not.toMatch(/\.watch-eye \{[^}]*width: \d+px/s);
    expect(CSS).not.toMatch(/\.watch-eyes \{[^}]*top: \d+px/s);
    expect(CSS).not.toMatch(/[\d.]+em/);
  });

  it("嘴巴张开时是圆的不是更高的方块", () => {
    // 只加高不圆化会读成"一条更粗的线"，不是张开的嘴。
    expect(CSS).toMatch(
      /\.watch-mouth\[data-surprised\] \{[^}]*height: [\d.]+cqh;[^}]*border-radius: 50%/s,
    );
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
    expect(FIGURES).toContain('pupil.style.translate = "0 0"');
  });

  it("空提交 → 全体张嘴并站直", () => {
    expect(PAGE).toContain('setStartled(userId.trim() === "" && password.trim() === "")');
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
  it("保留原有的登录流程，没有引入注册或找回密码", () => {
    // 参考设计有「记住密码」和「忘记密码?」。本项目没有自助注册（账号由管理员创建），
    // 也没有找回密码功能——放一个点不动的链接比不放更糟。
    expect(PAGE).toContain("await login(userId.trim(), password)");
    // 断言的是没有对应的**控件**，而不是源码里没有这些词——本页的注释本来就解释了
    // 为什么不做它们（"remember me" / "forgot password?" 出现在那段说明里）。
    expect(PAGE).not.toMatch(/<(input|button|a)[^>]*type="checkbox"/);
    expect(PAGE).not.toMatch(/rememberMe|forgotPassword|onForgot/);
  });

  it("登录页已去掉管理员说明、副标题和语言/主题切换", () => {
    // 三处都是登录页上没人需要的东西：管理员认领与重置密码是给运维看的（且其中一条是 CLI 命令，
    // 浏览器用户根本无法照做），副标题和语言/主题切换属于应用内设置，登录页不是设置的地方。
    expect(PAGE).not.toContain("S.auth.defaultAdminNote");
    expect(PAGE).not.toContain("S.auth.forgotAdminNote");
    expect(PAGE).not.toContain("S.auth.loginSubtitle");
    expect(PAGE).not.toContain("Segmented");
    // 连带的 hook 与选项数组一并移除，否则会留下未使用的导入。
    expect(PAGE).not.toMatch(/useLocale|useTheme|LangPref|ThemeMode|langOptions|themeOptions/);
  });

  it("底部有版权", () => {
    expect(PAGE).toContain("©2026-2028 安徽经邦软件技术有限公司 版权所有");
    // `shrink-0` 而不是 `mt-auto`：列靠表单的 `flex-1` 把版权推到最底下，`mt-auto` 是第二套
    // 机制做同一件事，而且矮窗口下（列溢出滚动）auto 边距解析为 0，会静默失效。
    expect(PAGE).toMatch(/shrink-0[^"]*"[\s\S]{0,120}版权所有/);
  });

  it("表单在 logo 与版权之间居中，而不是整列居中", () => {
    // 整列 justify-center 会把 logo+表单+版权当作一整块居中，表单的位置取决于另外两者的分量：
    // 卡片一高表单就偏下，还会随版权漂移。改成三段——logo 在上、表单 flex-1 自居中、版权在下。
    expect(PAGE).not.toMatch(/flex w-full min-w-0 flex-col justify-center/);
    // `my-auto` 让表单吃掉品牌与版权之间的余量并上下平分。
    expect(PAGE).toMatch(/<form\s+className="my-auto w-full space-y-4"/);
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
    expect(FIGURES).toContain("hidden h-full w-full overflow-hidden bg-gray-100 lg:block");
  });

  it("面板有高度，否则四个小人一个都不显示", () => {
    // 这一条钉的是"左边空白"的根因。小人是 position: absolute 且用百分比 top 定位：绝对
    // 定位的元素不撑起父容器，所以没有 h-full 时面板高度为 0，每个 top: 50% 都解析成 0，
    // 而卡片有 overflow-hidden —— 四个小人被整体裁掉，左半边只剩一片灰。
    // 高度由卡片给（下面这条断言），面板负责填满它。
    expect(FIGURES).toContain("relative hidden h-full w-full overflow-hidden");
    // 整条链：卡片给高度 → 面板 h-full 继承 → 小人百分比定位有参照。
    expect(PAGE).toContain("lg:h-[600px]");
    expect(PAGE).toMatch(/<div className="min-w-0 flex-1">\s*<WatchFigures/);
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
