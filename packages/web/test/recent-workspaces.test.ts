/**
 * 「近期使用」的排序：从会话推出最近用过的工作区。
 *
 * 这个函数存在的全部理由是**注册顺序不等于使用顺序**。注册表按添加顺序排，而"近期"问的
 * 是最近在哪几个工作区聊过天——先建 A 后建 B 却一直用 A 时，两者给出的顺序是相反的。
 * 所以这里钉住的是排序依据本身，而不是某个具体结果。
 */
import { describe, expect, it } from "vitest";
import {
  RECENT_WORKSPACE_LIMIT,
  recentWorkspaces,
  type WorkspaceUse,
} from "../src/lib/recent-workspaces";

const at = (iso: string, workspace: string): WorkspaceUse => ({ workspace, createdAt: iso });

describe("recentWorkspaces", () => {
  it("按各工作区最新会话的时间排序，最新的在前", () => {
    // 关键场景：A 先建、B 后建，但最近一直在 A 里聊。注册顺序会把 B 排前面；这里必须按
    // 使用时间排，A 在前。
    const sessions = [
      at("2026-06-01T10:00:00.000Z", "/w/a"), // A 的最新
      at("2026-05-01T10:00:00.000Z", "/w/a"), // A 的旧会话，不应影响
      at("2026-05-20T10:00:00.000Z", "/w/b"), // B 较新
      at("2026-06-05T10:00:00.000Z", "/w/c"), // C 最新
    ];
    expect(recentWorkspaces(sessions, [])).toEqual(["/w/c", "/w/a", "/w/b"]);
  });

  it("同一工作区的多个会话只出现一次，且以最新的那个定位", () => {
    const sessions = [
      at("2026-01-01T00:00:00.000Z", "/w/a"),
      at("2026-03-01T00:00:00.000Z", "/w/a"),
      at("2026-02-01T00:00:00.000Z", "/w/a"),
    ];
    // 三条会话、一个条目，位置由 3 月那条决定（排在最前）。
    expect(recentWorkspaces(sessions, [])).toEqual(["/w/a"]);
  });

  it("上限 6 条", () => {
    // 截图上写的是 5-6 个；6 是"最近"的合理上限，再多就成了目录列表。
    expect(RECENT_WORKSPACE_LIMIT).toBe(6);
    const many = Array.from({ length: 20 }, (_, i) =>
      at(`2026-06-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`, `/w/${i}`),
    );
    expect(recentWorkspaces(many, [])).toHaveLength(6);
  });

  it("临时工作区不进列表", () => {
    // 临时工作区不是一个目录，而是"没选目录"的状态——选它等于什么都不选，而触发器本身
    // 已经表示这个状态了。真实形状是 <…>/workspaces/tmp-<8位十六进制>。
    const sessions = [
      at("2026-06-01T10:00:00.000Z", "/w/real"),
      at("2026-06-09T10:00:00.000Z", ""), // 最"新"，但不该出现
      at("2026-06-08T10:00:00.000Z", "/data/workspaces/tmp-1a2b3c4d"),
    ];
    expect(recentWorkspaces(sessions, [])).toEqual(["/w/real"]);
  });

  it("没用过但已注册的工作区补在后面，按添加顺序", () => {
    // 刚建好还没聊过的工作区不能因此消失——"存在但看不见"比"看不见"更糟。
    const sessions = [at("2026-06-01T10:00:00.000Z", "/w/used")];
    expect(recentWorkspaces(sessions, ["/w/registered-b", "/w/registered-a"])).toEqual([
      "/w/used",
      "/w/registered-b",
      "/w/registered-a",
    ]);
  });

  it("同时用过又注册的工作区只出现一次，且位置由会话决定", () => {
    // 两个来源合并的位置，取"用过"证据更强的那一个。
    const sessions = [
      at("2026-06-01T10:00:00.000Z", "/w/both"),
      at("2026-06-01T10:00:00.000Z", "/w/a"),
    ];
    const out = recentWorkspaces(sessions, ["/w/both"]);
    expect(out).toHaveLength(2);
    expect(out).toContain("/w/a");
    expect(out).toContain("/w/both");
    // 同一时刻用路径做次级排序：否则顺序取决于 Map 的插入顺序，而插入顺序取决于会话
    // 到达的顺序——刷新一次页面，同一分钟建的几个工作区就会换个次序。
    expect(out).toEqual([...out].sort());
  });

  it("注册补位不会突破上限", () => {
    const used = Array.from({ length: 4 }, (_, i) =>
      at(`2026-06-0${i + 1}T00:00:00.000Z`, `/w/used-${i}`),
    );
    const registered = Array.from({ length: 10 }, (_, i) => `/w/reg-${i}`);
    expect(recentWorkspaces(used, registered)).toHaveLength(RECENT_WORKSPACE_LIMIT);
  });

  it("没有会话时就是注册列表（去掉重复和临时的）", () => {
    expect(recentWorkspaces([], ["/w/a", "/w/a", "", "/w/b"])).toEqual(["/w/a", "/w/b"]);
  });

  it("空输入返回空列表", () => {
    expect(recentWorkspaces([], [])).toEqual([]);
  });

  it("路径两侧的空白被裁掉（会话里存的路径可能带空格）", () => {
    // 同一个工作区写有两种空白会变成两个条目，而磁盘上它们是同一个目录。
    const sessions = [
      at("2026-06-02T00:00:00.000Z", " /w/a "),
      at("2026-06-01T00:00:00.000Z", "/w/a"),
    ];
    expect(recentWorkspaces(sessions, [])).toEqual(["/w/a"]);
  });
});
