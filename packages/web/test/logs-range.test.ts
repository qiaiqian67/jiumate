/**
 * The 日志 page's range picker, as the API sees it.
 *
 * One rule here can mislead silently, and it is why this is a pure function: 全部 must send **no
 * bounds**. The route reads an absent bound as "unbounded", and the clear confirmation has a
 * sentence for exactly that case — but if the picker instead invented a wide pair of dates, the
 * confirmation would name two dates nobody chose, and the delete would be described as narrower
 * than it is. The other presets are calendar ranges, which must come back as a real ISO pair.
 */
import { describe, expect, it } from "vitest";
import { logsRange } from "../src/features/settings/logs-section";

/** A fixed local instant, so `today` and the trailing presets are both deterministic. */
const NOW = new Date(2026, 7, 27, 14, 30, 0);

describe("logsRange", () => {
  it("sends no bounds at all for 全部", () => {
    // Not `{ from: undefined, to: undefined }` — no keys, so nothing is serialized as a bound.
    expect(logsRange("all", NOW)).toEqual({});
    expect(Object.keys(logsRange("all", NOW))).toEqual([]);
  });

  it("spans the whole local day for 今天", () => {
    expect(logsRange("today", NOW)).toEqual({ from: "2026-08-27", to: "2026-08-27" });
  });

  it("counts 近 7 天 inclusive of today", () => {
    expect(logsRange("7d", NOW)).toEqual({ from: "2026-08-21", to: "2026-08-27" });
  });

  it("counts 近 30 天 inclusive of today", () => {
    expect(logsRange("30d", NOW)).toEqual({ from: "2026-07-29", to: "2026-08-27" });
  });

  it("never returns a half-filled range, which no preset can describe", () => {
    for (const preset of ["today", "7d", "30d", "all"] as const) {
      const range = logsRange(preset, NOW);
      expect(Boolean(range.from)).toBe(Boolean(range.to));
    }
  });
});
