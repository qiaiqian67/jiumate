# use-guizang-ppt plugin removed

- **Date:** 2026-09-23
- **Type:** process
- **Scope:** `skills`, `docs`, `landing`, `tooling`

[中文版](2026-09-23-remove-guizang-ppt-plugin.zh.md)

Removed the `use-guizang-ppt` plugin and every reference to it. The plugin packaged [op7418/guizang-ppt-skill](https://github.com/op7418/guizang-ppt-skill) (歸藏) under AGPL-3.0, which is a license this project does not ship; the same presentation use case is covered by `use-bento-slides` (MIT).

## Details

- Deleted `plugins/use-guizang-ppt/`, and dropped `@linsight/use-guizang-ppt` from the dependency lists of `@prismshadow/linsight-core`, `@prismshadow/linsight-cli` and `@prismshadow/linsight-desktop`.
- Removed the plugin from the `office-productivity` group in `plugins/README.md`, `README.md` / `README.zh.md`, `packages/docs/content/skills.{en,zh}.md`, and the landing page's skills section (`packages/landing/src/lib/{strings,strings-en}.ts`).
- Removed the two `.prettierignore` entries that existed only for the plugin's vendored assets.
- Removed the `@linsight/use-guizang-ppt` entry from `scripts/check-licenses.mjs`'s `EXCEPTIONS`, where it had been recorded as an AGPL exception.
- Removed the four `unreleased/` changelog entries the plugin had accumulated — two announcing it and two covering the landing-page sync fix — since it never shipped in a release and both halves would otherwise appear in the same set of release notes.
- `packages/docs/content/third-party.{en,zh}.md` record that the gate's first exception was this plugin and that it was removed.
