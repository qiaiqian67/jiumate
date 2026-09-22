/**
 * The built-in catalog's own invariants.
 *
 * These are the checks the web app's `example-tasks.test.ts` used to make against the i18n
 * dictionaries, restated against the presets now that the copy lives here — plus the ones the
 * new shape needs (every case resolves to a category, every kind is one the badge can render).
 */
import { describe, expect, it } from "vitest";
import {
  BUILTIN_INSPIRATION_CASES,
  SEED_INSPIRATION_CATEGORIES,
  builtinInspirationCatalog,
} from "../src/presets.js";
import { CASE_KINDS, DESCRIPTION_LIMIT, TITLE_LIMIT } from "../src/constants.js";
import { coerceInspirationCaseInput } from "../src/io.js";

describe("built-in inspiration catalog", () => {
  it("gives every case both languages of every visible string", () => {
    for (const one of BUILTIN_INSPIRATION_CASES) {
      for (const [en, zh, what] of [
        [one.title, one.titleZh, "title"],
        [one.description, one.descriptionZh, "description"],
        [one.prompt, one.promptZh, "prompt"],
      ] as const) {
        expect(en.trim(), `${one.id} ${what} (en)`).not.toBe("");
        expect(zh.trim(), `${one.id} ${what} (zh)`).not.toBe("");
        // The prompt is the request; the description is only the card's one-line summary of it.
        expect(en.length, `${one.id} ${what} (en)`).toBeGreaterThan(0);
      }
      expect(one.title.length).toBeLessThanOrEqual(TITLE_LIMIT);
      expect(one.description.length).toBeLessThanOrEqual(DESCRIPTION_LIMIT);
      expect(one.prompt.length).toBeGreaterThan(one.description.length);
    }
  });

  it("gives every category both names, and every case a category that exists", () => {
    const ids = new Set(SEED_INSPIRATION_CATEGORIES.map((category) => category.id));
    expect(ids.size).toBe(SEED_INSPIRATION_CATEGORIES.length);
    for (const category of SEED_INSPIRATION_CATEGORIES) {
      expect(category.name).not.toBe("");
      expect(category.nameZh).not.toBe("");
    }
    for (const one of BUILTIN_INSPIRATION_CASES) {
      expect(ids.has(one.categoryId), `${one.id} -> ${one.categoryId}`).toBe(true);
    }
  });

  it("uses unique ids and kinds the card badge can render", () => {
    const ids = BUILTIN_INSPIRATION_CASES.map((one) => one.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const one of BUILTIN_INSPIRATION_CASES) {
      expect(CASE_KINDS).toContain(one.kind);
    }
  });

  // The draft screen's picker reserves no scroll area: its height is one row per category plus
  // the open category's rows, so a category much longer than its siblings is what would make
  // that height jump as the user switches between them.
  it("keeps the built-in categories within one row of each other", () => {
    const sizes = SEED_INSPIRATION_CATEGORIES.map(
      (category) =>
        BUILTIN_INSPIRATION_CASES.filter((one) => one.categoryId === category.id).length,
    );
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });

  it("features a non-empty subset, and never all of it", () => {
    const featured = BUILTIN_INSPIRATION_CASES.filter((one) => one.featured).length;
    expect(featured).toBeGreaterThan(0);
    expect(featured).toBeLessThan(BUILTIN_INSPIRATION_CASES.length);
  });

  it("passes its own coercion — the presets are valid cases, not just well-shaped literals", () => {
    for (const one of BUILTIN_INSPIRATION_CASES) {
      expect(() => coerceInspirationCaseInput(one, { expectedId: one.id })).not.toThrow();
    }
  });

  it("hands out a fresh copy every call", () => {
    const first = builtinInspirationCatalog();
    first.cases[0]!.title = "mutated";
    first.cases[0]!.skills.push("mutated");
    first.categories[0]!.name = "mutated";
    const second = builtinInspirationCatalog();
    expect(second.cases[0]!.title).not.toBe("mutated");
    expect(second.cases[0]!.skills).not.toContain("mutated");
    expect(second.categories[0]!.name).not.toBe("mutated");
    // Categories carry no provenance: the seed list is what a fresh library is seeded with, and
    // from then on every category is the admin's own file.
    expect(Object.keys(second.categories[0]!).sort()).toEqual(["id", "name", "nameZh", "order"]);
    expect(second.cases[0]!.source).toBe("builtin");
    expect(second.cases[0]!.packagePath).toBeNull();
  });

  it("keeps the agent-evolution pair pointing at the same benchmark", () => {
    const build = BUILTIN_INSPIRATION_CASES.find((one) => one.id === "agent-benchmark-build");
    const optimize = BUILTIN_INSPIRATION_CASES.find((one) => one.id === "agent-optimization");
    expect(build?.kind).toBe("agent");
    expect(optimize?.kind).toBe("agent");
    // Two sessions of one workflow: the optimizer names the benchmark the builder produced.
    for (const prompt of [build?.prompt, build?.promptZh, optimize?.prompt, optimize?.promptZh]) {
      expect(prompt).toContain("contextual-choice-adaptation");
    }
    for (const prompt of [build?.prompt, build?.promptZh, optimize?.prompt, optimize?.promptZh]) {
      expect(prompt).toContain("finite_choice_agent");
    }
    // Neither runs another agent, so neither may pin a skill.
    expect(build?.skills).toEqual([]);
    expect(optimize?.skills).toEqual([]);
  });

  it("keeps the not-advice framing on the investment example", () => {
    const one = BUILTIN_INSPIRATION_CASES.find(
      (candidate) => candidate.id === "investment-copilot",
    );
    expect(one?.prompt).toContain("not investment advice");
    expect(one?.promptZh).toContain("不是投资建议");
  });

  it("keeps the scheduled examples saying when they fire", () => {
    for (const [id, enMarker, zhMarker] of [
      ["daily-plan", "every day at 9am", "每天早上 9 点"],
      ["github-digest", "every morning", "每天早上"],
      ["memory-review", "every Friday evening", "每周五傍晚"],
    ] as const) {
      const one = BUILTIN_INSPIRATION_CASES.find((candidate) => candidate.id === id);
      expect(one?.prompt, id).toContain(enMarker);
      expect(one?.promptZh, id).toContain(zhMarker);
      // `period` is a fixed interval (30m / 12h / 7d), so cron syntax is always wrong.
      expect(one?.prompt, id).not.toContain("cron");
      expect(one?.promptZh, id).not.toContain("cron");
    }
  });
});
