/**
 * The sidebar's page-nav manifest and its routes (pure data, no behaviour).
 *
 * ## What this file used to hold
 *
 * It also owned the COLLAPSE state of the nav group — the 智能体 → 词元 run collapsed as one
 * behind a slim chevron button under the group's last entry, persisted in one global
 * `localStorage` key. That control is gone (the button, the height tween, the `inert`
 * bookkeeping and this module's storage API with it): on the screens that actually needed it
 * it cost a full row of vertical space to hide about 150px of entries in a column whose only
 * job is to be read, and the sidebar's one exception to flat-at-rest styling read as a seam
 * nobody had asked for. Nothing reads the preference any more, so persisting it would be
 * writing a key no code can act on.
 *
 * What remains is the manifest and the route map, which both nav surfaces (the expanded
 * sidebar and the collapsed rail) depend on.
 */

/**
 * Page entries of the nav group, in rendered order. Each key names its
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
