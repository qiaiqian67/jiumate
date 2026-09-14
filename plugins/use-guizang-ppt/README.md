# use-guizang-ppt

Author Magazine Web PPT decks — single-file HTML horizontal-swipe slide presentations.

This Linsight plugin packages [op7418/guizang-ppt-skill](https://github.com/op7418/guizang-ppt-skill) (歸藏) as an optional `office-productivity` skill. It is **off by default** (`preinstall: false`); install it from the plugin library on demand when the user wants a presentation-style deck.

## What ships

The skill ships verbatim from upstream at the time of packaging:

- `skills/guizang-ppt-skill/SKILL.md` — entry point, picked up by the plugin loader and installed into an Agent's `agent_state/skills/`.
- `skills/guizang-ppt-skill/references/` — 10 reference documents (Style A & Style B layouts, themes, components, image prompts, presenter mode, screenshot framing, checklist).
- `skills/guizang-ppt-skill/scripts/` — three validators (`validate-swiss-deck.mjs`, `validate-presenter-mode.mjs`, `check-presenter-runtime-sync.mjs`).
- `skills/guizang-ppt-skill/assets/` — `template.html` (Style A), `template-swiss.html` (Style B), `motion.min.js`, the showcase PNG, and nine CleanShot-style `.webp` backgrounds.
- `LICENSE` — AGPL-3.0, copied from upstream. Required by the AGPL to ship alongside the work.

## License

AGPL-3.0, inherited from upstream. See [`LICENSE`](./LICENSE).

## Upstream

- **Repository:** <https://github.com/op7418/guizang-ppt-skill>
- **Maintainer:** 歸藏 (op7418)
- **Update procedure:** re-pull `main` from the upstream repository, copy the new `SKILL.md`, `references/`, `scripts/`, `assets/` over `skills/guizang-ppt-skill/`, and bump the `version` field in `plugin.json` to the next `YYYY-MM-DD.N`.

## Attribution

The upstream `SKILL.md` carries an explicit "不要写入生成的 PPT、HTML 页面、封面或配图" marker on its sponsorship/support line; that marker is preserved on the upstream file and is honoured downstream — no Linsight-generated PPT, HTML cover, or asset image carries the support list.
