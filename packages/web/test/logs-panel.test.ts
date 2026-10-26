/**
 * The System settings 日志 page's error table and its clear action.
 *
 * Two properties a type checker cannot see. The action is offered only where it can succeed —
 * the route is owner-only, so showing it to a member would be an affordance whose only outcome
 * is a 403 — and only while there are rows to take.
 *
 * The other is the confirmation's wording, which is the whole safety mechanism here: the delete
 * is scoped to the range on screen, so a dialog that named the Project's whole history, or only
 * the visible page, would send someone into an irreversible action describing the wrong set.
 * That sentence is a pure function for exactly this reason — this package's vitest runs in
 * `node`, deliberately, so an opened dialog is not something a test can read.
 *
 * The 全部 preset is the case worth the most care: it has no dates to name, so the sentence has
 * to say "all" outright rather than interpolate two empty strings into a range.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { UsageErrorItem, UsageErrors } from "@jiumate/server/api";
import {
  LogsPanel,
  clearableFilter,
  logsClearScopeText,
} from "../src/features/settings/logs-panel";
import type { LogsFilters } from "../src/features/settings/logs-panel";
import { S, setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

afterEach(() => setActiveStrings(zh));

const item = (code: string): UsageErrorItem => ({
  ts: "2026-08-27T10:00:00.000Z",
  source: "http",
  code,
  kind: "unexpected",
  message: `${code} went wrong`,
});

function errorsOf(items: UsageErrorItem[], clearable = items.length): UsageErrors {
  return {
    total: items.length,
    clearable,
    unexpected: items.length,
    topCode: null,
    recent: items,
  };
}

const FILTERS: LogsFilters = { from: "2026-08-01", to: "2026-08-27" };
/** The 全部 preset: no bounds at all, which the route reads as unbounded. */
const ALL_TIME: LogsFilters = {};

function render(
  opts: {
    items?: UsageErrorItem[];
    clearable?: number;
    canClear?: boolean;
    filters?: LogsFilters;
  } = {},
): string {
  const items = opts.items ?? [item("internal")];
  return renderToStaticMarkup(
    createElement(LogsPanel, {
      errors: errorsOf(items, opts.clearable ?? items.length),
      projectId: "p1",
      filters: opts.filters ?? FILTERS,
      canClear: opts.canClear ?? true,
      onCleared: () => {},
    }),
  );
}

describe("LogsPanel clear action", () => {
  it("is offered to the Project owner only", () => {
    expect(render({ canClear: true })).toContain(S.logs.clear);
    // A member reads the panel; the route refuses the delete, so the button is not there to
    // promise otherwise.
    expect(render({ canClear: false })).not.toContain(S.logs.clear);
  });

  it("is absent while the filtered table is empty", () => {
    const empty = render({ items: [] });
    expect(empty).toContain(S.logs.empty);
    expect(empty).not.toContain(S.logs.clear);
  });

  it("is absent when every row in range is one no Project-scoped clear can take", () => {
    // An admin's read includes unattributed rows (a login failure, a process crash); the delete
    // never does. A window holding only those has rows on screen and nothing to clear, so the
    // action must not be offered — it could only report "deleted 0".
    expect(render({ items: [item("uncaught_exception")], clearable: 0 })).not.toContain(
      S.logs.clear,
    );
  });

  it("is absent while a range is half-filled: the sentence could not describe that delete", () => {
    // One bound with the other missing sends no bound on that side, which the route reads as
    // unbounded — wider than anything the confirmation's "records outside that range are kept"
    // can promise.
    expect(render({ filters: { from: "", to: "2026-08-27" } })).not.toContain(S.logs.clear);
    expect(render({ filters: { from: "2026-08-01" } })).not.toContain(S.logs.clear);
  });

  it("is offered for 全部, which has no bounds but is a deliberate whole-history delete", () => {
    // The one unbounded case that IS offered: the sentence names it outright (see the scope
    // test below), so the reader is told exactly what goes rather than shown an empty range.
    expect(render({ filters: ALL_TIME })).toContain(S.logs.clear);
  });

  it("keeps the pager independent of it: rows but one page shows the action alone", () => {
    const onePage = render({ items: [item("internal")] });
    expect(onePage).toContain(S.logs.clear);
    expect(onePage).not.toContain(S.logs.older);
  });
});

describe("clearableFilter", () => {
  it("accepts both bounds and neither, and rejects exactly one", () => {
    expect(clearableFilter(FILTERS)).toBe(true);
    expect(clearableFilter(ALL_TIME)).toBe(true);
    expect(clearableFilter({ from: "2026-08-01" })).toBe(false);
    expect(clearableFilter({ to: "2026-08-27" })).toBe(false);
    expect(clearableFilter({ from: "", to: "" })).toBe(true);
  });

  it("ignores the Agent filter: it narrows the set but never unbounds the range", () => {
    // The Agent is a second narrowing, not a substitute for one — a half-filled range stays
    // unclearable however the Agent is set.
    expect(clearableFilter({ ...FILTERS, agentId: "agent-7" })).toBe(true);
    expect(clearableFilter({ agentId: "agent-7" })).toBe(true);
    expect(clearableFilter({ from: "2026-08-01", agentId: "agent-7" })).toBe(false);
  });
});

describe("logsClearScopeText", () => {
  for (const [locale, dict] of Object.entries({ zh, en })) {
    it(`${locale}: names the date range`, () => {
      setActiveStrings(dict);
      const ranged = logsClearScopeText(FILTERS, 12);
      expect(ranged).toContain("2026-08-01");
      expect(ranged).toContain("2026-08-27");
      expect(ranged).toContain("12");
      // No Agent filter: the sentence must not claim one, or it describes a narrower delete than
      // the one about to run.
      expect(ranged).not.toContain("agent-7");
    });

    it(`${locale}: names the Agent when one is selected`, () => {
      setActiveStrings(dict);
      const perAgent = logsClearScopeText({ ...FILTERS, agentId: "agent-7" }, 3);
      expect(perAgent).toContain("agent-7");
      expect(perAgent).toContain("2026-08-01");
      expect(perAgent).toContain("3");
    });

    it(`${locale}: 全部 says "all" instead of printing an empty range`, () => {
      setActiveStrings(dict);
      const all = logsClearScopeText(ALL_TIME, 40);
      expect(all).toContain("40");
      // The failure this guards: a range sentence with two blanks where the dates belong.
      expect(all).not.toContain("  ");
      expect(all).not.toContain("–");
      // And with no Agent selected it must not name one.
      expect(all).not.toContain("agent-7");
    });

    it(`${locale}: 全部 plus an Agent names the Agent and still no range`, () => {
      setActiveStrings(dict);
      const both = logsClearScopeText({ agentId: "agent-7" }, 9);
      expect(both).toContain("agent-7");
      expect(both).toContain("9");
      expect(both).not.toContain("  ");
    });
  }

  it("distinguishes 全部 from a real range rather than merely omitting dates", () => {
    expect(logsClearScopeText(ALL_TIME, 7)).not.toBe(logsClearScopeText(FILTERS, 7));
  });

  it("distinguishes the two 全部 shapes: with an Agent and without", () => {
    expect(logsClearScopeText({ agentId: "agent-7" }, 7)).not.toBe(logsClearScopeText(ALL_TIME, 7));
  });

  it("an empty agentId is no filter at all (the page's own spelling of 'all agents')", () => {
    expect(logsClearScopeText({ ...FILTERS, agentId: "" }, 4)).toBe(logsClearScopeText(FILTERS, 4));
  });
});
