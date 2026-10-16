/**
 * nav-manifest.ts unit tests: the sidebar's page-nav manifest, its labels, its glyphs and
 * its routes.
 *
 * The collapse API that used to live here (a persisted `navCollapsed` preference, the
 * chevron toggle's two localized names, the storage round-trip) is gone along with the toggle
 * button — the nav group is simply always expanded now. The last test pins that absence, so
 * a future edit cannot quietly restore a preference that nothing renders.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  NAV_GROUP_KEYS,
  NAV_ROUTES,
  NAV_UNLISTED_PAGE_KEYS,
  navKeysFor,
} from "../src/lib/nav-manifest";
import { NAV_ICONS } from "../src/components/ui/icons";
import { zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

const src = (p: string) =>
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), p), "utf8");

describe("NAV_GROUP_KEYS", () => {
  it("covers exactly the 智能体 → 词元 range, in rendered order", () => {
    // Traces is deliberately absent: the Trace panel moved into the chat toolbar's panel
    // switcher (features/dock), and /traces stays reachable through its deep links only.
    expect([...NAV_GROUP_KEYS]).toEqual(["agents", "plugins", "appCenter", "usage"]);
    // Pin the endpoints by label: a manifest edit that shifts the range shows up here.
    expect(zh.nav[NAV_GROUP_KEYS[0]]).toBe("智能体");
    expect(zh.nav[NAV_GROUP_KEYS[NAV_GROUP_KEYS.length - 1]!]).toBe("词元");
  });

  it("keeps the pages that moved out of the nav routed, so nothing is unreachable", () => {
    // Models moved into System settings and the Evaluation Center lost its entry; both keep
    // their route and page. Asserting membership here is what stops a future edit from
    // deleting the route along with the row.
    expect([...NAV_UNLISTED_PAGE_KEYS]).toEqual(["models", "machines", "benchmark"]);
    for (const key of NAV_UNLISTED_PAGE_KEYS) {
      expect(NAV_GROUP_KEYS as readonly string[]).not.toContain(key);
      expect(NAV_ROUTES[key]).toMatch(/^\/[a-z-]+$/);
      expect(zh.nav[key]).toBeTruthy();
    }
  });

  it("every entry has a zh label, an en label, and a nav icon (the sidebar renders straight off the manifest)", () => {
    for (const key of NAV_GROUP_KEYS) {
      expect(zh.nav[key]).toBeTruthy();
      expect(en.nav[key]).toBeTruthy();
      expect(NAV_ICONS[key]).toBeTruthy();
    }
  });

  it("the pinned New session entry is not in the group, so the group governs only nav rows", () => {
    // The "New session" block (S.chat.newSessionMenu, 「新会话」) renders above the nav as its
    // own pinned row — the manifest never governs it.
    expect(NAV_GROUP_KEYS as readonly string[]).not.toContain("newChat");
    expect(NAV_GROUP_KEYS as readonly string[]).not.toContain("chat");
    expect(zh.chat.newSessionMenu).toBeTruthy();
  });
});

describe("navKeysFor", () => {
  it("is the whole manifest — no entry is role-gated any more", () => {
    // The one admin-only entry (machines) is unlisted outright now, so the nav no longer
    // varies by viewer; the admin-gated surfaces are System settings' server pages, which
    // carry their own rule in settings-sections.ts.
    expect([...navKeysFor()]).toEqual([...NAV_GROUP_KEYS]);
  });
});

describe("the removed collapse control", () => {
  it("leaves no toggle, state or storage behind", () => {
    // The chevron strip, the height tween and the persisted preference all went together.
    // Asserting each absence separately matters: restoring the button while keeping the
    // preference would ship a control that appears to remember a choice it no longer reads.
    //
    // Prose is stripped before matching: this file and the source comment that documents the
    // removal both NAME the state they removed, so a substring check over raw text would be
    // asserting against its own explanation.
    const manifest = src("../src/lib/nav-manifest.ts");
    const sidebar = src("../src/components/layout/sidebar.tsx").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(manifest).not.toContain("NAV_GROUP_COLLAPSED_KEY");
    expect(manifest).not.toContain("initialNavGroupCollapsed");
    expect(manifest).not.toContain("storeNavGroupCollapsed");
    expect(manifest).not.toContain("visibleNavKeys");
    expect(sidebar).not.toContain("toggleNavGroup");
    expect(sidebar).not.toContain("navCollapsed");
    // The entries themselves must still be rendered — the manifest is not "collapsed away",
    // it is simply no longer collapsible.
    expect(sidebar).toContain("navItems.map");
    // NOT asserted: `nav.collapseGroup` / `nav.expandGroup` still exist — the session list's
    // own group rows and the benchmark page use them. Only the nav group's toggle went.
  });
});

describe("NAV_ROUTES", () => {
  it("covers every page key with the route the router actually has (so the sidebar never navigates to a path the router doesn't know)", () => {
    // Pin every key — nav entry or unlisted page alike — has a route: a key without one would
    // render `<NavLink to={undefined}>`.
    for (const key of [...NAV_GROUP_KEYS, ...NAV_UNLISTED_PAGE_KEYS]) {
      expect(NAV_ROUTES[key]).toMatch(/^\/[a-z-]+$/);
    }
    // Pin the names that don't match `/${key}` exactly. `appCenter` (camelCase manifest key)
    // would produce `/appCenter` by concatenation, which React Router 7 does not match against
    // `/app-center` — the route fell through to the catch-all `<Navigate to="/chat">` and
    // the sidebar looked like it kicked the user into a chat. The map pins the kebab-case
    // path the router actually registers.
    expect(NAV_ROUTES.appCenter).toBe("/app-center");
    expect(NAV_ROUTES.appCenter).not.toBe("/appCenter");
    // Every other key is single-word, so concatenation happens to be right; pin the routes
    // anyway so a future typo (e.g. "/usage" → "/Usage") shows up here.
    expect(NAV_ROUTES).toMatchObject({
      agents: "/agents",
      plugins: "/plugins",
      models: "/models",
      machines: "/machines",
      usage: "/usage",
    });
  });
});