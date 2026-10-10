/**
 * The category filing store: which category each item is filed under, persisted per user.
 *
 * These are pure storage rules, so they are tested against a stubbed `localStorage` rather than a
 * DOM — the same decision the rest of `test/` makes (see vitest.config.ts).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadCategories, loadFilings, saveFilings, scopedId } from "../src/features/plugins/extension-state";

/** Minimal localStorage: the store is used synchronously and never enumerates keys. */
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});

describe("scopedId", () => {
  it("scopes a bundled item by its parent, so removing the parent orphans the child", () => {
    expect(scopedId("skill", "humanizer", "humanizer")).toBe("skill:humanizer/humanizer");
    expect(scopedId("skill", "mine")).toBe("skill:mine");
    // The plugin's own id does not collide with any of its skills' ids.
    expect(scopedId("plugin", "humanizer")).not.toBe(scopedId("skill", "humanizer", "humanizer"));
  });
});

describe("loadFilings", () => {
  it("round-trips through saveFilings", () => {
    const filings = {
      [scopedId("skill", "a")]: "user:common",
      [scopedId("skill", "b")]: null,
    };
    saveFilings("u1", filings);
    expect(loadFilings("u1")).toEqual(filings);
  });

  it("keeps two users apart, so a shared machine shows nobody else's taxonomy", () => {
    saveFilings("u1", { [scopedId("skill", "a")]: "user:common" });
    saveFilings("u2", {});
    expect(loadFilings("u2")).toEqual({});
    expect(loadFilings("u1")).toEqual({ [scopedId("skill", "a")]: "user:common" });
  });

  it("returns {} when nothing is stored, rather than throwing", () => {
    expect(loadFilings("nobody")).toEqual({});
  });

  it("drops a non-object file instead of letting malformed keys reach the UI", () => {
    for (const bad of ['"a string"', "[]", "null"]) {
      store.set("jiumate.ext.filings.u1", bad);
      expect(loadFilings("u1")).toEqual({});
    }
  });

  it("drops only the entries it cannot use, keeping the rest", () => {
    // One bad value in a hand-edited or older-version file must not cost every filing.
    store.set(
      "jiumate.ext.filings.u1",
      JSON.stringify({ "skill:a": "user:x", "skill:b": 42, "skill:c": null }),
    );
    expect(loadFilings("u1")).toEqual({ "skill:a": "user:x", "skill:c": null });
  });

  it("survives a store that throws, because persistence is never load-bearing", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("storage disabled");
      },
      setItem: () => {
        throw new Error("storage disabled");
      },
    });
    expect(loadFilings("u1")).toEqual({});
    expect(() => saveFilings("u1", {})).not.toThrow();
  });
});

describe("filings and categories are separate files", () => {
  it("renaming a category keeps its id, so the items filed under it stay filed", () => {
    // The point of storing a filing as an id rather than a label: a rename must not orphan anyone.
    saveFilings("u1", { "skill:a": "user:common" });
    const renamed = loadCategories("u1").map((c) =>
      c.id === "user:common" ? { ...c, name: "常用" } : c,
    );
    expect(loadFilings("u1")["skill:a"]).toBe("user:common");
    expect(renamed).toBeDefined();
  });
});