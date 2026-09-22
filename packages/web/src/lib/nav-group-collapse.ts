/**
 * Collapse state of the sidebar's page-nav group (pure decisions, unit tested): the
 * 智能体 → 词元图 run of entries collapses as one group behind a nav-row-wide chevron
 * button under the group's last entry (arrow up = collapse; collapsed, the button
 * stays — arrow down — as the way back). The pinned "新会话" block above is NOT
 * part of the group — it stays visible in both states (the manifest below simply never
 * contains it).
 *
 * One global storage key, not per Project: the nav is identical everywhere, so like the
 * grouping mode (GROUP_MODE_KEY) this is a single user preference — toggling it anywhere
 * toggles it everywhere. Storage is injectable (model-group-expansion.ts convention:
 * vitest runs in Node, no localStorage); nothing stored, unrecognized values, and
 * throwing storage all fall back to expanded — the default.
 */

/**
 * Page entries of the collapsible nav group, in rendered order. Each key names its
 * route (see `NAV_ROUTES`), its S.nav label, and its NAV_ICONS glyph — the sidebar derives
 * its nav rows from this manifest, so the covered range is pinned here (and in the
 * unit tests) rather than duplicated.
 *
 * Three pages that used to be entries are deliberately absent, because each is now reached
 * from somewhere that fits it better — the page, its route and its server routes are all
 * untouched:
 *
 * - `models` moved into System settings (Personal → Models), where the rest of a viewer's own
 *   configuration already lives.
 * - `benchmark` (the Evaluation Center) has no nav entry; its page stays reachable by deep link.
 * - `machines` was built but never offered (it installs this build onto another host over ssh
 *   with the server account's keys, which is worth introducing deliberately).
 *
 * They live in `NAV_UNLISTED_PAGE_KEYS` so `NAV_ROUTES` stays exhaustive and re-listing one is
 * a move between two arrays rather than restoring deleted code. Traces is deliberately absent
 * from both: reading a Trace happens in the chat toolbar's panel switcher, which is the only
 * place it happens.
 */
export const NAV_GROUP_KEYS = ["agents", "plugins", "appCenter", "usage"] as const;
export type NavGroupKey = (typeof NAV_GROUP_KEYS)[number];

/**
 * Pages that have a route and a page component but no nav row, in no particular order — they
 * are never rendered as a run, so only membership matters.
 */
export const NAV_UNLISTED_PAGE_KEYS = ["models", "machines", "benchmark"] as const;
export type NavUnlistedPageKey = (typeof NAV_UNLISTED_PAGE_KEYS)[number];

/** Every page the sidebar or System settings can navigate to, offered in the nav or not. */
export type NavPageKey = NavGroupKey | NavUnlistedPageKey;

/**
 * The route path that corresponds to each manifest key. Pinned here (not derived from
 * `/${key}`) because a key is an identifier and a route is a URL: `/app-center` is
 * kebab-case while the manifest key is camelCase, and React Router 7's path matching is
 * case-sensitive on character sequences — `/${key}` produced `/appCenter`, which the router
 * did not have a route for and which fell through to the catch-all `<Navigate to="/chat">`,
 * making the sidebar's "App Center" entry look like it kicked the user into the chat.
 *
 * Both surfaces (the expanded sidebar and the collapsed rail) read from this map, so a new
 * multi-word entry only needs the manifest + this map declared once for the URL to stay right.
 */
export const NAV_ROUTES: Record<NavPageKey, string> = {
  agents: "/agents",
  plugins: "/plugins",
  appCenter: "/app-center",
  usage: "/usage",
  models: "/models",
  machines: "/machines",
  benchmark: "/benchmark",
};

/**
 * The manifest as rendered: every entry, in order. Nothing is filtered — none of the four is
 * gated server-side (the admin-only surfaces are System settings' server pages, which carry
 * their own rule in settings-sections.ts), so there is no viewer this list varies by.
 */
export function navKeysFor(): readonly NavGroupKey[] {
  return NAV_GROUP_KEYS;
}

/**
 * Page entries that are visible and reachable: collapsing hides the whole group (the
 * chevron-button toggle and the pinned "新会话" block above are outside it and stay).
 * The sidebar keeps the rows mounted while collapsed — the collapse is an animated
 * height tween — but at zero height, faded out, and inert: exactly this empty set of
 * reachable entries.
 */
export function visibleNavKeys(collapsed: boolean): readonly NavGroupKey[] {
  return collapsed ? [] : navKeysFor();
}

/** Minimal storage interface (the subset of localStorage used here); tests inject an in-memory implementation. */
export interface NavCollapseStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The single global key (`linsight.…` naming convention); holds "collapsed" / "expanded". */
export const NAV_GROUP_COLLAPSED_KEY = "linsight.sidebarNavGroupCollapsed";

/**
 * Reads the persisted choice; only an explicit "collapsed" collapses — anything else
 * (absent / unrecognized / throwing storage) is the expanded default. `localStorage` is
 * resolved INSIDE the try, never as a default parameter: merely touching it throws a
 * SecurityError when site data is blocked (or in a partitioned iframe), and this runs
 * from a useState initializer — an escaping throw would take the sidebar's first render
 * down.
 */
export function initialNavGroupCollapsed(storage?: NavCollapseStorage): boolean {
  try {
    return (storage ?? localStorage).getItem(NAV_GROUP_COLLAPSED_KEY) === "collapsed";
  } catch {
    return false;
  }
}

/** Writes the choice on every toggle (best-effort: quota limits / private browsing fail silently). */
export function storeNavGroupCollapsed(collapsed: boolean, storage?: NavCollapseStorage): void {
  try {
    (storage ?? localStorage).setItem(
      NAV_GROUP_COLLAPSED_KEY,
      collapsed ? "collapsed" : "expanded",
    );
  } catch {
    /* best-effort persistence (quota limits / private browsing) */
  }
}
