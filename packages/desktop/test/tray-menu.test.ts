/**
 * The tray menu's shape: how many rows, under which heading, and which entries follow.
 *
 * The menu is built in the main process, where `Menu.buildFromTemplate` needs an Electron runtime
 * that this suite has none of. So the decisions are in tray-menu.ts as a pure function and this
 * asserts on its output — which is also the point: the numbers (5 visible, 10 more) and the
 * ordering are choices a reader would otherwise have to take on trust, and they are exactly what a
 * screenshot review would catch but a type checker would not.
 */
import { describe, expect, it } from "vitest";
import {
  buildTrayMenu,
  moreCount,
  MORE_LIMIT,
  RECENT_VISIBLE,
  type TrayMenuItem,
  type TrayRecentRow,
} from "../src/tray-menu.js";
import { appTrayLabels } from "../src/tray-labels.js";

const ZH = appTrayLabels("zh-CN");

const rows = (n: number): TrayRecentRow[] =>
  Array.from({ length: n }, (_, i) => ({ sessionId: `s${i}`, label: `会话 ${i}`, kindLabel: "" }));

/**
 * Narrows an entry for assertion.
 *
 * Takes `| undefined` because most call sites index into the menu (`menu[0]`) or look one entry up
 * (`find`), and a non-null assertion at each of them would say nothing a reader did not already know
 * from the line above — the index is 0 after `push`, and the `find` cases below are asserted to
 * exist by the very assertion they feed.
 */
const item = (
  m: TrayMenuItem | undefined,
): { kind: string; label?: string; id?: string; sessionId?: string; checked?: boolean } => {
  if (m === undefined) throw new Error("expected a menu entry, found none");
  return m;
};

/** The rows shown directly under the heading, i.e. excluding anything in the submenu. */
const visibleRows = (menu: TrayMenuItem[]) =>
  menu.filter((m) => m.kind === "item" && m.sessionId !== "");

const submenu = (menu: TrayMenuItem[]) => menu.find((m) => m.kind === "submenu");

/** Builds a menu with the pet off unless a test says otherwise. */
const build = (rows: TrayRecentRow[], petEnabled = false) =>
  buildTrayMenu({ rows, labels: ZH, petEnabled });

describe("托盘菜单结构", () => {
  it("按参考布局：最近任务在前，动作在后", () => {
    const menu = build(rows(3));
    expect(item(menu[0])).toMatchObject({ kind: "heading", label: "最近任务" });
    // 5 + 3 之后是分隔线，然后是宠物 / 新对话 / 设置 / 退出。
    const actions = menu.filter((m) => m.kind === "action").map((m) => item(m).id);
    expect(actions).toEqual(["new-chat", "settings", "quit"]);
    // 动作必须在列表之后。
    expect(menu.findIndex((m) => m.kind === "action")).toBeGreaterThan(
      menu.findIndex((m) => m.kind === "heading"),
    );
  });

  it("最近任务直接显示 5 个", () => {
    const menu = build(rows(9));
    expect(RECENT_VISIBLE).toBe(5);
    expect(visibleRows(menu)).toHaveLength(5);
  });

  it("超出 5 个的部分进「更多」子菜单，最多 10 个", () => {
    const menu = build(rows(30));
    const more = submenu(menu);
    expect(item(more!)).toMatchObject({ label: "更多" });
    expect(more!.kind === "submenu" && more!.items).toHaveLength(MORE_LIMIT);
    expect(MORE_LIMIT).toBe(10);
    // 5 + 10 之外的不再展示 —— 菜单不是无限长的。
    expect(visibleRows(menu).length + MORE_LIMIT).toBe(15);
  });

  it("正好 5 个时没有「更多」", () => {
    // 子菜单里没东西时，悬浮会弹出一个空面板，看起来像坏了。
    expect(moreCount(5)).toBe(0);
    expect(submenu(build(rows(5)))).toBeUndefined();
  });

  it("多于 15 个时「更多」也只有 10 个", () => {
    expect(moreCount(16)).toBe(MORE_LIMIT);
    expect(moreCount(999)).toBe(MORE_LIMIT);
    expect(moreCount(0)).toBe(0);
  });

  it("一个会话都没有时给一行提示，而不是留一个空标题", () => {
    const menu = build([]);
    expect(item(menu[0])).toMatchObject({ kind: "heading", label: "最近任务" });
    // 空 sessionId 表示占位行：点击它不能去去打开一个空会话。
    const rowsShown = menu.filter((m) => m.kind === "item");
    expect(rowsShown).toHaveLength(1);
    expect(item(rowsShown[0]).sessionId).toBe("");
  });

  it("英文环境下文案随之切换", () => {
    const menu = buildTrayMenu({ rows: rows(9), labels: appTrayLabels("en-US"), petEnabled: false });
    expect(item(menu[0])).toMatchObject({ label: "Recent" });
    expect(item(submenu(menu)!)).toMatchObject({ label: "More" });
    expect(menu.filter((m) => m.kind === "action").map((m) => item(m).id)).toEqual([
      "new-chat",
      "settings",
      "quit",
    ]);
  });

  it("宠物开关是同一个菜单里的一项，不是第二个托盘", () => {
    // 曾经有第二个 Tray：桌宠一个、应用一个。通知区里一个应用两个图标，用户说不出哪里不对，
    // 只觉得别扭。现在只有一个菜单，宠物开关在里面。
    const menu = build(rows(3), true);
    const checkbox = menu.find((m) => m.kind === "checkbox");
    expect(checkbox).toMatchObject({ id: "toggle-pet", label: "显示桌面宠物", checked: true });
  });

  it("复选框反映上报的状态", () => {
    const off = build(rows(3), false).find((m) => m.kind === "checkbox");
    const on = build(rows(3), true).find((m) => m.kind === "checkbox");
    expect(off).toMatchObject({ checked: false });
    expect(on).toMatchObject({ checked: true });
  });

  it("宠物开关在会话列表之后、退出之前", () => {
    const menu = build(rows(3), true);
    const headingAt = menu.findIndex((m) => m.kind === "heading");
    const petAt = menu.findIndex((m) => m.kind === "checkbox");
    const quitAt = menu.findIndex((m) => m.kind === "action" && m.id === "quit");
    expect(petAt).toBeGreaterThan(headingAt);
    expect(petAt).toBeLessThan(quitAt);
  });
});