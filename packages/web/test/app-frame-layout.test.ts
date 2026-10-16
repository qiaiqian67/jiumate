/**
 * 外框布局：一整块灰底 + 白色内容面板（app-layout.tsx）。
 *
 * 这层样式被覆盖过一次——不是被代码改错，而是被一次整文件的还原（为修复编码）连带丢掉，
 * 而且丢得悄无声息：编译通过、测试全绿，只是界面回到了"导航有自己底色、内容区贴边"的旧
 * 样子。所以它值得一条断言——凡是"靠 className 表达、丢了也不报错"的设计都该有。
 *
 * 三条约束各自对应一个曾经的问题：
 *
 * 1. **外层铺灰**。导航不再自己填色，于是导航与外框是同一种灰，分界只由内容面板的边缘
 *    提供。导航自带 `bg-gray-50` 的话，灰底就没有意义了——两段灰贴在一起，那正是这个设计
 *    要消除的"接缝"。
 * 2. **内容面板内缩 + 左上圆角**。右侧和下方各留 8px、左上角圆角，让主区域读起来是"浮在
 *    灰底上的一块白板"，而不是"一个填满剩余空间的 div"。
 * 3. **内缩只在 md+**。手机没有留白的余地，而且它的顶栏已经画出了同一条分界；再加 8px
 *    只会让本就很窄的屏幕再窄一点。
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const LAYOUT = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../src/components/layout/app-layout.tsx"),
  "utf8",
);

/** The content panel's className, read off the element that carries it. */
function paneClass(): string {
  const at = LAYOUT.indexOf('<div className="flex min-w-0 flex-1 flex-col');
  if (at === -1) throw new Error("content pane not found");
  const start = LAYOUT.indexOf('className="', at) + 'className="'.length;
  return LAYOUT.slice(start, LAYOUT.indexOf('"', start));
}

describe("外框：一整块灰底", () => {
  it("最外层容器铺满灰底", () => {
    // 导航与内容面板共用外层这一种灰色。少了它，两个区域各自填色，中间就多出一道接缝。
    expect(LAYOUT).toMatch(/<div className="flex h-full bg-gray-100 dark:bg-gray-900">/);
  });

  it("导航继承外层灰色，不再有自己的底色和右边框", () => {
    // border-r + bg-gray-50 会让导航成为一块独立的浅色面板，与"浮在灰底上"的设计相反。
    expect(LAYOUT).toMatch(/<aside\s+className=\{`hidden shrink-0 md:block /);
    expect(LAYOUT).not.toMatch(/<aside[\s\S]{0,200}border-r/);
    expect(LAYOUT).not.toMatch(/<aside[\s\S]{0,200}bg-gray-50/);
  });

  it("导航注释说明了它为什么不填色（防止被顺手加回来）", () => {
    expect(LAYOUT).toContain("No right border and");
    expect(LAYOUT).toContain("share ONE");
  });
});

describe("内容面板：白色浮起", () => {
  it("白底 + 四边内缩 8px + 四角圆角", () => {
    expect(LAYOUT).toContain(
      "flex min-w-0 flex-1 flex-col overflow-hidden bg-white md:mt-2 md:mr-2 md:mb-2 md:rounded-lg dark:bg-gray-950",
    );
  });

  it("四角都圆，不只是左上角", () => {
    // 面板四边都内缩后，任何一个直角都是"贴着灰色却没有任何交代"的角，看起来像忘了做
    // 而不是像有意的设计。md:rounded-lg 一次给四个角；只有左上角的 md:rounded-tl-lg 是半成品
    // ——那正是最初丢掉的版本，所以在这里钉死。
    const pane = paneClass();
    expect(pane).toContain("md:rounded-lg");
    expect(pane).not.toContain("md:rounded-tl-lg");
    expect(pane).not.toContain("md:rounded-tr-lg");
  });

  it("顶部也内缩，灰底在面板上方露出来", () => {
    // 只有右和下内缩时，面板顶边紧贴视口边缘，上面一像素灰色都没有——"浮在灰底上"就只剩
    // 了右边和下边两个方向，顶部看起来仍是"填满屏幕的白"。md:mt-2 补上这一边。
    expect(paneClass()).toContain("md:mt-2");
  });

  it("内缩只在 md 以上", () => {
    // md: 前缀是重点。手机上顶栏已经画了同一条分界，再留 8px 会挤掉本就有限的宽度。
    const pane = paneClass();
    for (const cls of ["md:mt-2", "md:mr-2", "md:mb-2", "md:rounded-lg"]) {
      expect(pane, cls).toContain(cls);
    }
    // 不存在无前缀的版本（那会让手机也被内缩）。
    expect(pane).not.toMatch(/[\s"]mt-2/);
    expect(pane).not.toMatch(/[\s"]mr-2/);
    expect(pane).not.toMatch(/[\s"]mb-2/);
    expect(pane).not.toMatch(/[\s"]rounded-lg/);
  });

  it("裁切内部内容，圆角才生效", () => {
    // 没有 overflow-hidden 时，内部滚动的子元素会溢出到圆角之外，白板边缘就穿帮了。
    expect(paneClass()).toContain("overflow-hidden");
  });

  it("内部滚动交给 main，容器不滚", () => {
    // min-h-0 是 flex 子项能收缩的前提：没有它，这一列会被内容顶高，底部内缩就露不出来。
    expect(LAYOUT).toMatch(/<main className="min-h-0 min-w-0 flex-1 overflow-hidden">/);
  });
});