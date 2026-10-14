/**
 * The library card's five commands live in one ellipsis menu.
 *
 * The behaviour is unchanged — same five commands, same handlers, same conditions — so what these
 * pin is that they are *reachable*: a control folded into a menu is one careless refactor away
 * from being unreachable, and nothing else on the page would notice.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const src = (...parts: string[]): string =>
  fs.readFileSync(path.join(__dirname, "..", "src", ...parts), "utf8");

const menu = src("features", "plugins", "card-actions-menu.tsx");
const pluginsPage = src("features", "plugins", "plugins-page.tsx");
const skillsTab = src("features", "plugins", "skills-tab.tsx");

describe("the card's actions menu", () => {
  it("is a Dropdown in portal mode", () => {
    // Portal, not in-flow: the panel hangs off a card inside a scrolling grid, and an
    // absolutely-positioned in-flow panel is clipped by any ancestor with a non-visible overflow
    // on one axis. The sidebar's menus already established this.
    expect(menu).toContain('portal={{ direction: "down", align: "right" }}');
    expect(menu).toContain("<Dropdown");
  });

  it("has an accessible name on both the trigger and the menu", () => {
    // An ellipsis glyph alone names nothing. The trigger is named after the subject; the menu
    // carries its own label so it is not announced as an unlabelled list of buttons.
    expect(menu).toContain('aria-haspopup="menu"');
    expect(menu).toContain("aria-label={`${S.chat.moreActions} ${triggerLabel}`}");
    expect(menu).toContain("aria-label={menuLabel}");
    expect(menu).toContain('role="menu"');
    expect(menu).toContain('role="menuitem"');
  });

  it("reveals the trigger on hover and on focus, gated on pointer events too", () => {
    // `opacity-0` alone would leave a tap target nobody can see sitting over every card — the
    // same defect session-row-menu documents.
    expect(menu).toContain("pointer-events-none");
    expect(menu).toContain("group-hover:pointer-events-auto");
    expect(menu).toContain("focus:pointer-events-auto");
    expect(menu).toContain("group-hover:opacity-100");
  });

  it("draws the ellipsis filled, because hairline dots vanish at button size", () => {
    expect(menu).toContain("ELLIPSIS_ICON");
    expect(menu).toContain("filled");
  });

  it("keeps the switch a Switch, in the panel's foot rather than among the commands", () => {
    // A power mark's state lives in its shape, which nobody reads at a glance; a knob at one end
    // or the other states itself. And it is a persistent state, not a command — hence the
    // separator.
    expect(menu).toContain("<Switch");
    expect(menu).toContain('role="separator"');
    expect(menu).toMatch(/\{toggle\.label\}[\s\S]*<Switch/);
  });

  it("uses the in-flow update dot on a menu row, not the corner-anchored one", () => {
    // `UpdateDot` is absolutely positioned for hanging on a control's corner; a menu row is not a
    // `relative` anchor, so it would have positioned against the Dropdown root instead.
    expect(menu).toContain("UPDATE_DOT_INLINE");
  });

  it("keeps the update dot on the trigger too, so a waiting update is visible without opening", () => {
    expect(menu).toMatch(/items\.some\(\(i\) => i\.updated\)[\s\S]*<UpdateDot/);
  });

  it("shows the switch's label without the subject, but names it for a screen reader", () => {
    // Every card on the page carries this switch, and the panel is opened from the card whose
    // name is already on screen — so repeating the name beside the knob says nothing. It is NOT
    // dropped from the accessible name either: fifteen identical 「启用」 switches are unusable.
    expect(menu).toContain("aria-label={`${toggle.label} ${toggle.subject}`}");
    expect(menu).toMatch(/<Switch[\s\S]*aria-label/);
    // The visible text is the bare label, not the composed name.
    expect(menu).toMatch(/<span className="min-w-0 truncate[\s\S]*>\s*\{toggle\.label\}/);
  });

  it("keeps unavailable commands listed and muted rather than removing them", () => {
    // "Why can't I upgrade this" is a question the absence would leave unanswered.
    expect(menu).toContain("disabled:opacity-50");
    expect(menu).toContain("item.disabledReason");
  });

  it("renders nothing when there is nothing to do", () => {
    expect(menu).toMatch(/items\.length === 0 && toggle === undefined\) return null/);
  });

  it("puts the update dot on the trigger's own corner, not the menu's", () => {
    // Regression guard: the row-level dot must not leak back into the trigger's markup.
    const trigger = menu.slice(menu.indexOf("<button"), menu.indexOf("</button>"));
    expect(trigger).not.toContain("UPDATE_DOT_INLINE");
  });
});

describe("both library tabs use it", () => {
  it.each([
    ["plugin card", pluginsPage],
    ["skill card", skillsTab],
  ])("%s folds its commands into the menu", (_label, file) => {
    expect(file).toContain("<CardActionsMenu");
    // The five commands, in the same order as before — the two tabs are meant to read as one page.
    expect(file).toContain('key: "upgrade"');
    expect(file).toContain('key: "invoke"');
    expect(file).toContain('key: "install"');
    expect(file).toContain('key: "delete"');
  });

  it("the skill card routes every command to a real handler", () => {
    // The failure this guards: a command drawn on a card that does nothing. Folding five
    // controls into a menu item is exactly the change that could quietly detach one.
    expect(skillsTab).toContain("void upgradeSkill(machineSkill)");
    expect(skillsTab).toContain("onQuickInvoke(quickInvokeSkill.name)");
    expect(skillsTab).toContain("onManageInstall(skill.name)");
    expect(skillsTab).toContain("void switchOff(skill)");
    expect(skillsTab).toContain("void onDeleteSkill(skill.name)");
  });

  it("the plugin card routes every command to a real handler", () => {
    expect(pluginsPage).toContain("setPendingUpdate(outdated)");
    expect(pluginsPage).toContain("onQuickInvoke(quickStartSkill.name)");
    expect(pluginsPage).toContain("setInstallOpen(true)");
    expect(pluginsPage).toContain("confirmMachineDelete");
  });

  it("neither tab still draws its own row of icon buttons", () => {
    // The five-glyph strip is what this change removed; leaving one behind on either tab would
    // put two action systems on one page.
    for (const file of [pluginsPage, skillsTab]) {
      const cards = file.slice(file.indexOf("<LibraryCard"));
      expect(cards).not.toMatch(/h-7 w-7 shrink-0 justify-center p-0/);
    }
  });
});
