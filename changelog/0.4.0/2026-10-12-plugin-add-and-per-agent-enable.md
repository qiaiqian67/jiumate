# Plugins become local objects you add and enable per Agent

- **Date:** 2026-10-12
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `skills`

[中文版](2026-10-12-plugin-add-and-per-agent-enable.zh.md)

JiuMate is a local client with no marketplace to download from, and the plugin page treated it as if it had one: it offered a download-to-machine button on cards already listing plugins sitting on the machine. This change makes the plugin model match the product — a plugin is something you **add** to this machine, once, from a URL, an archive or a local directory, and then turn **on or off per Agent**.

## Adding a plugin

- **Three sources, one dialog.** `/discover` previews a repository or archive before anything is written; `/url` imports from a git URL, `/archive` from an uploaded zip, `/local` from a directory on this machine, and `/local/batch` from a directory holding several. A repository URL is resolved into a fetchable archive and a plugin name (`resolveRepoUrl`, `looksLikeArchive`, `pluginNameFromRepo`).
- **An added copy is kept separate from a built-in one of the same name.** A user plugin is installed as `<name>@local`, and the built-in library ships as `<name>@jiumate-builtin`. Installs are addressed by id, so the two can be installed, upgraded and removed without either reaching the other. `resolvePluginId` picks the id: an added copy wins, so what the user brings in is what they get, and a name that is built-in only resolves to `builtinPluginId`.
- **Adding a directory imports every plugin in it and leaves all of them disabled for every Agent.** Ten filesystem writes should not also change what the Agents can currently do.
- **Archives are hardened and verified.** `unpackPluginArchive` / `writePluginArchive` reject entries that escape the destination, and a single wrapping root directory is stripped so a plugin is not nested one level deeper than the manifest reader expects.

## Enabling per Agent

- **The switch is a field, not a deletion.** `POST /api/skills/plugins/enabled` rewrites `enabled` in the Agent's plugin manifest. A disabled plugin contributes nothing to the next Session's prompt, the files stay on disk, and switching back needs no reinstall. Because a live Session assembled its prompt while the plugin was still on, the runtime is invalidated on the switch.
- **The switch appears only for a plugin installed on the current Agent.** A switch for something absent has nothing to act on.
- **A bundled Skill inherits its plugin's disable.** Its files live inside the plugin directory, so there is no second switch to fall out of sync.

## Bundled Skills live inside the plugin

A plugin's Skills are installed into `plugins/<name>@<marketplace>/skills/`, not copied out into a flat `skills/`. What that buys:

- **Attribution is structural.** Which plugin a Skill came from is answered by where the file is, so it cannot be wrong and cannot be lost by a writer that forgot to record it. `InstalledSkill.plugin` became `SkillMetadataItem.plugin`, and `buildInstalledSkillsView` ranks its three sources explicitly — `structural` (the Skill sits in a plugin's tree, which wins outright), `recorded` (`installs.json` names the owner), `inferred` (deduced from which Skills are present). `inferred` is now false for a structural claim: a path-derived attribution is not a guess, and reporting it as one makes the UI hedge about something it knows.
- **A bundled Skill has no standalone removal path.** The only operation that reaches it removes the plugin with it, so 「捆绑技能不可单独卸载」 stops being a UI rule and becomes a property of the layout. Uninstall is consequently one plugin-level request rather than a DELETE per Skill, which had become a no-op for bundled Skills — it reported success while removing nothing.
- **Disabling survives.** Switching a plugin off keeps its files and switching it back on needs no reinstall.

## Attribution, migration and reconciliation

- **Skills installed under the old flat layout are read from both trees.** `listInstalledSkills` reads `skills/` and the plugins tree, so an install made before this change keeps working.
- **`migrateFlatBundledSkills` migrates on library membership, not on recorded installs.** It consults `.installs.json` for what each installed plugin brought, but that file is absent for every install made before it shipped — so on exactly the machines that needed migrating it named nothing and moved nothing, silently. It now moves a flat Skill only when **exactly one** library plugin ships a Skill of that name, which is a proof rather than a guess. Zero claimants leaves the user's own Skill alone; two or more is ambiguous, so it is left in place and reported. Run against a real data root, 18 Skills across 9 plugins moved and none was lost.
- **Migration writes a manifest and a provenance record.** Without the manifest a migrated plugin had Skills but no `enabled` flag, so the switch would have worked on a fresh install and silently done nothing on an upgraded one. The version is left unknown rather than guessed — what is on disk is the installed copy. An existing manifest is never overwritten.
- **`reconcilePluginIds` runs on read and is one-way.** Machines that installed before the added-id fix kept both directories, so the Agent served the plugin twice and disabling turned off only one of them. Reconciliation moves a plugin towards the added id, best-effort, and never at the cost of a Skill or a switch the user set.

## Reading a plugin from elsewhere

- **`.claude-plugin/plugin.json` is read first; `plugin.json` stays supported.** Checked in that order deliberately: a directory carrying both is an upstream plugin with our legacy file alongside, and the upstream one is the authoritative statement of what it is. A plugin able to disagree with itself about its own version is worse than either layout.
- **Categories are data.** `marketplace.json` beside a plugin root overrides the shipped `PLUGIN_CATEGORIES` list, which becomes the fallback — so a plugin whose category we have never seen can be filed without a release. A malformed file throws rather than silently regrouping a library the user did not change.

## Card actions

Marketplace sources are gone; they were a network concept in a product with no network source of truth, and every string they needed had to be maintained in two languages. The card actions are the ones that mean something locally:

- **enable / disable** for the current Agent
- **uninstall** from this machine — irreversible, and it names the Agents that lose access, so the warning is one the user can reason about
- **upgrade** when a newer version exists
- **manage tags**, shared with the skills page

## Skills page filing

The skills tab had a category *manager* — create, rename, delete — but nothing to file a skill into and nothing to filter by, so the feature was a settings dialog that did nothing. Both halves are now present:

- **`filings` (`itemId` → category id, per user) live in their own `localStorage` file**, separate from the category list, so a category rename does not rewrite every filing and a filing for an uninstalled item becomes unreadable rather than dangling.
- **A bundled Skill inherits its plugin's filing**, with a stored filing still winning so a Skill can be pulled out of its plugin's category on purpose. 「跟随插件」 is its own option rather than folded into 「不分类」 — going back to inheriting is not the same act as choosing no category.
- **The chips are a separate row from the origin tabs, not a merge.** Origin answers "where did this come from", category answers "what is this for". Counts are per-category over the search- and origin-filtered set, so a chip answers "how many would I get if I clicked this".

## Compatibility

Three behaviours that predate this change, each stated with what it does rather than argued about:

- **Plugin ids are `<name>@<marketplace>`.** Anything that reports a plugin id shows the full form (`agent-tuning@jiumate-builtin`) because that is the directory the Skills live in; anything that looks one up strips the suffix (`pluginNameOf`, which now lives in core and is the only definition). A default naming no entry is rejected on load.
- **Installed plugins that were placed under the built-in id are reconciled towards the added id on read**, best-effort and one-way. Before that reconciliation existed, uninstalling such a copy failed with a 400 and could have removed the built-in copy of the same name.
- **Existing installs are never migrated destructively.** A flat Skill that cannot be attributed with certainty stays exactly where it is. `scripts/check-migration.mjs` runs the migration against a real data root and reports what moved, what was left alone, and whether anything was lost.
