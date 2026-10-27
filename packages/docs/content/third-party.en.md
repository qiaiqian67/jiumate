---
title: Third-Party and Open-Source Licenses
description: What this repository will and will not ship, what enforces it, and the traps already found.
---

JiuMate distributes executables — a desktop app, a server package, a CLI. Third-party code baked into those artifacts carries its license along with it, and a license obligation is not something attention alone satisfies: it decides whether a library may be used at all, and whether it may be modified. This page states the rule, how it is enforced, and the specific conclusions already reached.

## The rule

**Default-deny.** Anything outside the allowlist fails the build. A denylist would only catch the licenses someone already thought of, and the interesting case is always the one nobody did — a dependency that quietly relicenses, or a transitive package nobody chose.

**Licenses that may be bundled** (permissive, free to use and modify): MIT, ISC, Apache-2.0, BSD-2/3/4-Clause, 0BSD, Unlicense, Zlib, CC0-1.0, BlueOak-1.0.0, MPL-2.0.

MPL-2.0 is on the list despite being copyleft: its obligations attach per file, so bundling an unmodified dependency is fine. **Modifying** one of its files is not. That is a rule for a reviewer rather than something a script can detect.

**Not permitted**: AGPL, SSPL, BUSL, Elastic License, and GPL / LGPL in **bundled** form. Non-commercial (CC-BY-NC) and share-alike (CC-BY-SA) are equally out — they restrict the use case or propagate obligations onto your artifact.

**`Unknown` does not pass.** Missing metadata is treated as a refusal; it needs an explicit exception with a written reason.

## What enforces it

`scripts/check-licenses.mjs` (`pnpm check:licenses`) reads `pnpm licenses list --prod --json`, decides each **production** dependency, and exits 1 if any is not permitted. CI runs it in the `style` job — which needs no build, and "a dependency was added" is exactly the kind of thing that should fail on the cheapest job in the run.

Only production dependencies are checked, because only they reach the artifact a user runs. The trade-off: a build-time tool under a copyleft license could in principle reach an output, which is a review question a license field cannot answer.

For SPDX expressions, `OR` is satisfied by either side (choosing the Apache branch of `(MPL-2.0 OR Apache-2.0)` is free) while `AND` requires both.

## Exceptions

Cases the rule cannot decide on its own are recorded in the script's `EXCEPTIONS`, each with a reason, and **printed on every run** — including passing ones. An exception that only appears when something is wrong is an exception nobody remembers agreeing to.

There is one today:

- **`khroma`** — reported as `Unknown` because its package.json carries no license field; the repository states MIT. Pulled in transitively by mermaid (the web app's diagram renderer), so it is not a dependency anyone here chose directly.

The first entry this gate ever produced was `@jadelau/use-guizang-ppt`, an optional plugin under AGPL-3.0. It was recorded rather than silently allowed, and then removed: the license is one this project has ruled out, and `use-bento-slides` (MIT) covers the same presentation use case.

## Conclusions already reached

Checked individually while evaluating new modules, and worth not re-litigating:

| Component | License | Conclusion |
| --- | --- | --- |
| Pandoc | GPL-2.0-or-later | Bundled in the desktop app only, invoked as a subprocess. Mere aggregation; kept as is |
| ONLYOFFICE DocumentServer | **AGPL-3.0** | Not adopted. For a network service, §13 requires offering complete source to users |
| Collabora Online | see Gerrit | The GitHub repository is only an issue tracker and reports Other; development happens on Gerrit |
| SheetJS (`xlsx`) | Apache-2.0 | **Do not use the npm build**: stuck at 0.18.5 (2022) with CVE-2023-30533 and CVE-2024-22363; upstream moved to its own CDN |
| mammoth | BSD-2-Clause | Usable. docx to HTML |
| pdfjs-dist | Apache-2.0 | Usable. PDF parsing and rendering |
| exceljs | MIT | Usable. xlsx read/write, and the replacement for SheetJS |
| docx-preview | Apache-2.0 | Usable. docx rendering in the browser |
| officeparser / word-extractor | MIT | Usable. pptx extraction / legacy .doc |
| turndown / html-to-docx | MIT | Usable. HTML to Markdown / Markdown to docx |
| tesseract.js | Apache-2.0 | Usable. OCR |
| Bento (`use-bento-slides`) | MIT | Usable. Self-contained single-file slides whose document is JSON, editable in place |

When choosing: first see whether an existing permissive dependency solves it; then look for a permissive alternative; only take an exception when the license is acceptable because of **how it ships** (a separate executable, an optional plugin a user installs themselves) — and write down why.

## Adding a dependency

1. Prefer MIT / ISC / Apache-2.0 / BSD.
2. Run `pnpm check:licenses`. A failure means something needs handling, not working around.
3. If the metadata is wrong (permissive in fact, unstated in the field), add it to `EXCEPTIONS` and say so.
4. If the license is acceptable because of how it ships, add it to `EXCEPTIONS` and write a reason that **still holds up a year later, to someone who did not write it**. AGPL and SSPL are not eligible for this.
