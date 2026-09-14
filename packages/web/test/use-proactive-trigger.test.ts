/**
 * Proactive-trigger hook — pure threshold helper + companion-section slider snap.
 *
 * L.2 ships only the trigger skeleton: the React hook attaches document listeners
 * and re-evaluates on a tick, both of which need a DOM. What we CAN pin in
 * node-only vitest is the pure threshold predicate (`isProactiveArmedForTest`) and
 * the slider-snap helper in the settings page. Together they define the entire
 * contract the consumer cares about: given an idle ms and a threshold, is the
 * pet allowed to speak? Given a stored ms, where does the slider land?
 */
import { describe, expect, it } from "vitest";
import { isProactiveArmedForTest } from "../src/features/chat/use-proactive-trigger";
import { snapProactiveTimeoutMsForTest } from "../src/features/settings/companion-section";

describe("isProactiveArmedForTest", () => {
  it("never arms when the threshold is 0 (the 'off' slider stop)", () => {
    // A user who drags the slider to Off expects zero proactive behaviour even
    // after hours of inactivity — the hook must not silently ignore the setting.
    expect(isProactiveArmedForTest(0, 0)).toBe(false);
    expect(isProactiveArmedForTest(60_000, 0)).toBe(false);
    expect(isProactiveArmedForTest(Number.POSITIVE_INFINITY, 0)).toBe(false);
  });

  it("never arms for any non-positive threshold", () => {
    // Defensive: the same `threshold <= 0` check the hook itself performs, in
    // case the threshold is somehow NaN or negative. The hook also refuses to
    // mount listeners in that case, but the helper is callable directly.
    expect(isProactiveArmedForTest(60_000, -1)).toBe(false);
    expect(isProactiveArmedForTest(60_000, Number.NaN)).toBe(false);
  });

  it("arms exactly once idle crosses the threshold", () => {
    const threshold = 5_000;
    expect(isProactiveArmedForTest(0, threshold)).toBe(false);
    expect(isProactiveArmedForTest(threshold - 1, threshold)).toBe(false);
    expect(isProactiveArmedForTest(threshold, threshold)).toBe(true);
    expect(isProactiveArmedForTest(threshold * 100, threshold)).toBe(true);
  });
});

describe("snapProactiveTimeoutMsForTest", () => {
  it("clamps any non-positive input to 0 (the 'Off' stop)", () => {
    expect(snapProactiveTimeoutMsForTest(0)).toBe(0);
    expect(snapProactiveTimeoutMsForTest(-30_000)).toBe(0);
    expect(snapProactiveTimeoutMsForTest(Number.NaN)).toBe(0);
    expect(snapProactiveTimeoutMsForTest(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("snaps an exact stop's ms to itself", () => {
    // Round-trip: a value the store could have written is unchanged on hydrate.
    for (const ms of [0, 60_000, 300_000, 900_000, 1_800_000, 3_600_000]) {
      expect(snapProactiveTimeoutMsForTest(ms)).toBe(ms);
    }
  });

  it("snaps an off-stop value to the nearest stop", () => {
    // 100_000 ms (1m 40s) is between 1 min and 5 min; closer to 1 min, so 60_000.
    expect(snapProactiveTimeoutMsForTest(100_000)).toBe(60_000);
    // 600_000 ms (10 min) is exactly between 5 min and 15 min; 5 min comes first
    // because the loop keeps the first equal diff it sees, which is the existing
    // 5-min stop. Pin that behaviour so a future refactor doesn't silently flip
    // a stored value to 15 min.
    expect(snapProactiveTimeoutMsForTest(600_000)).toBe(300_000);
  });
});
