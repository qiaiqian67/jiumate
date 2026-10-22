/**
 * What an address means.
 *
 * Pure rules, so they are pinned here rather than rediscovered in a running app. Both the
 * user (typing in the address bar) and the agent (saying "open the dev server") go through
 * these, and the two must never disagree about what a string means.
 */
import { describe, expect, it } from "vitest";
import {
  BLANK_URL,
  addressOf,
  displayAddress,
  isBareHost,
  isBlankUrl,
  resolveAddress,
  tabLabel,
} from "../src/browser/address.js";

describe("an address that is an address", () => {
  it("takes a full URL as it was typed", () => {
    expect(addressOf("https://example.com/path?q=1")).toBe("https://example.com/path?q=1");
    expect(addressOf("http://example.com")).toBe("http://example.com/");
  });

  it("gives a bare host a scheme", () => {
    expect(addressOf("example.com")).toBe("https://example.com/");
    expect(addressOf("amazon.com/your-orders")).toBe("https://amazon.com/your-orders");
  });

  it("gives a local address plain http, because a dev server rarely speaks TLS", () => {
    expect(addressOf("localhost:3000")).toBe("http://localhost:3000/");
    expect(addressOf("127.0.0.1:8080")).toBe("http://127.0.0.1:8080/");
    expect(addressOf("192.168.1.1")).toBe("http://192.168.1.1/");
  });

  it("knows the empty page a new tab starts on", () => {
    expect(addressOf("about:blank")).toBe(BLANK_URL);
    expect(isBlankUrl(BLANK_URL)).toBe(true);
    expect(isBlankUrl("https://example.com")).toBe(false);
  });
});

describe("a string that is not an address", () => {
  it("is a search", () => {
    expect(addressOf("weather in Beijing")).toBeNull();
    expect(addressOf("how to cook rice")).toBeNull();
  });

  it("is a search when it is only a number", () => {
    // The alphabetic top-level label is what keeps `1.5` and `3.14` out of the addresses.
    expect(addressOf("3.14")).toBeNull();
    expect(addressOf("1.5")).toBeNull();
  });

  it("is a search when it names a scheme the browser may not show", () => {
    // `file:` and `javascript:` are not pages; a text that starts with one is a search.
    expect(addressOf("file:///etc/passwd")).toBeNull();
    expect(addressOf("javascript:alert(1)")).toBeNull();
  });

  it("is a search when it is a single word", () => {
    expect(addressOf("intranet")).toBeNull();
    expect(isBareHost("intranet")).toBe(false);
    expect(isBareHost("example.com")).toBe(true);
  });
});

describe("resolveAddress", () => {
  it("gives the address when the text is one", () => {
    expect(resolveAddress("example.com")).toBe("https://example.com/");
  });

  it("gives a search when it is not", () => {
    const resolved = resolveAddress("weather in Beijing");
    expect(resolved).toContain("bing.com/search?q=");
    expect(resolved).toContain(encodeURIComponent("weather in Beijing"));
  });
});

describe("how an address is shown", () => {
  it("drops the scheme and a leading www", () => {
    expect(displayAddress("https://www.example.com/")).toBe("example.com");
    expect(displayAddress("https://example.com/path")).toBe("example.com/path");
  });

  it("shows nothing for the empty page", () => {
    expect(displayAddress(BLANK_URL)).toBe("");
  });

  it("names a tab after its address until the page has a title", () => {
    expect(tabLabel("", "https://example.com/path")).toBe("example.com/path");
    expect(tabLabel("A Title", "https://example.com/path")).toBe("A Title");
  });
});
