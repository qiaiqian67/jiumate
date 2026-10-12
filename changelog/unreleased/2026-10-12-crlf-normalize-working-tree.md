# Normalize the working tree so CRLF stops looking like an edit

- **Date:** 2026-10-12
- **Type:** process
- **Scope:** `tooling`

[中文版](2026-10-12-crlf-normalize-working-tree.zh.md)

`.gitattributes` already declared `eol=lf` and the index already held LF, but 33 files were CRLF on disk, so Git reported a whole-file diff on files nobody had touched — and those diffs are exactly what gets committed by accident. Those files were normalized in place; Git now reports no change to any of them.

`.gitattributes` could not have fixed this on its own. It governs what Git stores and checks out, not what an editor **saves**: a Windows editor set to CRLF writes CRLF, Git notices, and the cycle repeats. So this also added the half that was missing — `.editorconfig` sets `end_of_line = lf` for every file, matching `.gitattributes` and Prettier's `endOfLine=lf`, so a save is already correct. The two files now say the same thing, and a save that disagrees with the repository is no longer the default.

The same pass ran Prettier over the plugin work, which had a few lines it would have reflowed. Web `tsc` is clean and its 2009 tests pass.
