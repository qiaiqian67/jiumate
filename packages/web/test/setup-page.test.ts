/**
 * 首次运行的安装向导。
 *
 * 这些用例钉的是**只有这一处会悄悄错**的几件事，不是布局：向导由桌面壳单独开窗承载
 * （见 packages/desktop/src/setup-window.ts），所以页面本身一旦越过壳去做壳的活——自己写
 * 完成标记、自己存语言、自己保存数据目录——就能把「只出现一次」这件事悄悄破坏掉，而且
 * 页面上没有任何东西会因此报错。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const src = (...parts: string[]): string =>
  fs.readFileSync(path.join(__dirname, "..", "src", ...parts), "utf8");

const page = src("pages", "setup.tsx");
const router = src("router.tsx");
const globals = src("global.d.ts");
const desktopWindow = fs.readFileSync(
  path.join(__dirname, "..", "..", "desktop", "src", "setup-window.ts"),
  "utf8",
);
const zh = src("lib", "strings.ts");
const en = src("lib", "strings-en.ts");

/**
 * The source with comments stripped, for assertions that a name does not appear in the code.
 * These pages explain at length why they avoid a call, and a substring check would match its own
 * explanation — which is exactly the assertion that passes for the wrong reason.
 */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the setup wizard", () => {
  it("is hosted in the shell's own window, not as a route the main window navigates to", () => {
    // The shell decides whether the wizard appears (no marker on disk) and destroys the window
    // when the page reports done. A route inside the app shell would mean the main window loads
    // before there is a marker, which is the thing this design exists to prevent.
    expect(desktopWindow).toContain("new BrowserWindow");
    expect(desktopWindow).toContain("frame: false");
    expect(desktopWindow).toContain("/setup");
    // Standalone like /pet: no sidebar, no Project context.
    expect(router).toContain('path="/setup"');
    expect(router).toMatch(/path="\/setup"[\s\S]{0,220}RequireAuthBare/);
  });

  it("leaves the completion marker to the shell", () => {
    // A renderer that could write its own marker is one bad keypress away from never being
    // asked again — and nothing on the page would report it.
    expect(page).not.toMatch(/localStorage[^\n]*setup-complete/);
    expect(page).toContain("bridge.done(lang)");
    expect(desktopWindow).toContain("writeSetupMarker");
  });

  it("releases the session token itself rather than leaving it for the main window", () => {
    // The token is one-shot and /setup sits behind the auth guard, so a wizard that let the
    // main window claim it would load with no session and bounce to /login.
    expect(desktopWindow).toContain("/api/auth/claim?token=");
    expect(desktopWindow).toContain("loginToken");
  });

  it("writes the language the app already reads, rather than a second copy", () => {
    // Two copies of a preference are two copies that disagree. The step calls the locale
    // provider's own setter and stores nothing itself; only the shell's marker carries the
    // choice, and that is diagnostics only. (The key name appears above only in this comment.)
    expect(page).toContain("setLang(value as LangPref)");
    expect(page).not.toMatch(/localStorage\.setItem\([^)]*lang/i);
    expect(page).not.toMatch(/localStorage[^\n]*setup-complete/);
  });

  it("keeps every shell affordance behind the bridge's presence", () => {
    // Absent in a plain browser, where someone can type /setup by hand. A title-bar control
    // that minimizes a window which does not exist would be a button that does nothing.
    expect(page).toContain("const bridge = window.setup");
    expect(page).toMatch(/\{bridge !== undefined && \(\s*<div className="flex h-11/);
    expect(page).toContain("bridge.pickDataDir()");
  });

  it("shows the CLI's real outcome and invents none", () => {
    // The shell reports five outcomes; a sixth would be a claim about something nobody checked.
    expect(page).toContain("cliState()");
    for (const outcome of ["installed", "current", "foreign", "deferred", "failed"]) {
      expect(page).toContain(`CLI_RESULT_LABEL`);
    }
    // Absent before anything has run, rather than a success nobody confirmed.
    expect(page).toMatch(/cli\?\.lastResult != null/);
  });

  it("leaves the packaged size a placeholder rather than inventing a number", () => {
    // Nobody has measured an installer yet; a number written before `pnpm pack` produces one
    // is a guess wearing the costume of a measurement.
    expect(page).toContain("requiredSpacePending");
    expect(page).not.toMatch(/\d+\s*MB/);
  });

  it("offers the same four steps in both dictionaries", () => {
    for (const dict of [zh, en]) {
      for (const key of [
        "stepLanguage",
        "stepPrepare",
        "stepModel",
        "stepAppearance",
        "langZh",
        "langEn",
        "langSystem",
      ]) {
        expect(dict).toContain(`${key}:`);
      }
    }
    // The reference design also offered Traditional Chinese; this app ships zh / en / system
    // (see state/locale.tsx), so a third radio would be a choice nothing is behind.
    expect(page).not.toContain("zh-TW");
  });

  // The three below each pin a control that existed and did nothing. None of them threw, and
  // nothing on the page would have reported the absence — which is why they are pinned rather
  // than left to be noticed by someone clicking through a wizard once.
  it("offers the provider's real catalog models, not an imagined field", () => {
    // There is no `models` on ModelProviderInfo. The catalog is keyed by provider and is the
    // same list the models page offers, so that is what the dropdown reads from.
    expect(page).toContain("MODEL_CATALOG.filter((m) => m.provider === provider)");
    // Value is the upstream id (sent to AgentHub as-is); the text is the display name.
    expect(page).toContain("value={m.modelId}");
    expect(page).toContain("{m.displayName}");
  });

  it("actually tests the connection against the server", () => {
    expect(page).toContain("api.testModel(projectId");
    expect(page).toContain("api.listProjects()");
    // `useProject()` would throw here: /setup goes through RequireAuthBare, so there is no
    // ProjectProvider above it. Taking the first project from the API is the way around that.
    // Matched against the code only — the name appears in the comment explaining this.
    expect(code(page)).not.toMatch(/useProject\(/);
    // The server's own reason survives; "failed" alone answers none of key / endpoint / model.
    expect(page).toContain("apiErrorText(err)");
  });

  it("reports each bundled component's real availability, and never claims readiness early", () => {
    expect(code(page)).toMatch(/\.components\(\)/);
    expect(desktopWindow).toContain("probeComponents");
    // Null while the answer is in flight is its own state — the previous version printed
    // 检查中 forever, which reads as a stuck check and never became an answer.
    expect(page).toContain("componentUnknown");
    expect(page).toMatch(/components\?\.\[c\.id\]/);
  });
});
