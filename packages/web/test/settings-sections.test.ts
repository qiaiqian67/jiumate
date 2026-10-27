/**
 * settings-sections.ts unit tests: which System settings pages each viewer gets.
 *
 * The rule is pinned by value rather than by shape because both halves of it can fail
 * silently and separately: a rail that shows a forbidden entry leaks that the setting
 * exists, and an active page rendered without the same filter hands a non-admin the form
 * itself. Both go through these functions, so both are covered here.
 *
 * The client filter is convenience, not the boundary — the admin APIs answer a non-admin
 * with 403 either way (server/test/admin-settings.test.ts, "non-admin access is always
 * 403").
 *
 * vitest runs node-only here (`environment: "node"`, no jsdom), so this asserts against
 * the exported functions and, for the dialog's use of them, its source
 * (account-menu.test.ts convention).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  resolveSettingsSection,
  settingsGroups,
  visibleSettingsSections,
} from "../src/lib/settings-sections";

/** Admin signed into a plain `jiumate server` through the login form. */
const admin = visibleSettingsSections({
  isAdmin: true,
  desktopMode: false,
  sessionVia: "password",
});
/** Ordinary account on the same server. */
const plain = visibleSettingsSections({
  isAdmin: false,
  desktopMode: false,
  sessionVia: "password",
});
/** The desktop shell's own window: single-user, token session, no password to change. */
const shell = visibleSettingsSections({
  isAdmin: true,
  desktopMode: true,
  sessionVia: "desktop",
});
/** A browser signed into that same desktop-mode server over loopback, with a real password. */
const desktopBrowser = visibleSettingsSections({
  isAdmin: true,
  desktopMode: true,
  sessionVia: "password",
});

describe("visibleSettingsSections", () => {
  it("gives a web admin every page, in rail order", () => {
    expect(admin.map((s) => s.key)).toEqual([
      "projectManage",
      "projectMembers",
      "projectDefaults",
      "projectSecurity",
      "general",
      "appearance",
      "models",
      "application",
      "logs",
      "account",
      "proxy",
      "uploads",
      "users",
    ]);
  });

  it("gives a non-admin their own pages and nothing server-global", () => {
    // Not "fewer pages" — the exact list. Proxy, upload limits and user management are
    // admin surfaces, and the whole point of dropping them is that a non-admin is never
    // told they exist. Updating is not among them either way: it lives in the sidebar user
    // menu, outside this dialog, for every account. The application page is per-user
    // (Petdex desktop pet, …) so every account gets it — the row keys off
    // `visible: () => true`, not `isAdmin`.
    //
    // The four project pages ARE here for a non-admin: they are not server-global, they are
    // scoped to the Project you are in, and every role can read all four (the owner-only
    // parts inside each page disable themselves). A non-admin who could not open them would
    // have no way to see who else is on the Project.
    expect(plain.map((s) => s.key)).toEqual([
      "projectManage",
      "projectMembers",
      "projectDefaults",
      "projectSecurity",
      "general",
      "appearance",
      "models",
      "application",
      "logs",
      "account",
    ]);
  });

  it("strips the desktop shell's window down to what a token session can use", () => {
    // No account page (no password to change — see offersChangePassword), no user
    // management (single-user server), and no project MEMBERS page — the desktop app is
    // single-user, so there is nobody to list and the server refuses those routes.
    expect(shell.map((s) => s.key)).toEqual([
      "projectManage",
      "projectDefaults",
      "projectSecurity",
      "general",
      "appearance",
      "models",
      "application",
      "logs",
      "proxy",
      "uploads",
    ]);
  });

  it("keeps the account page for a password session against a desktop-mode server", () => {
    // Mirrors the old menu row's two-field rule: that session typed a real password and
    // can still change it, while user management stays desktop-hidden. The project MEMBERS
    // page is hidden here too — the desktop app is single-user, the same reason it was
    // hidden in the dialog's own tab rail.
    expect(desktopBrowser.map((s) => s.key)).toEqual([
      "projectManage",
      "projectDefaults",
      "projectSecurity",
      "general",
      "appearance",
      "models",
      "application",
      "logs",
      "account",
      "proxy",
      "uploads",
    ]);
  });
});

