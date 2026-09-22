# Restructure the sidebar, rename four surfaces, and rebuild the Token Map's heatmap

- **Date:** 2026-09-20
- **Type:** feature
- **Scope:** `web`, `core`

[中文版](2026-09-20-nav-restructure-and-token-map-heatmap.zh.md)

The sidebar's page group is now 智能体 / 插件·技能 / 灵感库 / 词元图, in that order. Two entries
left it for better homes, four surfaces were renamed, and the Token Map gained a year heatmap in
the product's reference layout. Two preference defaults changed and the model catalog's curation
moved.

## The nav is four entries, and two pages moved rather than disappeared

- The **Evaluation Center** no longer has a nav entry. Its page, its route (`/benchmark`) and its
  server routes are untouched, so a deep link still works.
- **Models** moved into System settings, under Personal → Models, where the rest of a viewer's own
  configuration already lives. It renders the same component the `/models` route does.
- Both pages are listed in a new `NAV_UNLISTED_PAGE_KEYS`, so `NAV_ROUTES` stays exhaustive and
  re-listing one is a move between two arrays rather than restoring deleted code. The unit tests
  assert membership there, which is what stops a later edit from deleting a route along with its
  row.
- `navKeysFor` lost its `isAdmin` parameter. It existed to hide `machines`, which is unlisted
  outright now, so the nav no longer varies by viewer — the admin-gated surfaces are System
  settings' server pages, which carry their own rule in `settings-sections.ts`.
- The collapsed rail follows the same order, and dropped the two entries with the sidebar.

## The model library, hosted in a settings pane

- `ModelsPage` split into a thin page wrapper (which owns `useDocumentTitle` and the
  `h-full overflow-y-auto p-4 md:p-6` container) and `ModelsPane` (the library itself, with a
  class-free root). Neither piece of chrome belongs in a dialog pane: the title hook sets
  `document.title` and never restores it, so an embedded copy would have left "模型库 · Linsight"
  in the tab after the dialog closed, and a second full-height scroll container inside the
  dialog's own would have nested two scrollbars with two sets of padding.
- The pane's root stays an element rather than a fragment because the dialogs it opens
  (add-group, model, OAuth, the two confirms) are siblings of its content wrapper — removing it
  detaches them from the return value.
- A new `models` settings page joins the Personal group, always visible (it is per-user
  configuration), with the same glyph the nav entry used.

## Four surfaces renamed

| Was | Now | Where |
| --- | --- | --- |
| 应用中心 | 灵感库 | nav entry, page title |
| 插件库 | 插件·技能 | nav entry, page title, and the three error strings that name the library |
| 成本中心 | 词元图 | nav entry, page title, and the two fast-mode hints that refer to it |
| 新建对话 / 新对话 | 新会话 | the nav block's label and the create-session action |

The English dictionary follows: App Center → Inspiration, Plugin library → Plugins & Skills,
Cost Center → Costs & usage → Token Map, New chat → New session. The schedules tab's own
「新建会话」 (a scheduled task's target) is deliberately unchanged — that phrase is about a task
creating a session, not about this control.

## The Token Map's year heatmap

- The panel was rebuilt to the product's reference layout: **weeks across, weekdays down**, month
  labels riding above the columns, the five-shade legend under the grid, and the three headline
  figures beside it — 累计词元量 (the year's total), 单日峰值 (the busiest day) and 活跃天数 (days
  with any usage). Hovering a day shows its date, Token total and cache hit rate.
- The previous version put months down the side and days across. That reads well for "which months
  were heavy" but wastes most of a 31-wide row on short months, and it cannot answer "was it
  weekdays or weekends" at all.
- Cells shade on **tokens** (this is the Token Map, and the panel came from "模型消耗…热力图"), while
  the tooltip also reports the day's cache hit rate through the shared `cacheHitRate` helper, so
  the two pages cannot drift.
- Colouring is by **quantile over the days that have usage**, not by a fraction of the maximum.
  Token usage is spiky — one long agent run can be an order of magnitude above a typical day — so
  a max-relative scale paints almost the whole year its palest shade and the one spike its
  darkest, which is the opposite of informative.
- The geometry lives in a plain module (`token-heatmap.ts`) with no React in it, matching the
  package's convention — vitest runs node-only here, so a pure function is the only thing a test
  can pin directly. Its 20 tests cover the leap-year rules, the leading and trailing week stubs,
  the month marks, and the one invariant a mis-aligned grid violates: **every cell's row equals
  its own weekday**.
- The panel carries its own request. It ignores the page's date range (a year view under a
  seven-day filter would be blank most of the time) but honours the Agent and Model filters,
  because those select *whose* usage is on screen and a heatmap that ignored them would
  contradict every chart around it. The year is steppable, so it stays useful in January.

## Two preference defaults

- **Font size** now opens at 小 (was 中). The scale is a preference, and the two larger tiers are
  the ones a user has to come back and pick — starting at the middle meant everyone who never
  opened Appearance was reading a size they never chose.
- **Currency** now opens at 人民币 (was 美元). Prices are always *stored* as USD per million Tokens
  and converted only for display, so this changes nothing but which figure a user sees first —
  and several of the catalog's gateway groups quote their preset prices in CNY.
