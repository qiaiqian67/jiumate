/**
 * nav-group-collapse.ts unit tests: the sidebar's collapsible page-nav group, toggled
 * by a nav-row-wide chevron button under the group's last entry (no label — tooltip
 * and aria carry the collapse/expand names; arrow up = collapse, and the button
 * itself stays while collapsed as the way back). The group covers exactly
 * the 智能体 → 词元图 run of entries in rendered order (the sidebar derives its nav
 * rows from the NAV_GROUP_KEYS manifest, so the range is pinned here); the pinned
 * "新会话" block is never part of the manifest, so collapsing cannot hide it. The
 * choice persists globally in one localStorage key (injectable storage): a remount
 * reads it back, nothing stored / unrecognized values / throwing storage all fall
 * back to expanded — the default.
 */
import { describe, expect, it } from "vitest";
import {
  NAV_GROUP_COLLAPSED_KEY,
  NAV_GROUP_KEYS,
  NAV_ROUTES,
  NAV_UNLISTED_PAGE_KEYS,
  initialNavGroupCollapsed,
  navKeysFor,
  storeNavGroupCollapsed,
  visibleNavKeys,
} from "../src/lib/nav-group-collapse";
import type { NavCollapseStorage } from "../src/lib/nav-group-collapse";
import { NAV_ICONS } from "../src/components/ui/icons";
import { zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

/** In-memory storage (vitest runs in a Node environment, no localStorage; draft-cache.test.ts convention). */
function memStorage(): NavCollapseStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

describe("NAV_GROUP_KEYS", () => {
  it("covers exactly the 智能体 → 词元图 range, in rendered order", () => {
    // Traces is deliberately absent: the Trace panel moved into the chat toolbar's panel
    // switcher (features/dock), and /traces stays reachable through its deep links only.
    expect([...NAV_GROUP_KEYS]).toEqual(["agents", "plugins", "appCenter", "usage"]);
    // Pin the endpoints by label: a manifest edit that shifts the range shows up here.
    expect(zh.nav[NAV_GROUP_KEYS[0]]).toBe("智能体");
    expect(zh.nav[NAV_GROUP_KEYS[NAV_GROUP_KEYS.length - 1]!]).toBe("词元图");
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

  it("the pinned New session entry is not in the group, so collapsing cannot hide it", () => {
    // The "New session" block (S.chat.newSessionMenu, 「新会话」) renders above the nav,
    // outside the group container — the manifest never governs it.
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

describe("visibleNavKeys", () => {
  it("expanded shows the whole group; collapsed leaves no entry visible or reachable (the sidebar renders the mounted rows inert at zero height)", () => {
    expect(visibleNavKeys(false)).toEqual(navKeysFor());
    expect(visibleNavKeys(true)).toEqual([]);
  });

  it("the chevron-button toggle's accessible names exist in both languages (icon-only button: aria + tooltip carry them)", () => {
    for (const [locale, dict] of [
      ["zh", zh],
      ["en", en],
    ] as const) {
      expect(dict.nav.collapseGroup, locale).toBeTruthy();
      expect(dict.nav.expandGroup, locale).toBeTruthy();
      // One button, two states: the same name for both would leave the state unreadable.
      expect(dict.nav.collapseGroup, locale).not.toBe(dict.nav.expandGroup);
    }
  });
});

describe("persisted collapse state (one global localStorage key)", () => {
  it("default is expanded with nothing stored, and reading never writes", () => {
    const s = memStorage();
    expect(initialNavGroupCollapsed(s)).toBe(false);
    expect(s.map.size).toBe(0);
  });

  it("toggle → store → a fresh mount-time read restores the collapsed state", () => {
    const s = memStorage();
    // Collapse: what the sidebar renders shrinks to nothing but the header toggle …
    storeNavGroupCollapsed(true, s);
    expect(s.map.get(NAV_GROUP_COLLAPSED_KEY)).toBe("collapsed");
    // … and a re-mount (initialNavGroupCollapsed is the useState initializer) restores it.
    expect(initialNavGroupCollapsed(s)).toBe(true);
    expect(visibleNavKeys(initialNavGroupCollapsed(s))).toEqual([]);
    // Expand again: the choice round-trips both ways.
    storeNavGroupCollapsed(false, s);
    expect(s.map.get(NAV_GROUP_COLLAPSED_KEY)).toBe("expanded");
    expect(initialNavGroupCollapsed(s)).toBe(false);
    expect(visibleNavKeys(initialNavGroupCollapsed(s))).toEqual(navKeysFor());
  });

  it("unrecognized stored values fall back to expanded", () => {
    const s = memStorage();
    for (const raw of ["", "true", "1", "COLLAPSED", "yes"]) {
      s.map.set(NAV_GROUP_COLLAPSED_KEY, raw);
      expect(initialNavGroupCollapsed(s)).toBe(false);
    }
  });

  it("storage throwing (quota/private mode): store does not throw, read yields the default", () => {
    const broken: NavCollapseStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(() => storeNavGroupCollapsed(true, broken)).not.toThrow();
    expect(initialNavGroupCollapsed(broken)).toBe(false);
  });

  it("storage whose GETTER throws (blocked site data) degrades instead of escaping the useState initializer", () => {
    const hostile = {
      get getItem(): never {
        throw new Error("SecurityError");
      },
      setItem: () => undefined,
    } as unknown as NavCollapseStorage;
    expect(() => initialNavGroupCollapsed(hostile)).not.toThrow();
    expect(initialNavGroupCollapsed(hostile)).toBe(false);
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
      benchmark: "/benchmark",
    });
  });
});