describe("the project group", () => {
  it("comes before the personal pages, as the outermost of the three", () => {
    // Project first: you have to be in a Project before "my preferences" mean anything.
    // The other two groups keep their relative order (personal, then server).
    expect(settingsGroups(admin)).toEqual(["project", "personal", "server"]);
    const keys = admin.map((s) => s.key);
    const firstPersonal = keys.indexOf("general");
    const firstServer = keys.indexOf("proxy");
    expect(keys.indexOf("projectManage")).toBeLessThan(firstPersonal);
    expect(firstPersonal).toBeLessThan(firstServer);
  });

  it("keeps the four project pages contiguous, so one heading covers exactly them", () => {
    // A group is drawn wherever the group changes; an interleaved project page would put a
    // second 「项目」heading mid-list with a single row under it.
    const groups = admin.map((s) => s.group);
    const projectAt = groups.indexOf("project");
    const projectPages = groups.filter((g) => g === "project").length;
    expect(projectPages).toBe(4);
    // …and they are the first four entries.
    expect(groups.slice(0, projectPages).every((g) => g === "project")).toBe(true);
    expect(projectAt).toBe(0);
  });
});

describe("settingsGroups", () => {
  it("lists an admin's groups once each, in page order", () => {
    expect(settingsGroups(admin)).toEqual(["project", "personal", "server"]);
  });

  it("collapses to two groups for a non-admin, the rail's cue to draw one heading", () => {
    // Every account has project pages and personal pages; only the server group is gone, so
    // this is "two", not "one". The single-group case is the desktop shell without admin
    // rights — the test below covers it.
    expect(settingsGroups(plain)).toEqual(["project", "personal"]);
  });

  it("collapses to a single group when only one remains, the rail's cue to draw no heading", () => {
    // 一组只剩一个时就不画标题——一个孤零零的「服务器」同样会让人以为还有别的组存在。
    // 三个真实组合都至少有两组，所以直接对规则本身断言，而不是编一个假的 viewer。
    expect(settingsGroups([{ key: "proxy", group: "server" }])).toEqual(["server"]);
    expect(settingsGroups([{ key: "users", group: "server" }])).toEqual(["server"]);
    expect(settingsGroups([{ key: "general", group: "personal" }])).toEqual(["personal"]);
  });
});

describe("resolveSettingsSection", () => {
  it("passes through a page the viewer may open", () => {
    expect(resolveSettingsSection("proxy", admin)).toBe("proxy");
    expect(resolveSettingsSection("appearance", plain)).toBe("appearance");
  });

  it("sends a non-admin asking for an admin page to their own first page", () => {
    // Answering identically to an unknown request is the point: a requested key cannot be
    // used to find out that "users" is a real page. The landing page is now the first
    // PROJECT page — the project group comes first in the rail, so that is where a
    // redirected viewer lands.
    expect(resolveSettingsSection("users", plain)).toBe("projectManage");
    expect(resolveSettingsSection("proxy", plain)).toBe("projectManage");
    expect(resolveSettingsSection("no-such-section", plain)).toBe("projectManage");
  });

  it("falls back to the first visible page for a missing request", () => {
    expect(resolveSettingsSection(null, admin)).toBe("projectManage");
    expect(resolveSettingsSection(undefined, admin)).toBe("projectManage");
    // A bare /settings with no query opens the Project's Manage page — "which Project am I
    // in, and what is it called" is the first thing to answer on that route.
    expect(resolveSettingsSection("", admin)).toBe("projectManage");
  });

  it("returns null when nothing is visible, rather than inventing a page", () => {
    expect(resolveSettingsSection("general", [])).toBe(null);
  });
});

describe("the System settings page", () => {
  const source = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../src/features/settings/settings-page.tsx"),
    "utf8",
  );
  const SIDEBAR = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../src/components/layout/sidebar.tsx",
  );

  it("builds its rail from the filtered list rather than the full one", () => {
    // Without this the functions above could pass every test while the page mapped over
    // the raw registry and rendered the admin rows to everyone.
    expect(source).toContain("visibleSettingsSections({");
    expect(source).not.toContain("SECTION_RULES");
  });

  it("resolves the page it renders through the same gate on every render", () => {
    // The active page is a URL value, not a right: a viewer who loses admin mid-visit
    // must fall back to their own first page rather than keep rendering the admin form.
    expect(source).toContain("resolveSettingsSection(requested, sections)");
  });

  it("keeps the requested page in the URL, so the menu is linkable and the back button walks it", () => {
    // The whole reason this left the dialog. A modal held its page in local state, which
    // the router could not see; asserting the URL is the query is what stops a future
    // refactor from quietly moving that state back into a component. The link itself is in
    // the sidebar now (it draws the menu), so the assertion is split across the two.
    expect(source).toContain('params.get("section")');
    expect(readFileSync(SIDEBAR, "utf8")).toContain("`/settings?section=${s.key}`");
  });

  it("draws no menu of its own — the categories belong to the sidebar", () => {
    // The bug this file was corrected for: with a rail here as well, one screen carried two
    // competing lists of near-identical rows (the app's nav on the left, the settings
    // categories in the content area). Asserting the absence is what keeps a second copy
    // from being pasted back in.
    expect(source).not.toContain("<nav");
    expect(source).not.toContain("SECTION_ICONS");
    expect(source).not.toContain("railItemClass");
  });
});

