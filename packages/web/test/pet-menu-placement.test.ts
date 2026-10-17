/**
 * The pet's context menu placement.
 *
 * The window is ~96px wide at rest and the menu is `position: fixed` inside it, so anything that
 * does not fit is clipped by the window's own edge. That is not a hypothetical: "显示宠物" is wider
 * than the window, and it rendered as "宠物".
 *
 * The rule is a handful of comparisons, but which of them fires depends on the window size and the
 * click position together — and the bottom-right pet is the common case while the crop in the bug
 * report is the top-left combination. Those are exactly the pairs a manual check misses, so they
 * are pinned here.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  menuPlacement,
  PET_MENU_EDGE_MARGIN,
  type PetMenuAnchor,
} from "../src/features/pet/pet-menu";

/** The window as the shell sizes it for a pet alone: PET_WINDOW_BASE_* in pet-window.ts. */
const PET_WINDOW = { width: 96, height: 104 };
const MENU = { width: 132, height: 58 };

const place = (anchor: PetMenuAnchor, viewport = PET_WINDOW) => menuPlacement(anchor, MENU, viewport);

describe("宠物菜单定位", () => {
  it("窗口足够容纳菜单时，菜单完整落在窗口内", () => {
    // 这是 pet-window-page 在菜单打开时扩出的窗口：菜单 + 宠物。
    const grown = { width: 132 + 96, height: 104 };
    const p = place({ right: 130, bottom: 60 }, grown);
    expect(p.right + MENU.width).toBeLessThanOrEqual(grown.width - PET_MENU_EDGE_MARGIN);
    expect(p.bottom + MENU.height).toBeLessThanOrEqual(grown.height - PET_MENU_EDGE_MARGIN);
  });

  it("点击靠左时向右翻转，而不是被左边界切掉", () => {
    // Click near the left edge → the menu cannot extend further left, so it flips right.
    // This is the reported crop: the old code kept extending left and lost "显示" off the window.
    const p = place({ right: 2, bottom: 20 });
    expect(p.right).toBeGreaterThanOrEqual(PET_MENU_EDGE_MARGIN);
  });

  it("点击靠上时向下翻转", () => {
    const p = place({ right: 48, bottom: 2 });
    expect(p.bottom).toBeGreaterThanOrEqual(PET_MENU_EDGE_MARGIN);
  });

  it("菜单装不下时不产生负偏移（越界到窗口外）", () => {
    // 96px 的窗口放不下 132px 的菜单 —— 这正是要修的情况。此时定位函数无法凭空造出空间，
    // 但必须保证偏移非负：负偏移会把菜单推到窗口左侧之外，比向右溢出更糟。
    const p = place({ right: 48, bottom: 52 });
    expect(p.right).toBeGreaterThanOrEqual(0);
    expect(p.bottom).toBeGreaterThanOrEqual(0);
    // 仍然贴着可用边距，给窗口扩展留出正确的角落。
    expect(p.right).toBeGreaterThanOrEqual(PET_MENU_EDGE_MARGIN);
  });

  it("菜单比窗口还宽时，偏移仍非负", () => {
    const p = place({ right: 48, bottom: 52 }, { width: 60, height: 40 });
    expect(p.right).toBeGreaterThanOrEqual(0);
    expect(p.bottom).toBeGreaterThanOrEqual(0);
  });

  it("窗口足够大时不翻转，保持点击方向", () => {
    // A grown window (menu open, or a bubble up): the natural up-and-left placement should survive.
    const big = { width: 360, height: 240 };
    const p = place({ right: 200, bottom: 100 }, big);
    expect(p.right).toBe(200);
    expect(p.bottom).toBe(100);
  });

  it("两个轴独立判断", () => {
    // Click low-left: enough width to the left is impossible, enough height to go up is fine.
    const p = place({ right: 1, bottom: 100 });
    expect(p.right).toBeGreaterThanOrEqual(PET_MENU_EDGE_MARGIN);
    // Click high-right: the reverse.
    const q = place({ right: 100, bottom: 1 });
    expect(q.bottom).toBeGreaterThanOrEqual(PET_MENU_EDGE_MARGIN);
  });
});

describe("菜单打开时窗口会扩展", () => {
  // 定位函数再正确也无法凭空造出空间：菜单必须由窗口来容纳。真正让「显示宠物」完整显示的是
  // 页面把窗口撑大，所以这条断言钉的是那个修复，而不是定位。
  const page = readFileSync(
    new URL("../src/features/pet/pet-window-page.tsx", import.meta.url),
    "utf8",
  );

  it("窗口宽度把菜单算进去了", () => {
    expect(page).toMatch(/menuWidth \+ petWidth/);
    // 菜单宽度来自 pet-menu 的常量，而不是页面里另写一个数字 —— 否则改 CSS 时不会一起更新。
    expect(page).toContain("MENU_MIN_WIDTH");
  });

  it("菜单关闭后窗口复原，不留透明边距", () => {
    expect(page).toMatch(/const menuRows = menu === null \? 0 : menu\.items\.length/);
  });
});