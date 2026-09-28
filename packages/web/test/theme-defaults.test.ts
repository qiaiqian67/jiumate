/**
 * The two preference defaults a first visit lands on: font tier and display currency.
 *
 * Both are one-line fallbacks whose wrong answer is invisible in a screenshot — a UI that opens
 * at the middle font tier looks exactly like one that was supposed to, and a price in dollars
 * looks like a price. They are also the kind of change that does nothing for anyone who has
 * already used the app, because a stored choice wins: this decides what an *untouched* install
 * shows, which is precisely what a test can pin and a running browser cannot.
 *
 * vitest runs node-only (`environment: "node"`), which is why both take an injectable storage
 * rather than reaching for `localStorage` — the same shape as `initialNavGroupCollapsed`.
 */
import { describe, expect, it } from "vitest";
import { initialCurrency, initialFontScale } from "../src/state/theme";
import type { PreferenceStorage } from "../src/state/theme";

/** A store holding exactly these entries. */
const store = (entries: Record<string, string> = {}): PreferenceStorage => ({
  getItem: (key) => entries[key] ?? null,
});

describe("initialFontScale", () => {
  it("defaults to the smallest tier", () => {
    expect(initialFontScale(store())).toBe("sm");
  });

  it("keeps whichever tier was stored, including the old default", () => {
    // The point of the change is the *default*, not a migration: someone who picked 中 must stay
    // on 中, or this would silently resize the UI for every existing user.
    expect(initialFontScale(store({ "jiumate.fontScale": "sm" }))).toBe("sm");
    expect(initialFontScale(store({ "jiumate.fontScale": "md" }))).toBe("md");
    expect(initialFontScale(store({ "jiumate.fontScale": "lg" }))).toBe("lg");
  });

  it("ignores an unrecognized stored value rather than passing it through", () => {
    // An older build's tier, or a hand-edited key: the root font-size is set from this value, so
    // a string the lookup table has no entry for would render as an invalid font-size.
    expect(initialFontScale(store({ "jiumate.fontScale": "xl" }))).toBe("sm");
    expect(initialFontScale(store({ "jiumate.fontScale": "" }))).toBe("sm");
  });
});

describe("initialCurrency", () => {
  it("defaults to CNY", () => {
    expect(initialCurrency(store())).toBe("CNY");
  });

  it("keeps a stored choice either way", () => {
    expect(initialCurrency(store({ "jiumate.currency": "USD" }))).toBe("USD");
    expect(initialCurrency(store({ "jiumate.currency": "CNY" }))).toBe("CNY");
  });

  it("treats anything that is not the stored USD as the default", () => {
    // The read is "is USD the stored choice", not "is CNY": every other answer, including a value
    // this build does not know, has to land on the default rather than on a broken symbol.
    expect(initialCurrency(store({ "jiumate.currency": "EUR" }))).toBe("CNY");
    expect(initialCurrency(store({ "jiumate.currency": "" }))).toBe("CNY");
  });
});
