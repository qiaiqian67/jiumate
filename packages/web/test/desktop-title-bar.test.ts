/**
 * The page-drawn title bar.
 *
 * Three things about it can only be checked by reading the source, and each has bitten or would
 * bite silently:
 *
 *  - its height has to equal the main process's, because the native caption buttons are positioned
 *    against it and a mismatch is content tucked under the buttons — visible only at one window size;
 *  - its colour has to be the layout frame's, which is the whole point of the change: a strip of a
 *    third colour is what the native bar looked like;
 *  - it only makes sense where the frame is actually hidden, so it must not render in a browser.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TITLE_BAR_HEIGHT } from "../src/components/layout/desktop-title-bar";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

const mainSrc = read("../../desktop/src/main.ts");
const layoutSrc = read("../src/components/layout/app-layout.tsx");
const css = read("../src/styles.css");
const barSrc = read("../src/components/layout/desktop-title-bar.tsx");

describe("桌面标题栏", () => {
  it("高度与主进程一致", () => {
    // 两份拷贝无法共享模块（desktop 与 web 独立构建，渲染进程也拿不到主进程的常量），
    // 所以这个等式靠测试钉住，而不是靠约定。
    expect(mainSrc).toContain(`const TITLE_BAR_HEIGHT = ${TITLE_BAR_HEIGHT};`);
    expect(css).toContain(`height: ${TITLE_BAR_HEIGHT}px;`);
  });

  it("底色与左侧导航所在的外层灰底一致", () => {
    // 这正是这次改动要解决的问题：原生标题栏是 Windows 画的浅色，与已跟随主题的侧栏不一致。
    expect(css).toMatch(/\.jiumate-title-bar\s*\{[^}]*bg-gray-100/);
    expect(css).toMatch(/\.jiumate-title-bar\s*\{[^}]*dark:bg-gray-900/);
    // 侧栏自己继承的正是这个外层灰底。
    expect(layoutSrc).toContain('bg-gray-100 dark:bg-gray-900');
  });

  it("只在桌面壳里渲染（浏览器有标签页标题栏）", () => {
    expect(layoutSrc).toMatch(/desktopMode && <DesktopTitleBar \/>/);
    expect(layoutSrc).toContain('import { DesktopTitleBar } from "./desktop-title-bar"');
  });

  it("标题栏整条可拖动窗口", () => {
    expect(css).toMatch(/\.jiumate-title-bar\s*\{[^}]*-webkit-app-region:\s*drag/);
  });

  it("为右上角原生按钮留出位置，最大化时收窄", () => {
    // 不留位置，标题会被最小化/最大化/关闭三个按钮压在下面。
    expect(css).toMatch(/\.jiumate-title-bar\s*\{[^}]*padding-right:\s*138px/);
    // 最大化后 Windows 把按钮缩回还原尺寸，再留 138px 会让标题无谓地偏右。
    expect(barSrc).toMatch(/maximized \? "8px" : undefined/);
  });

  it("窗口最大化状态由主进程告知，渲染进程自己猜不到", () => {
    expect(mainSrc).toContain('ipcMain.handle("titlebar:isMaximized"');
    expect(mainSrc).toContain('"titlebar:maximizeChanged"');
    // 只在 Windows 上启用：macOS 的红绿灯在原生 frame 里，Linux 各 toolkit 支持不一。
    expect(mainSrc).toMatch(/if \(process\.platform === "win32"\) wireTitleBarEvents\(win\)/);
  });

  it("标题与浏览器标签页一致，不另行维护一份", () => {
    // 页面已经通过 useDocumentTitle 设置 document.title；这里读它，两边就不可能不一致。
    expect(barSrc).toContain("document.title");
    expect(barSrc).toContain("MutationObserver");
  });

  it("内容面板保留顶部内缩，标题栏的灰底在其上", () => {
    // 这里曾经想过把 md:mt-2 去掉，让面板顶边贴住标题栏底边。那是错的：面板四边都内缩是
    // "浮在灰底上"这一设计的全部（app-frame-layout.test.ts 钉着它），只去掉顶部就只剩三个
    // 方向，顶部会重新读成"填满屏幕的白"。标题栏本身就是灰的，与面板之间那道缝由它接上。
    expect(layoutSrc).toContain("bg-white md:mt-2 md:mr-2 md:mb-2 md:rounded-lg");
  });
});