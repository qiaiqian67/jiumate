/**
 * 工作区选择器的新增部分：搜索框、近期使用、打开本地文件夹。
 *
 * 这个组件的菜单逻辑（浏览目录、路径提交、请求竞态）已有其它测试覆盖，这里只钉三件新事，
 * 每件都有一个"看起来对但会在某处失效"的失败方式：
 *
 * 1. **浏览器里不能出现「打开本地文件夹」**。`window.workspace` 只在桌面端存在；渲染一个
 *    灰按钮等于告诉用户这里有个功能坏了，而真相是这台机器上根本没这个能力。
 * 2. **取消不能改变当前选择**。系统对话框的取消返回 null，如果把它当成"选中了空路径"，
 *    用户点一下取消，工作区就被清空了——一次误点丢掉了正在用的工作区。
 * 3. **搜索只过滤当前层**，且有输入时隐藏「近期使用」。后者容易被当成无关紧要：混在一起时，
 *    筛选结果里会混进一个跨层的列表，用户输入的字和看到的行对不上。
 *
 * 组件是真渲染不了的（本包 vitest 跑在 node 环境，没有 DOM），所以这些断言读源码——这是
 * account-menu.test.ts 已经在用的做法。
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = (p: string) =>
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), p), "utf8");

const SELECT = src("../src/features/chat/workspace-select.tsx");
const SIDEBAR = src("../src/components/layout/sidebar.tsx");

describe("搜索框", () => {
  it("过滤当前层的目录名", () => {
    // 只匹配名字、忽略大小写：当前层的路径前缀在每一行都一样，拿它去匹配只会让用户要打的
    // 字变长。
    expect(SELECT).toContain("const needle = filter.trim().toLowerCase()");
    expect(SELECT).toContain("allEntries.filter((e) => e.name.toLowerCase().includes(needle))");
  });

  it("不递归搜索整个目录树", () => {
    // 递归搜索要么得遍历整棵树（每次按键），要么得把文件也列进来——而"临时工作区"本来
    // 只需要选目录。路径输入框已经覆盖了跨层的场景。
    expect(SELECT).not.toContain("recurseDir");
    expect(SELECT).toContain("const entries = needle");
  });

  it("每次打开菜单都清空上一次的搜索词", () => {
    // 留着上一次的话，新一次打开时列表莫名其妙是空的，而用户并没有在搜任何东西。
    expect(SELECT).toContain('setFilter("")');
  });

  it("「没匹配到」和「这一层没有子目录」是两句不同的话", () => {
    expect(SELECT).toContain("S.chat.workspaceSearchEmpty");
    expect(SELECT).toContain("S.chat.workspaceNoSubdirs");
    // 二选一，而不是永远只说后者。
    expect(SELECT).toContain('needle !== "" ? S.chat.workspaceSearchEmpty');
  });

  it("有搜索输入时隐藏「近期使用」", () => {
    // 否则筛选结果里混着一个跨层列表，用户输入的字和看到的行对不上。
    expect(SELECT).toContain('needle === "" && recent !== undefined && recent.length > 0');
  });
});

describe("近期使用", () => {
  it("由调用方传入，组件自己不读注册表也不读会话", () => {
    // 排序逻辑在 lib/recent-workspaces.ts；选择器只负责渲染。这样"排序规则"可以被单元
    // 测试，而不必渲染组件——也让两者不会各算各的。
    expect(SELECT).toContain("recent?: readonly string[]");
    expect(SELECT).not.toContain("loadWorkspaceRegistry");
    expect(SELECT).not.toContain("recentWorkspaces");
    // Whitespace-insensitive: the call is formatted across several lines, and what the
    // test is about is which two arguments the sidebar passes, not how they are laid out.
    expect(SIDEBAR.replace(/\s+/g, " ")).toContain(
      "recentWorkspaces( sessions, registeredWorkspaces.map",
    );
  });

  it("显示目录名，完整路径放在 title 里", () => {
    expect(SELECT).toContain("title={path}");
    expect(SELECT).toContain('path.split("/").filter(Boolean).pop() ?? "/"');
  });

  it("当前正在用的那一个打勾，而不是被禁用", () => {
    // 再点一次"当前这个"应该什么都不发生，而不是变成一个点不动的灰行。
    expect(SELECT).toContain("aria-pressed={path === trimmed}");
    expect(SELECT).toContain("CHECK_ICON");
  });

  it("聊天页不传，于是没有这个列表", () => {
    // 它只知道草稿用的那一个工作区——一个只含一行的列表不配一个标题。
    const draft = src("../src/features/chat/draft-view.tsx");
    expect(draft).toContain("<WorkspaceSelect");
    expect(draft).not.toContain("recent=");
  });
});

describe("打开本地文件夹", () => {
  it("走专用的 workspace 桥接，不用主题那个", () => {
    expect(SELECT).toContain("window.workspace?.pickFolder");
    expect(SELECT).not.toContain("window.theme");
  });

  it("浏览器里整块不渲染，而不是渲染一个灰按钮", () => {
    expect(SELECT).toContain("const pickLocal = window.workspace?.pickFolder ?? null");
    expect(SELECT).toContain("{pickLocal !== null && (");
  });

  it("取消时不动当前选择、不关菜单", () => {
    // 这条最容易写错：null 同时表示"取消"和"选中了空"，当成后者就会一次误点清空工作区。
    expect(SELECT).toContain("if (picked === null) return;");
    // setOpen(false) 只能出现在 onChange 之后。
    const body = SELECT.slice(
      SELECT.indexOf("const openLocalFolder"),
      SELECT.indexOf("const menu = (") === -1 ? SELECT.length : SELECT.indexOf("const menu = ("),
    );
    expect(body.indexOf("if (picked === null) return;")).toBeLessThan(
      body.indexOf("setOpen(false)"),
    );
  });

  it("对话框打不开时等同于取消", () => {
    // 没有可依附的窗口等情况会抛；用户什么都没选，不该因此报错或改变选择。
    expect(SELECT).toContain("catch {");
  });

  it("桌面端注册了这个通道，且与主题通道分开", () => {
    expect(src("../src/global.d.ts")).toContain("workspace?: {");
    const picker = src("../../desktop/src/workspace-picker.ts");
    expect(picker).toContain('WORKSPACE_PICK_CHANNEL = "workspace:pickFolder"');
    expect(picker).not.toContain('"theme:pickFolder"');
  });

  it("对话框的标题说的是工作区，不是主题", () => {
    // 复用主题通道会让人看到"导入主题文件夹"——这是这个通道存在的全部理由。
    const labels = src("../../desktop/src/workspace-picker-labels.ts");
    expect(labels).toContain('title: "打开本地文件夹"');
    expect(labels).not.toContain("主题");
  });
});

describe("侧边栏的触发器", () => {
  it("保持原来的 24x24 加号按钮，与兄弟按钮一致", () => {
    // 曾经在这里改过一次，把加号换成了药丸 —— 那是改错了地方：要改的是按钮唤起的弹窗，
    // 不是按钮本身。同一条标题栏里的「新建智能体 / 新会话」都是 24x24 图标，只有这一个
    // 变成宽药丸会让它看起来不属于这一行。
    expect(SIDEBAR).toContain("<AddBadgeIcon base={FOLDER_ICON} />");
    expect(SIDEBAR).toContain("className={headerControlClass(open)}");
    expect(SIDEBAR).toContain("title={newEntityLabel}");
    // 药丸样式不该再出现在侧边栏（对话页那个 pill 才是它的正确位置）。
    expect(SIDEBAR).not.toContain("pillClass");
  });

  it("菜单面板仍走 portal（侧边栏的滚动容器会裁掉 in-flow 面板）", () => {
    expect(SELECT).toContain('portal={{ direction: "down", align: "right" }');
  });
});

describe("近期使用：最近用过的，不是最近添加的", () => {
  it("按各工作区最新会话的时间排序", () => {
    // 注册顺序是**添加**顺序，和"最近用过"几乎总是不同：先建 A 后建 B 却一直用 A 时，
    // 注册顺序会把没用过的 B 排在前面。
    // Whitespace-insensitive: the call is formatted across several lines, and what the
    // test is about is which two arguments the sidebar passes, not how they are laid out.
    expect(SIDEBAR.replace(/\s+/g, " ")).toContain(
      "recentWorkspaces( sessions, registeredWorkspaces.map",
    );
    expect(SIDEBAR).not.toContain("recent={registeredWorkspaces.map((e) => e.path)}");
  });

  it("列表长度上限 6 条（截图要求 5-6 个）", () => {
    expect(src("../src/lib/recent-workspaces.ts")).toContain(
      "export const RECENT_WORKSPACE_LIMIT = 6",
    );
  });

  it("临时工作区不进列表：它不是目录，选它等于什么都不选", () => {
    const lib = src("../src/lib/recent-workspaces.ts");
    expect(lib).toContain("isTempWorkspace(path)");
    expect(lib).toContain("isTempWorkspace(trimmed)");
  });
});
