# use-guizang-ppt plugin ships Magazine Web PPT decks

- **Date:** 2026-09-14
- **Type:** feature
- **Scope:** `plugins`

[中文版](2026-09-14-use-guizang-ppt-plugin.zh.md)

Added the `use-guizang-ppt` plugin to the built-in library, packaging [op7418/guizang-ppt-skill](https://github.com/op7418/guizang-ppt-skill) (歸藏) as an optional `office-productivity` plugin. The plugin is **off by default** (`preinstall: false`); install it from the plugin library on demand when the user wants a presentation-style deck.

## What ships

The plugin carries `SKILL.md`, `references/` (10 reference documents covering Style A & Style B layouts, themes, components, image prompts, presenter mode, screenshot framing and the production checklist), `scripts/` (three validators) and `assets/` (`template.html`, `template-swiss.html`, `motion.min.js`, the showcase PNG, and nine CleanShot-style `.webp` backgrounds), vendored from upstream at the time of packaging. The upstream `LICENSE` (AGPL-3.0) is included at the plugin root as the AGPL requires.

## Conventions applied

- The skill's frontmatter carries only `name` and `description`, in the slim library form; the plugin's manifest (`plugin.json`) is the metadata holder.
- The `description`, `description_zh`, `short_description` and `short_description_zh` fields are written in plain characters, not `\uXXXX` escapes, to match every other shipped plugin.
- All vendored text files were normalised from CRLF to LF on import, matching every other committed text file in the workspace.
- A `## Before you start` section was added at the top of the skill body, mirroring the convention every other shipped skill follows — it asks before producing a deck when the user's message only names the skill, and re-asserts the upstream rule that the support / sponsor list never appears in any generated deck, HTML cover or generated image.
- The plugin is registered as `@linsight/use-guizang-ppt` in the dependency lists of `@prismshadow/linsight-core`, `@prismshadow/linsight-cli` and `@prismshadow/linsight-desktop`, so the plugin loader (`pluginRoots()`) discovers it on every host.
- The plugin table in `plugins/README.md`, the root `README.md` / `README.zh.md`, the loader test (`packages/core/test/plugins.test.ts`) and the docs sync test (`packages/docs/test/skills-sync.test.ts`) all reference the new plugin in their canonical places; the docs sync test derives its plugin set from disk, so any future plugin without a docs entry fails this gate.
- Vendored HTML templates, minified runtime JS and the pre-built validator scripts under `assets/` and `scripts/` are excluded from prettier via `.prettierignore` — they are upstream content, not in-repo source.

## License

AGPL-3.0, inherited from upstream. The plugin's `package.json` carries the AGPL identifier; the plugin's `LICENSE` is the upstream file.

## Provenance

- Repository: <https://github.com/op7418/guizang-ppt-skill>
- Maintainer: 歸藏 (op7418)
- Update path: re-pull upstream `main`, copy `SKILL.md`, `references/`, `scripts/` and `assets/` over `skills/guizang-ppt-skill/`, normalise line endings, bump `version` in `plugin.json` to the next `YYYY-MM-DD.N`.
