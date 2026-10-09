/**
 * The extension model and its storage (features/plugins/extension-model.ts,
 * extension-state.ts).
 *
 * Both files exist because three pages were about to grow their own slightly different answers
 * to the same questions, so these are the assertions that keep one surface's idea of "is this
 * built-in" from disagreeing with another's.
 *
 * The interesting cases are all about **not losing user intent**:
 *  - an explicit "off" must not resurrect when the plugin behind a bundled skill is reinstalled;
 *  - a category must survive being renamed (items filed under it keep their filing);
 *  - deleting a category must not delete the skills filed under it;
 *  - a bundled skill's switch must be scoped so two plugins shipping a same-named skill do not
 *    share one setting.
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  affectedAgents,
  canToggleIndependently,
  canUninstall,
  changeNeedsConfirming,
  filterMatches,
  filtersFor,
  matchesQuery,
  searchText,
  skillOrigin,
} from "../src/features/plugins/extension-model";
import {
  categoryIdFor,
  isOn,
  loadCategories,
  loadSwitches,
  removeCategory,
  renameCategory,
  scopedId,
  saveCategories,
  saveSwitches,
  withSwitch,
  withoutPlugin,
} from "../src/features/plugins/extension-state";

describe("skillOrigin", () => {
  it("reads a skill installed through a plugin as bundled", () => {
    // The server records the plugin name on install — that IS the bundled signal.
    expect(skillOrigin({ pluginName: "git-flow", origin: "library" })).toBe("bundled");
  });

  it("reads a library skill installed on its own as built-in", () => {
    expect(skillOrigin({ pluginName: null, origin: "library" })).toBe("builtin");
  });

  it("reads an imported file as the user's own", () => {
    expect(skillOrigin({ pluginName: null, origin: "import" })).toBe("user");
  });

  it("trusts the recorded plugin over the inferred origin", () => {
    // If the two ever disagree, the plugin name decides — it is what determines whether
    // uninstalling the plugin takes this skill with it.
    expect(skillOrigin({ pluginName: "p", origin: "import" })).toBe("bundled");
  });

  it("treats a skill with no signal as the user's, not as built-in", () => {
    // Defaulting the other way would show a user's own skill as un-removable product content.
    expect(skillOrigin({})).toBe("user");
  });
});

describe("filter tabs", () => {
  it("offers the bundled tab to skills only", () => {
    expect(filtersFor(true)).toEqual(["all", "builtin", "user", "bundled"]);
    expect(filtersFor(false)).toEqual(["all", "builtin", "user"]);
  });

  it("matches each origin to its own tab and to all", () => {
    expect(filterMatches("builtin", "all")).toBe(true);
    expect(filterMatches("builtin", "builtin")).toBe(true);
    expect(filterMatches("builtin", "user")).toBe(false);
    expect(filterMatches("bundled", "bundled")).toBe(true);
    // A bundled skill is NOT a user install: it cannot be removed on its own, and showing it
    // under 「用户安装」 with an uninstall button would be a lie.
    expect(filterMatches("bundled", "user")).toBe(false);
  });
});

describe("what a user may do to an item", () => {
  it("never lets a built-in be uninstalled", () => {
    expect(canUninstall("builtin")).toBe(false);
  });

  it("never lets a bundled skill be uninstalled on its own — the plugin takes it", () => {
    expect(canUninstall("bundled")).toBe(false);
    expect(canUninstall("user")).toBe(true);
  });

  it("lets anything but a built-in be switched independently", () => {
    expect(canToggleIndependently("bundled")).toBe(true);
    expect(canToggleIndependently("user")).toBe(true);
    expect(canToggleIndependently("builtin")).toBe(false);
  });
});

describe("search", () => {
  const item = {
    name: "frontend-audit",
    description: "Audit the frontend for accessibility regressions",
    shortDescription: "Accessibility sweep",
    shortDescriptionZh: "无障碍检查",
    category: "user:qa",
  };

  it("finds by name, case-insensitively", () => {
    expect(matchesQuery(item, "FRONTEND")).toBe(true);
  });

  it("finds by the Chinese short description", () => {
    // The whole point of including both languages: a Chinese user searching 「无障碍」 must not
    // come up empty against an English long description.
    expect(matchesQuery(item, "无障碍")).toBe(true);
  });

  it("finds by category, so clicking a tab and then typing works", () => {
    expect(matchesQuery(item, "user:qa")).toBe(true);
  });

  it("matches mid-word, not just prefixes", () => {
    // Skill names are long; a prefix-only search makes the middle unreachable.
    expect(matchesQuery(item, "audit")).toBe(true);
  });

  it("matches everything on an empty query, so it is never a dead end", () => {
    expect(matchesQuery(item, "   ")).toBe(true);
  });

  it("excludes nothing that is present — missing fields do not throw", () => {
    expect(matchesQuery({ name: "x" }, "x")).toBe(true);
    expect(searchText({ name: "x" })).toBe("x");
  });

  it("misses genuinely absent text", () => {
    expect(matchesQuery(item, "kubernetes")).toBe(false);
  });
});

describe("affectedAgents", () => {
  it("is empty when nobody has it installed", () => {
    expect(affectedAgents([])).toEqual([]);
    expect(affectedAgents(null)).toEqual([]);
  });

  it("lists every Agent holding it, sorted so the dialog does not reshuffle", () => {
    const out = affectedAgents(["bob", "alice"]);
    expect(out.map((a) => a.agentId)).toEqual(["alice", "bob"]);
    expect(out.every((a) => a.reason === "installed")).toBe(true);
  });

  it("adds Agents that only have it selected, without duplicating ones already listed", () => {
    const out = affectedAgents(["alice"], { selectedAgents: ["alice", "carol"] });
    expect(out.map((a) => a.agentId)).toEqual(["alice", "carol"]);
    // No duplicate row for an Agent that is both installed-with and has it selected.
    expect(out.filter((a) => a.agentId === "alice")).toHaveLength(1);
  });

  it("reports 「selected」 as the stronger reason", () => {
    // It is the one that means the Agent is actively pointing at this.
    const out = affectedAgents(["alice"], { selectedAgents: ["alice"] });
    expect(out.map((a) => a.reason)).toEqual(["selected"]);
  });

  it("attaches display names when the project supplies them", () => {
    const out = affectedAgents(["alice"], { displayNames: { alice: "前端审查" } });
    expect(out.map((a) => a.displayName)).toEqual(["前端审查"]);
  });

  it("does not invent a display name from the id", () => {
    expect(affectedAgents(["alice"]).map((a) => a.displayName)).toEqual([undefined]);
  });

  it("ignores empty ids rather than listing a blank Agent", () => {
    expect(affectedAgents(["", "alice"]).map((a) => a.agentId)).toEqual(["alice"]);
  });
});

describe("changeNeedsConfirming", () => {
  it("asks only when a real Agent is affected", () => {
    expect(changeNeedsConfirming([])).toBe(false);
    expect(changeNeedsConfirming(affectedAgents(["alice"]))).toBe(true);
  });
});

describe("switches", () => {
  it("defaults to on, so a brand-new item is usable", () => {
    expect(isOn({}, "plugin:x")).toBe(true);
  });

  it("stores an explicit off and reads it back", () => {
    const s = withSwitch({}, "plugin:x", false);
    expect(isOn(s, "plugin:x")).toBe(false);
  });

  it("stores 「on」 as an ABSENCE, so defaults are never pinned", () => {
    // This is what makes a reinstall come back on instead of inheriting a months-old "off".
    const off = withSwitch({}, "plugin:x", false);
    const back = withSwitch(off, "plugin:x", true);
    expect("plugin:x" in back).toBe(false);
    expect(isOn(back, "plugin:x")).toBe(true);
  });

  it("returns the same object when nothing changed, so React can skip a re-render", () => {
    const s = withSwitch({}, "plugin:x", false);
    expect(withSwitch(s, "plugin:x", false)).toBe(s);
    expect(withSwitch(s, "plugin:other", true)).toBe(s);
  });

  it("does not mutate the map it was given", () => {
    const s = withSwitch({}, "plugin:x", false);
    withSwitch(s, "plugin:y", false);
    expect(Object.keys(s)).toEqual(["plugin:x"]);
  });
});

describe("scopedId", () => {
  it("scopes a bundled skill by its plugin, so two same-named skills do not share a switch", () => {
    const a = scopedId("skill", "review", "plugin-a");
    const b = scopedId("skill", "review", "plugin-b");
    expect(a).not.toBe(b);
  });

  it("keeps a standalone item's id plain", () => {
    expect(scopedId("skill", "mine")).toBe("skill:mine");
  });

  it("does not treat an empty parent as a parent", () => {
    // A null/undefined parent is the standalone case; "" must not produce a dangling slash.
    expect(scopedId("skill", "mine", "")).toBe("skill:mine");
    expect(scopedId("skill", "mine", null)).toBe("skill:mine");
  });
});

describe("withoutPlugin", () => {
  it("drops the plugin's own switch and every bundled skill's, together", () => {
    // The rule the owner chose: a bundled skill may be switched independently, but its switch
    // does not outlive the plugin — so uninstalling clears both in one go.
    const s: Record<string, boolean> = {
      "plugin:git": false,
      "skill:git/review": false,
      "skill:git/ship": false,
      "skill:mine": false,
      "plugin:other": false,
    };
    const out = withoutPlugin(s, "git");
    expect(Object.keys(out).sort()).toEqual(["plugin:other", "skill:mine"]);
  });

  it("returns the same object when the plugin had no switches", () => {
    const s = { "plugin:other": false };
    expect(withoutPlugin(s, "git")).toBe(s);
  });

  it("does not confuse a plugin whose name prefixes another's", () => {
    const s = { "plugin:git": false, "plugin:github": false, "skill:github/x": false };
    const out = withoutPlugin(s, "git");
    expect("plugin:github" in out).toBe(true);
    expect("skill:github/x" in out).toBe(true);
  });
});

describe("categories", () => {
  it("derives a stable id from the name, so a rename keeps the filing", () => {
    expect(categoryIdFor("常用")).toBe(categoryIdFor(" 常用 "));
    expect(categoryIdFor("QA Tools")).toBe(categoryIdFor("qa tools"));
  });

  it("keeps the id when renaming, so items stay filed under it", () => {
    const cats = [{ id: "user:qa", name: "QA" }];
    const out = renameCategory(cats, "user:qa", "质量");
    // The id is the filing key; the label is what changes. Both asserted, because a rename that
    // regenerated the id would silently unfile every skill under it.
    expect(out.map((c) => c.id)).toEqual(["user:qa"]);
    expect(out.map((c) => c.name)).toEqual(["质量"]);
  });

  it("gives a punctuation-only name a usable id rather than an empty one", () => {
    const id = categoryIdFor("///");
    expect(id).not.toBe("");
    expect(id).not.toBe(categoryIdFor("???"));
  });

  it("removes a user category and reports the items left orphaned by it", () => {
    const cats = [
      { id: "user:qa", name: "QA" },
      { id: "user:dev", name: "Dev" },
    ];
    const filed = { "skill:a": "user:qa", "skill:b": "user:qa", "skill:c": "user:dev" };
    const out = removeCategory(cats, "user:qa", filed);
    expect(out.categories.map((c) => c.id)).toEqual(["user:dev"]);
    expect(out.orphaned.sort()).toEqual(["skill:a", "skill:b"]);
  });

  it("refuses to delete a built-in category, keeping the plugins filed under it usable", () => {
    const cats = [{ id: "builtin:tools", name: "工具", builtin: true }];
    const out = removeCategory(cats, "builtin:tools", { "skill:a": "builtin:tools" });
    expect(out.refused).toBe(true);
    expect(out.categories).toHaveLength(1);
    expect(out.orphaned).toEqual([]);
  });
});

describe("storage reads tolerate bad data", () => {
  // This suite runs in the node environment on purpose (vitest.config.ts: pure logic, no DOM
  // tests), so localStorage is stubbed rather than pulling in jsdom for three assertions. The
  // stub is deliberately dumb — it cannot simulate a throwing store, which is fine because the
  // behaviour under test here is parsing, not the try/catch around the store itself.
  let store: Record<string, string>;
  beforeEach(() => {
    store = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).localStorage = {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
    };
  });

  it("falls back to empty rather than throwing on a corrupt file", () => {
    // Storage can be disabled outright (Safari private mode) and files can be hand-edited; a
    // page that cannot read its switches must still render.
    localStorage.setItem("jiumate.ext.state", "{not json");
    expect(loadSwitches("u1")).toEqual({});
    localStorage.setItem("jiumate.ext.categories", '"a string"');
    expect(loadCategories("u1")).toEqual([]);
  });

  it("drops malformed category entries but keeps the good ones", () => {
    localStorage.setItem(
      "jiumate.ext.categories.u1",
      JSON.stringify([{ id: "user:a", name: "A" }, { id: 5 }, null, { name: "no id" }]),
    );
    expect(loadCategories("u1")).toEqual([{ id: "user:a", name: "A" }]);
  });

  it("keeps two accounts' switches apart", () => {
    // A shared machine otherwise shows the previous account's choices, which looks exactly like
    // the app having remembered the wrong thing.
    localStorage.setItem("jiumate.ext.state.u1", JSON.stringify({ "plugin:x": false }));
    localStorage.setItem("jiumate.ext.state.u2", JSON.stringify({}));
    expect(isOn(loadSwitches("u1"), "plugin:x")).toBe(false);
    expect(isOn(loadSwitches("u2"), "plugin:x")).toBe(true);
  });

  it("round-trips a saved map, which is the only reason the store exists", () => {
    const switches = withSwitch({}, "plugin:x", false);
    saveSwitches("u1", switches);
    expect(loadSwitches("u1")).toEqual(switches);
  });

  it("round-trips categories", () => {
    const cats = [{ id: "user:qa", name: "质量" }];
    saveCategories("u1", cats);
    expect(loadCategories("u1")).toEqual(cats);
  });

  it("does not throw when the store refuses the write", () => {
    // Safari private mode throws on setItem; losing a switch on reload beats a render that dies.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).localStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(() => saveSwitches("u1", { a: false })).not.toThrow();
    expect(() => saveCategories("u1", [])).not.toThrow();
  });
});
