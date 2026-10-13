/**
 * The agents list is a browseable grid, and browsing it must not cost any function.
 *
 * **The list went from one column to three**, with a rotating featured strip and a category row
 * above it. Every control that existed before still exists: new chat, settings, usage, delete, and
 * the create dialog. A layout change is exactly the kind of edit where a control quietly falls off
 * a card — the row was rebuilt, not restyled — so the controls are asserted by name rather than
 * left to a screenshot.
 *
 * Search and chips narrow the **grid only**, never the featured strip: the strip is a sampler of
 * the Project, and a panel advertising Agents the grid is currently hiding is worse than no panel.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const src = (...parts: string[]): string =>
  fs.readFileSync(path.join(__dirname, "..", "src", ...parts), "utf8");

const page = src("features", "agents", "agents-page.tsx");
const zh = src("lib", "strings.ts");
const en = src("lib", "strings-en.ts");

describe("the grid", () => {
  it("is three columns on a wide screen and one on a phone", () => {
    // The class list is what Tailwind reads, and a typo in it silently drops the rule instead of
    // failing — `lg:grid-cols3` (no hyphen) shipped once and cost the third column entirely.
    expect(page).toContain("grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 auto-rows-fr");
    expect(page).not.toMatch(/grid-cols\d(?![-\w])/);
  });

  it("keeps rows level without measuring anything", () => {
    // `auto-rows-fr` is what stops a long description on one card leaving ragged bottoms beside it.
    expect(page).toContain(
      'className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 auto-rows-fr"',
    );
  });

  it("iterates the filtered list, not the raw one", () => {
    expect(page).toContain("visibleAgents.map");
    expect(page).toMatch(/const visibleAgents = agents\.filter\(/);
  });
});

describe("search and chips", () => {
  it("searches name, id and description", () => {
    // id and description matter as much as the display name: an Agent is referenced by its id in
    // configs and commands, and the description is where two similarly-named Agents differ.
    expect(page).toContain("agentDisplayName(a).toLowerCase().includes(q)");
    expect(page).toContain("a.agentId.toLowerCase().includes(q)");
    expect(page).toContain('(a.description ?? "").toLowerCase().includes(q)');
  });

  it('distinguishes "no match" from "no Agents"', () => {
    // Saying 全部 when the Project has Agents but the search excludes them reads as the Project
    // having lost them, which is a very different thing from an empty Project.
    expect(page).toContain("agents.length === 0");
    expect(page).toContain("visibleAgents.length === 0");
    expect(page).toContain("S.agent.noMatch");
  });

  it("derives chips from the Agents' own ids rather than a fixed taxonomy", () => {
    // `AgentSummary` has no category field, so a hardcoded chip list would be a second source of
    // truth that drifts from the data it filters. The prefix before the colon is the only grouping
    // the data actually offers.
    expect(page).toMatch(/const colon = a\.agentId\.indexOf\(":"\)/);
    expect(page).not.toMatch(/CATEGORY_(ALL|LIST)\s*=\s*\[/);
  });

  it("keeps the featured strip drawing from the whole Project", () => {
    // Deliberate: the strip is a sampler, and it must not advertise something the grid is hiding.
    expect(page).toMatch(
      /const featureAgent = agents\.length === 0[\s\S]{0,120}agents\[featureIndex/,
    );
  });
});

describe("nothing was lost in the rebuild", () => {
  it("still carries every per-Agent action", () => {
    // The row was rebuilt, not restyled, so each of these could have fallen off a card silently.
    expect(page).toContain("onClick={() => newChat(a.agentId)}");
    expect(page).toMatch(/navigate\(`\/agents\/\$\{a\.agentId\}`\)/);
    expect(page).toContain("/usage?agentId=${encodeURIComponent(a.agentId)}");
    expect(page).toContain("setDeleting({ agentId: a.agentId");
  });

  it("still deep-links the stat counts to their settings tabs", () => {
    for (const tab of ["tools", "skills", "hooks"]) {
      expect(page).toContain(`openSettingsTab(a.agentId, "${tab}")`);
    }
  });

  it("still refuses to offer delete for a built-in Agent", () => {
    expect(page).toContain("BUILTIN_AGENT_IDS.has(a.agentId)");
    expect(page).toContain("S.agent.builtinUndeletable");
  });

  it("still shows the kernel-update pill", () => {
    expect(page).toContain("a.kernelOutdated");
  });
});

describe("the featured strip", () => {
  it("does not offer arrows when there is nowhere to go", () => {
    // A pair of controls that cannot move is a dead affordance; with one Agent the strip stays a
    // single panel. Scoped to the slice *after* the guard, because the chevron paths are also
    // declared near the top of the file — a whole-file indexOf would find the declaration and pass
    // even if the arrows had been deleted from the component.
    const guard = page.indexOf("{agents.length > 1 && (");
    expect(guard).toBeGreaterThan(-1);
    const arrows = page.slice(guard, guard + 2000);
    expect(arrows).toContain("CHEVRON_LEFT_ICON");
    expect(arrows).toContain("CHEVRON_RIGHT_ICON");
    expect(arrows).toContain("S.common.previous");
    expect(arrows).toContain("S.common.next");
  });

  it("rotates, and stops when the page unmounts", () => {
    expect(page).toContain("FEATURE_ROTATE_MS");
    expect(page).toContain("window.clearInterval(timer)");
  });

  it("cannot index past the end of a list that shrank", () => {
    // A rotation loop that kept running after a delete would index into nothing and blank the panel.
    expect(page).toContain("agents[featureIndex % agents.length]");
  });
});

describe("strings", () => {
  it("has every new key in both dictionaries", () => {
    // `Strings = typeof zh`, so the English catalog is structurally required to match — but only
    // at compile time, and only for keys someone remembered. Asserted here so a missing one is a
    // failing test rather than a blank control.
    for (const key of ["searchPlaceholder: ", "noMatch: "]) {
      expect(zh).toContain(key);
      expect(en).toContain(key);
    }
    for (const key of ["all: ", "previous: ", "next: "]) {
      expect(zh).toContain(key);
      expect(en).toContain(key);
    }
  });
});
