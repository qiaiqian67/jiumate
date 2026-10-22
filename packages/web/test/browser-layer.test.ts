/**
 * The browser's layer, and the three bugs that running the app found.
 *
 * Each of these was found by driving the real application, not by reading it: the app
 * started, a page was opened, and something did not happen. A test that cannot run the app
 * can still pin the rule each bug broke — the rule is what the code says, not the app.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_PARK_SIZE, placement, slotRect } from "../src/features/browser/browser-layer";

const read = (rel: string): string =>
  fs.readFileSync(path.join(__dirname, "..", "src", ...rel.split("/")), "utf8");

describe("where a page sits", () => {
  const slot = { left: 100, top: 200, width: 800, height: 600 };

  it("covers the slot the panel leaves, when it is the page on screen", () => {
    const { frame } = placement(slot, true, DEFAULT_PARK_SIZE);
    expect(frame).toEqual(slot);
  });

  it("parks the pages that are not on screen inside the viewport, not outside it", () => {
    // A guest entirely outside the viewport is never composited, and Chromium's
    // captureScreenshot on an uncomposited guest HANGS — the agent's screenshot timed out
    // on exactly this. Behind the app is far enough out of the user's way and still
    // composited.
    const { frame } = placement(null, false, DEFAULT_PARK_SIZE);
    expect(frame.left).toBeGreaterThanOrEqual(0);
    expect(frame.top).toBeGreaterThanOrEqual(0);
    expect(frame.width).toBe(DEFAULT_PARK_SIZE.width);
  });

  it("has no slot to follow when the panel is closed", () => {
    expect(slotRect(null)).toBeNull();
  });
});

describe("the layer's rules", () => {
  it("mounts every guest, and never moves one", () => {
    const runtime = read("features/browser/browser-runtime.tsx");
    // A guest that waits to be on screen before it is mounted never learns its id — the
    // element is what tells it — so it would never be on screen either. Every guest is
    // mounted, and the one on screen is moved by COORDINATES, not by re-parenting: a
    // <webview> that is moved in the DOM reloads its page.
    expect(runtime).toContain("createPortal");
    expect(runtime).toContain("placement(");
    // The portal's target is the layer, created once — not the panel's slot, which moves.
    expect(runtime).toContain("data-browser-layer");
  });

  it("parks a page behind the app, and shows it above it", () => {
    const runtime = read("features/browser/browser-runtime.tsx");
    // A parked page is behind the app (the user must not see it) and a shown one is above
    // it (it covers the dock slot). Both are in the viewport, so both are composited.
    expect(runtime).toContain("zIndex: shown ? 30 : -1");
  });

  it("names the guest's element by its id, so the shell can close and focus it", () => {
    const runtime = read("features/browser/browser-runtime.tsx");
    // The shell finds the element by `webview[data-guest-id="<id>"]` when it closes or
    // focuses the tab. Without the attribute the element was never removed, and the tab
    // stayed in the registry after the user closed it.
    expect(runtime).toContain('setAttribute("data-guest-id"');
  });

  it("the panel is a viewport, not the host", () => {
    const panel = read("features/browser/browser-panel.tsx");
    const runtime = read("features/browser/browser-runtime.tsx");
    expect(panel).not.toContain("<webview\n");
    expect(panel).not.toContain("<webview ");
    expect(runtime).toContain("<webview");
  });
});
