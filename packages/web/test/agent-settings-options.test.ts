/**
 * agent-settings-page.ts optionRows unit tests: the runtime dropdowns build from the
 * dictionary's [value, description] pairs with the "" (inherit) row dropped and dictionary
 * order kept — pinned so a future reconciliation (e.g. with the no-none branch's option
 * assembly) cannot silently regress the filter.
 */
import { describe, expect, it } from "vitest";
import { optionRows } from "../src/features/agents/agent-settings-page";

const ENTRIES: ReadonlyArray<readonly [string, string]> = [
  ["", "Send no override."],
  ["low", "Low tier."],
  ["medium", "Medium tier."],
  ["high", "High tier."],
  ["xhigh", "Extra-high tier."],
  ["max", "Max tier."],
];

describe("optionRows", () => {
  it("drops the '' inherit row and keeps dictionary order", () => {
    const rows = optionRows(ENTRIES, {});
    expect(rows.map((r) => r.value)).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(rows.some((r) => r.value === "")).toBe(false);
  });

  it("falls back to the raw value on both labels when no name is known", () => {
    // The en dictionary ships an empty name table: the value is already its own English name.
    const rows = optionRows([["summarize", "Summarize old context."]], {});
    expect(rows[0]).toEqual({
      value: "summarize",
      triggerLabel: "summarize",
      label: "summarize",
      description: "Summarize old context.",
    });
  });

  it("localizes the trigger to the plain name and the row to the name plus wire value", () => {
    const rows = optionRows(
      [
        ["summarize", "Summarize old context."],
        ["discard", "Drop old context."],
      ],
      { summarize: "生成摘要", discard: "直接丢弃" },
    );
    expect(rows[0]).toEqual({
      value: "summarize",
      triggerLabel: "生成摘要",
      label: "生成摘要 (summarize)",
      description: "Summarize old context.",
    });
    expect(rows[1]).toMatchObject({ triggerLabel: "直接丢弃", label: "直接丢弃 (discard)" });
  });

  it("mixes named and unnamed rows without disturbing either", () => {
    const rows = optionRows(
      [
        ["summarize", "Summarize old context."],
        ["compact_hard", "Drop old context."],
      ],
      { summarize: "生成摘要" },
    );
    expect(rows.map((r) => r.triggerLabel)).toEqual(["生成摘要", "compact_hard"]);
    expect(rows.map((r) => r.label)).toEqual(["生成摘要 (summarize)", "compact_hard"]);
  });
});
