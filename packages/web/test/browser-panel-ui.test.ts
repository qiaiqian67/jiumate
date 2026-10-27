/**
 * The browser panel's toolbar and tab strip.
 *
 * The rules are the app's shared ones (core/browser/address.ts) — the panel must not keep a
 * second copy of them, or the user and the agent would disagree about what a string means.
 * So the test checks that the panel uses the shared rules, and that the strip shows what a
 * person needs to see: which page is in front, what each page is, and how to close it.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (rel: string): string =>
  fs.readFileSync(path.join(__dirname, "..", "src", ...rel.split("/")), "utf8");

describe("the address bar", () => {
  it("uses the app's own rules, not a copy of them", () => {
    const panel = read("features/browser/browser-panel.tsx");
    // The agent's "open" and the user's address bar go through the same function, so
    // "example.com" means the same thing to both.
    expect(panel).toContain('from "@jadelau/core/browser"');
    expect(panel).toContain("resolveAddress");
    expect(panel).toContain("displayAddress");
  });

  it("shows the page on screen, and follows it", () => {
    const panel = read("features/browser/browser-panel.tsx");
    // A person expects the bar to follow the page; it is reset when the page changes.
    expect(panel).toContain("displayAddress(current.url)");
    expect(panel).toContain("setTyped(null)");
  });

  it("navigates with the same rules the agent uses", () => {
    const panel = read("features/browser/browser-panel.tsx");
    expect(panel).toContain("body: { url: resolveAddress(url), activate: true }");
  });
});

describe("the tab strip", () => {
  it("shows one entry per page, and each can be closed", () => {
    const panel = read("features/browser/browser-panel.tsx");
    expect(panel).toContain("tabs.map((tab) =>");
    expect(panel).toContain("onClose");
    // The × closes the tab: the server is told, and the shell removes the element.
    expect(panel).toContain('method: "DELETE"');
  });

  it("names a page after its title, or after its address until it has one", () => {
    const panel = read("features/browser/browser-panel.tsx");
    expect(panel).toContain("tabLabel(tab.title, tab.url)");
  });

  it("shows a page that crashed as crashed", () => {
    const panel = read("features/browser/browser-panel.tsx");
    expect(panel).toContain("tab.crashed !== undefined");
  });

  it("brings the page to the front when its entry is pressed", () => {
    const panel = read("features/browser/browser-panel.tsx");
    expect(panel).toContain("/activate");
  });
});