describe("项目设置的迁移", () => {
  const read = (p: string) =>
    readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), p), "utf8");
  // 自己的常量：外层 describe 里的那个是它的局部变量，这里看不见。
  const SIDEBAR_FILE = "../src/components/layout/sidebar.tsx";
  const PAGE = "../src/features/settings/settings-page.tsx";
  const SECTIONS = "../src/features/settings/project-sections.tsx";
  const DIALOGS = "../src/components/layout/project-dialogs.tsx";

  it("系统设置渲染四个项目页面", () => {
    // 四页各自挂载，而不是一个"项目设置"页面里再套一层标签栏——标签栏会与侧边栏的菜单
    // 重复出两列，而 URL 也该能直接指向其中一页。
    const page = read(PAGE);
    for (const p of ["manage", "members", "defaults", "security"]) {
      expect(page, p).toContain(`<ProjectSections page="${p}" />`);
    }
  });

  it("复用原有的分区组件，不复制一份表单", () => {
    // 同一份"成员权限表"存在两处，迟早只改一处。所以这里断言的是"引用"，不是"重写"。
    const sections = read(SECTIONS);
    for (const name of [
      "ProjectManageSection",
      "MembersSection",
      "ChatDefaultsSection",
      "SecurityPolicySection",
    ]) {
      expect(sections, name).toContain(name);
    }
    // 不在设置侧另写一份成员表之类的 JSX。
    expect(sections).not.toContain("api.listProjectMembers");
  });

  it("旧的项目设置弹窗已经删掉，不留第二个入口", () => {
    // 两个入口讲同一件事却在两个地方，用户会不知道该去哪；断言它不存在是防止被粘回来。
    expect(read(DIALOGS)).not.toContain("ProjectSettingsDialog");
    expect(read(SIDEBAR_FILE)).not.toContain("ProjectSettingsDialog");
    expect(read(SIDEBAR_FILE)).not.toContain("CreateProjectDialog");
  });

  it("用户菜单里不再有任何项目设置入口", () => {
    // 项目设置的唯一入口是系统设置菜单里的「项目」分组。侧边栏用户菜单里曾经有一个，
    // 而两个入口讲同一件事只会让人不知道该去哪；现在那里只剩项目切换列表本身。
    const sidebar = read(SIDEBAR_FILE);
    expect(sidebar).not.toContain("section=projectManage");
    expect(sidebar).not.toContain("S.project.settings");
    // 「新建项目」也不再是一个独立菜单项——它是项目页里的一个按钮。
    expect(sidebar).not.toContain("setCreateProjectOpen");
  });

  it("新建项目是管理页里的一个按钮，点了弹窗", () => {
    const dialogs = read(DIALOGS);
    expect(dialogs).toContain("setCreating(true)");
    expect(dialogs).toContain("<CreateProjectDialog");
    // 建完切过去：先刷新列表再切，否则新项目还不在列表里当前项目却已指向它。
    expect(dialogs).toContain("void reloadProjects().then(() => setCurrentProjectId(newId))");
  });

  it("删除当前项目后离开设置页（弹窗时代是 onClose）", () => {
    // 删掉当前项目后已经没有"上一层"可关，必须由页面决定去哪。
    const sections = read(SECTIONS);
    expect(sections).toContain("onGone={leaveSettings}");
    expect(sections).toContain('navigate("/chat")');
  });

  it("没有当前项目时给出说明，而不是空白或报错", () => {
    // 四页都要 projectId，前提没了必须有一句可见的答案。
    expect(read(SECTIONS)).toContain("S.project.noCurrentProject");
  });

  it("分组标题与行的标签读同一张表", () => {
    // 原来侧边栏硬编码了 personal/server 的二选一；新增第三组后必须改成查表，否则会显示
    // 错误的标题（或把「项目」显示成「服务器」）。
    expect(read(SIDEBAR_FILE)).toContain("settingsGroupLabel(group)");
    expect(read(SIDEBAR_FILE)).not.toContain(
      'group === "personal" ? S.settings.groupPersonal : S.settings.groupServer',
    );
  });
});
