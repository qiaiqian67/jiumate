/**
 * Pure helpers for the AI companion banner (features/chat/companion-banner-helpers.ts).
 *
 * Both helpers must be unit-testable without rendering React: the banner itself sits on
 * top of `useCompanionStore` + `useSessionStream` + the DOM, none of which a fast unit
 * test wants. The helpers live in a sibling module for exactly this reason.
 *
 * The `detectLang` tests stub `localStorage` and `navigator.language` so the function's
 * precedence order (storage key → navigator.language → en) is exercised end to end.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { pickReaction, detectLang } from "../src/features/chat/companion-banner-helpers";

describe("pickReaction", () => {
  it("cycles deterministically through the Chinese pool", () => {
    expect(pickReaction(0, "zh")).toBe("嗯嗯");
    expect(pickReaction(1, "zh")).toBe("辛苦了");
    expect(pickReaction(2, "zh")).toBe("继续加油");
    expect(pickReaction(3, "zh")).toBe("收到");
    expect(pickReaction(4, "zh")).toBe("🫶");
  });

  it("cycles deterministically through the English pool", () => {
    expect(pickReaction(0, "en")).toBe("mm-hm");
    expect(pickReaction(1, "en")).toBe("you got this");
    expect(pickReaction(2, "en")).toBe("noted");
    expect(pickReaction(3, "en")).toBe("✨");
    expect(pickReaction(4, "en")).toBe("🫶");
  });

  it("wraps past the end of the pool without throwing", () => {
    // 5 wraps to 0 in a 5-bucket pool — the same pick as seed 0; 10 likewise wraps twice.
    expect(pickReaction(5, "zh")).toBe(pickReaction(0, "zh"));
    expect(pickReaction(10, "en")).toBe(pickReaction(0, "en"));
  });

  it("is stable across calls with the same seed (no Date.now / Math.random)", () => {
    expect(pickReaction(2, "zh")).toBe(pickReaction(2, "zh"));
    expect(pickReaction(2, "en")).toBe(pickReaction(2, "en"));
  });
});

describe("detectLang", () => {
  const originalLS = globalThis.localStorage;
  const originalNav = globalThis.navigator;

  afterEach(() => {
    // Restore the originals — vitest replaces `localStorage` / `navigator` per stub, and
    // a leaked stub would bleed into other files in the same run.
    Object.defineProperty(globalThis, "localStorage", {
      value: originalLS,
      configurable: true,
    });
    Object.defineProperty(globalThis, "navigator", {
      value: originalNav,
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  it("returns the stored value when localStorage holds a recognized code", () => {
    Object.defineProperty(globalThis, "localStorage", {
      value: { getItem: () => "zh" },
      configurable: true,
    });
    expect(detectLang()).toBe("zh");
  });

  it("ignores an unrecognized stored value and falls through to the navigator", () => {
    Object.defineProperty(globalThis, "localStorage", {
      value: { getItem: () => "ja" },
      configurable: true,
    });
    Object.defineProperty(globalThis, "navigator", {
      value: { language: "zh-CN" },
      configurable: true,
    });
    expect(detectLang()).toBe("zh");
  });

  it("falls back to en when neither localStorage nor navigator hints Chinese", () => {
    Object.defineProperty(globalThis, "localStorage", {
      value: { getItem: () => null },
      configurable: true,
    });
    Object.defineProperty(globalThis, "navigator", {
      value: { language: "en-US" },
      configurable: true,
    });
    expect(detectLang()).toBe("en");
  });
});
