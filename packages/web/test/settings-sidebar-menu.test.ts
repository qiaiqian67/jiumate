/**
 * The sidebar's settings takeover: the gate the menu rows are filtered through, and the
 * structural fact that the rows live in the sidebar rather than in the pane.
 *
 * The first cut of the page drew its own rail. That put two lists of near-identical rows on
 * one screen — the app's own nav on the left, the settings categories in the content area —
 * and the two competed. The categories are the app's navigation, so they belong where the
 * app keeps its navigation; these tests pin that split so it cannot silently invert again.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = (p: string) =>
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), p), "utf8");

const SIDEBAR = "../src/components/layout/sidebar.tsx";
const PANE = "../src/features/settings/settings-page.tsx";

describe("the settings menu in the sidebar", () => {
  const source = src(SIDEBAR);
  const pane = src(PANE);

  it("takes the column over while a settings route is open", () => {
    // The whole point: settings answer with "here are the settings you can change" and the
    // normal column steps aside. Both branches are keyed on the same flag, so the nav and the
    // session list can never show at the same time as the menu.
    expect(source).toContain('useMatch("/settings")');
    expect(source).toContain("{settingsOpen && (");
    expect(source).toContain("{!settingsOpen && (");
  });

  it("keeps the brand row and the user row in both modes", () => {
    // Deliberate: the app is still the app while you are in settings, so collapsing the
    // column and signing out stay reachable without walking out first. The brand row sits
    // ABOVE the `settingsOpen` branch and the user row BELOW it — a test that both survive
    // outside the branches is what keeps a future edit from burying them inside one.
    const brand = source.indexOf("JiuMateLogo");
    const userRow = source.indexOf("S.auth.logout");
    const branch = source.indexOf("{settingsOpen && (");
    expect(brand).toBeGreaterThan(-1);
    expect(userRow).toBeGreaterThan(-1);
    expect(branch).toBeGreaterThan(-1);
    expect(brand).toBeLessThan(branch);
    expect(userRow).toBeGreaterThan(branch);
  });

  it("offers a way back, as the first row of the menu", () => {
    // The modal's close button became this row when settings became a page; without it the
    // user is stranded with nothing but the browser back gesture.
    expect(source).toContain("S.settings.backToWorkspace");
  });

  it("gates the rows with the same registry the pane resolves through", () => {
    // If the menu filtered differently from the pane, a row could lead to a page the pane
    // then refuses — a dead end the user cannot explain.
    expect(source).toContain("visibleSettingsSections({");
    expect(source).not.toContain("SECTION_RULES");
  });

  it("spaces its rows like every other list in the column", () => {
    // The rows are rounded fills, so with no gap between them they touch and the nine
    // categories read as ONE grey slab at rest — only the icons break it up. These rows are
    // the whole content of the column while in settings (no session list below them), so they
    // get a step looser than the page-nav group's `space-y-0.5`.
    expect(source).toContain('className="space-y-1"');
  });

  it("marks the active row with a left bar, the product's reference styling", () => {
    // A fill alone washes out against its neighbours' hover fills; the bar is what makes
    // the open page findable at a glance in a nine-item column. Drawn as an absolutely
    // positioned element rather than a border, because a border is clipped by the row's
    // rounded corner and would stop short of the top and bottom edges.
    expect(source).toContain("inset-y-1.5 left-0 w-0.5");
  });

  it("drives the bar, the fill and the icon's ink from one value", () => {
    // Three visuals that must never disagree about which row is open. All three read
    // `active`, resolved through the same resolveSettingsSection the pane uses.
    expect(source).toContain("const active = openSection === s.key");
    expect(source).toContain("resolveSettingsSection(requestedSection, settingsSections)");
  });

  it("never reads NavLink's own isActive for the row state", () => {
    // The bug that shipped a fully grey column: every row's `to` is the same PATH
    // (`/settings?section=…` — react-router matches on path, ignoring the query), so
    // NavLink's isActive is true for all nine rows simultaneously and painted every one of
    // them. The query, and only the query, tells the rows apart.
    //
    // Asserted as an absence across the category-row markup, because the exit row and the
    // page-nav rows further down legitimately use NavLink's own isActive (their paths DO
    // differ), and pinning those would be pinning the bug.
    //
    // Comments are stripped first: this very file's rationale for the rule is a comment that
    // says "isActive", and a substring check would otherwise be asserting against prose.
    const start = source.indexOf("to={`/settings?section=${s.key}`}");
    const rows = source
      .slice(start, source.indexOf("</NavLink>", start))
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    expect(start).toBeGreaterThan(-1);
    expect(rows).toContain("aria-current={active ?");
    expect(rows).not.toContain("isActive");
  });

  it("keeps aria-current on the row, since NavLink no longer sets it for us", () => {
    // Dropping the render-prop also drops NavLink's automatic aria-current. Screen readers
    // get "current page" from that attribute, so it has to be stated from our own `active` —
    // the same value the fill reads.
    expect(source).toContain('aria-current={active ? "page" : undefined}');
  });

  it("does not give the exit row the active treatment", () => {
    // 「返回工作区」is a command, not a statement about where you are. Filling it whenever
    // /chat is already the active route would say "you are on the workspace already", which
    // is the opposite of what pressing it does.
    const exit = source.slice(source.indexOf("S.settings.backToWorkspace") - 900, 900);
    expect(exit).not.toContain("isActive");
  });

  it("draws no category list of its own in the content pane", () => {
    // The regression this file exists for: with a rail in both places, one screen carried two
    // competing menus. Asserting the pane's silence is what stops a second copy being pasted
    // back in.
    expect(pane).not.toContain("<nav");
    expect(pane).not.toContain("SETTINGS_SECTION_ICONS");
  });

  it("shares one home for a category's name and glyph", () => {
    // Both the row and the title read the same module, so a label cannot drift between the
    // two — the failure a duplicated map would allow silently.
    const labels = src("../src/lib/settings-labels.ts");
    expect(source).toContain("settingsSectionLabel");
    expect(source).toContain("SETTINGS_SECTION_ICONS");
    expect(pane).toContain("settingsSectionLabel");
    expect(labels).toContain("export function settingsSectionLabel");
    expect(labels).toContain("export const SETTINGS_SECTION_ICONS");
  });
});