- Both take an injectable storage so a Node test can reach them, the same shape as
  `initialNavGroupCollapsed`. That matters here because a wrong answer is invisible in a
  screenshot: a UI at the middle tier looks like one that was supposed to be, and a price in
  dollars looks like a price. A stored choice always wins — including one equal to the old
  default — because these decide what an *untouched* install shows.

## The model catalog's curation moved

- **TokenDance now trails the real platforms** instead of leading, and **DeepSeek carries
  `recommended`** in its place. It sits immediately before `custom`, which the tests pin as
  always-last — it is a pseudo-provider for user-defined models, not a platform.
- "Leads the default order" and "is marked recommended" are the same entry, and two things
  depend on that rather than on the flag: `defaultExpandedProviders` opens the group at index 0,
  and the models page captions whichever entry carries `recommended`. Both still agree.
- The web suite reads core through **pnpm's injected copy** in `node_modules/.pnpm`, not
  `packages/core`. A source edit is therefore invisible to it until core is built *through pnpm*
  (`pnpm --filter @prismshadow/linsight-core build`, which is what `dev-prebuild.mjs` runs) —
  `npx tsup` writes `packages/core/dist` but does not trigger the sync hook, so the web tests go
  on asserting the previous order and pass. That false green is how the two order assertions in
  `model-grouping.test.ts` and `model-group-expansion.test.ts` were found.

## The embedded Models pane gets the dialog's full width

- The Models page is the densest page in the app: a group header carries a logo, the vendor name,
  a model count, a recommendation pill and up to four action buttons, and it gates four of those
  behind `@container` breakpoints from `@lg` (512px) to `@4xl` (896px). Hosted in System settings
  it was getting the default `sm:max-w-3xl` minus the rail and padding — **531px of column**, under
  even the lowest of those gates, so the recommendation pill was the only extra mark that survived.
- `PagedDialog` gained an optional `widthClass` and the settings dialog passes `sm:max-w-5xl` for
  the Models pane only. The dialog is portaled to `body`, so it is capped by the viewport rather
  than by the app's main column; this lifts the dialog's own cap and lets the pane take whatever
  the window actually allows (~574px of column on a 837px viewport, more on a wider one). Every
  other settings page keeps the default.
- **The header was never broken.** An earlier reading of this took the `@xl` gate on line 1154 for
  the vendor name and concluded the headers collapsed to bare chevrons. It is the *model count*
  that hides there; the logo and the name carry no `hidden` class and are the two things in the
  row that always render. The width is a genuine improvement for a dense page, not a fix for a
  defect — worth stating, because the wrong version of this note would send someone looking for a
  bug that does not exist.

## Chinese localisation: Project and the Project roles

- `Project` → 项目 throughout the Chinese dictionary, including the page and dialog titles, the
  trace-import copy, and the error strings. The file header has always listed Project among the
  surface labels to translate; this closes that gap.
- The literal id `default_project` → 默认项目 in the delete-forbidden message.
- The Project-level roles: `owner` → 管理员 (matching the server-level role label the admin page
  already uses) and `member` → 成员, in the three read-only hints. `credential` in the same
  sentence became 凭证, per the same rule that keeps only Token and Agent untranslated.

## The switcher names the built-in Project, and its badge names the role

Two strings that came from the server rather than the dictionary, and so were missed by the pass
above until a screenshot showed them:

- The sidebar's Project switcher read **`default_project`** — an identifier, in the one place a
  user expects a name. The admin's built-in Project is provisioned with no display name (the server
  inserts the row with just id/owner/createdAt, where a non-admin's gets the username), so
  `projectDisplayName` fell through to the raw id. It now falls through to 默认项目 instead.
  A **label** rather than a seeded `name`: the name is data the owner can edit, and writing one at
  signup would freeze whichever language that install happened to run in.
- The role badge beside it rendered **`owner`** / **`member`** verbatim. It now goes through
  `projectRoleLabel`, giving 管理员 / 成员 — the same word the server-level admin already wears, so
  the two scopes do not read as different privileges.
- `DEFAULT_PROJECT_ID` gained one home in `state/project.tsx`. It cannot come from core:
  `paths.ts` imports `node:os`/`node:path`, and core's subpath exports exist precisely for
  web-safe, dependency-free modules, so pulling it from there would drag Node builtins into the
  browser bundle. The literal had already been spelled out in `project-dialogs.tsx` (an id
  comparison) and `admin-users-page.tsx` (building `<username>-default_project`); both now read
  the constant, and a test pins it against the server's spelling — the only thing tying the two
  together.
- Empty is treated as absent (`name: ""` falls through), because `project_config.toml` can carry
  an empty name and a blank switcher row is worse than either fallback. A name the owner sets
  still wins, including on the built-in Project — the label is a fallback, not an override.

## Tests

- `packages/web` pins the new manifest, its order, and the fact that the two moved pages keep
  their routes; the settings rail for all four viewer kinds now includes the Models page.
- `packages/web` covers the heatmap geometry and its quantile colouring.
