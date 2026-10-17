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

const item = (m: TrayMenuItem): { kind: string; label?: string; id?: string; sessionId?: string } => m;

/** The rows shown directly under the heading, i.e. excluding anything in the submenu. */
const visibleRows = (menu: TrayMenuItem[]) =>
  menu.filter((m) => m.kind === "item" && m.sessionId !== "");

const submenu = (menu: TrayMenuItem[]) => menu.find((m) => m.kind === "submenu");

describe("托盘菜单结构", () => {
  it("按参考布局：最近任务在前，动作在后", () => {
    const menu = buildTrayMenu({ rows: rows(3), labels: ZH });
    expect(item(menu[0])).toMatchObject({ kind: "heading", label: "最近任务" });
    // 5 + 3 之后是分隔线，然后是新对话 / 设置 / 退出。
    const actions = menu.filter((m) => m.kind === "action").map((m) => item(m).id);
    expect(actions).toEqual(["new-chat", "settings", "quit"]);
    // 动作必须在列表之后。
    expect(menu.findIndex((m) => m.kind === "action")).toBeGreaterThan(
      menu.findIndex((m) => m.kind === "heading"),
    );
  });

  it("最近任务直接显示 5 个", () => {
    const menu = buildTrayMenu({ rows: rows(9), labels: ZH });
    expect(RECENT_VISIBLE).toBe(5);
    expect(visibleRows(menu)).toHaveLength(5);
  });

  it("超出 5 个的部分进「更多」子菜单，最多 10 个", () => {
    const menu = buildTrayMenu({ rows: rows(30), labels: ZH });
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
    expect(submenu(buildTrayMenu({ rows: rows(5), labels: ZH }))).toBeUndefined();
  });

  it("多于 15 个时「更多」也只有 10 个", () => {
    expect(moreCount(16)).toBe(MORE_LIMIT);
    expect(moreCount(999)).toBe(MORE_LIMIT);
    expect(moreCount(0)).toBe(0);
  });

  it("一个会话都没有时给一行提示，而不是留一个空标题", () => {
    const menu = buildTrayMenu({ rows: [], labels: ZH });
    expect(item(menu[0])).toMatchObject({ kind: "heading", label: "最近任务" });
    // 空 sessionId 表示占位行：点击它不能去打开一个空会话。
    const rowsShown = menu.filter((m) => m.kind === "item");
    expect(rowsShown).toHaveLength(1);
    expect(item(rowsShown[0]).sessionId).toBe("");
  });

  it("英文环境下文案随之切换", () => {
    const menu = buildTrayMenu({ rows: rows(9), labels: appTrayLabels("en-US") });
    expect(item(menu[0])).toMatchObject({ label: "Recent" });
    expect(item(submenu(menu)!)).toMatchObject({ label: "More" });
    expect(menu.filter((m) => m.kind === "action").map((m) => item(m).id)).toEqual([
      "new-chat",
      "settings",
      "quit",
    ]);
  });
});