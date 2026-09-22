# Retry a locked file write, and stop a run from burning minutes on a browser install

- **Date:** 2026-09-20
- **Type:** fix
- **Scope:** `core`

[中文版](2026-09-20-fix-agent-write-lock-and-runaway-install.zh.md)

A trace of one real session — an agent asked to build an HTML dashboard — showed 18.5 minutes of
wall-clock, of which 3.7 were model inference and 14.6 were tool execution. Thirteen of those
minutes went to a single self-inflicted detour: the agent decided it needed Playwright to
screenshot the page it had written, installed Playwright and Chromium, then polled the download
six times without progress before killing it. Three of its sixteen `edit_file` calls had also
failed outright. Both problems were in the Harness, and both are fixed here.

## A locked file no longer fails the write

- `atomicWriteFile` replaces a file by writing a temp file and renaming it over the target, and
  the rename had no retry. On Windows, `rename` returns a bare `EPERM` whenever another process
  holds the target open — a virus scanner reading the file that was just written, the search
  indexer, or the browser the user is viewing the page in. The error is indistinguishable from a
  permissions problem, so a momentary lock became a failed tool call and a wasted model round
  trip. In the traced session it hit three of sixteen `edit_file` calls, and the user's own
  workflow (write a page, open it, ask for a change) is exactly what triggers it.
- The rename now retries on `EPERM` / `EBUSY` / `EACCES` with a bounded backoff totalling just
  under a second. A lock that outlives that is not transient — it is a process holding the file
  exclusively, which no amount of waiting fixes — so it fails fast with an error that names the
  cause and says the file is unchanged, rather than handing back an `EPERM` that reads like a
  `chmod` problem.
- The retry lives in `atomicWriteFile`, so all nine of its callers benefit: `edit_file`,
  `write_file`, the project config, the agent state, the vault and the kernel update.

## Chinese command output is readable again

- A command session decodes stdout as UTF-8, but Windows PowerShell writes in the console's OEM
  code page — GBK on a Chinese install. Every Chinese path and message a command echoed arrived
  as mojibake (`目录` as `Ŀ¼`, `数据来源` as `������Դ`), so the model could not read back the
  content it had just written. That is part of what pushed it toward screenshotting the page
  instead.
- `ShellInvocation` gained a `preamble`, prepended to the command string at spawn. For PowerShell
  it sets `[Console]::OutputEncoding` **and** `$OutputEncoding`, which are different knobs: the
  first governs what PowerShell itself writes, the second what it hands to a native command.
  Setting both also fixes `node` / `git` / `curl` output, because PowerShell decodes a native
  command's output with the same setting. Decoding the pipe as GBK instead would have fixed
  PowerShell's own formatting and corrupted every native command emitting UTF-8.
- `cmd.exe` gets `chcp 65001` (a partial fix — it governs cmd's own output only). POSIX shells
  are UTF-8 already and get nothing.
- The preamble is prepended at the spawn site, not into the stored command, so the approval
  prompt and the completion report still show the command the user wrote.

## The prompt no longer invites a browser install

- `DEFAULT_SYSTEM_PROMPT` said to prefer Playwright "when it is installed" and named nothing about
  cost. The agent read the preference as an instruction to install it. The line now says
  explicitly not to install it, and that `curl` plus reading the markup is enough to check a page
  you wrote yourself.
- A new constraint: do not install dependencies unless the user asked, `npx <pkg>` installs the
  package when it is missing (write `npx --no-install` to mean "only if it is already here"), and
  a browser or test harness can be hundreds of megabytes and many minutes.
- New tool-use rules, each drawn from the trace: start anything that can run for minutes with
  `run_in_background` rather than in the foreground and poll it (each `input_command` poll waits
  out its whole `yield_time_ms`); never pipe a long command through a filter that can only emit at
  the end (`| Select-Object -Last 5`, `| tail -5`), which withholds every line until exit and
  makes a working download look identical to a hung one; and make a repeated edit once with
  `replace_all` or a single shell rewrite rather than one call per occurrence.

## Kernel advanced to 2026-09-20

- The prompt and tools tabs moved: the tools tab because the desktop-pet replacement had swapped
  the companion tools for a single `pet` tool without advancing the kernel, which had left the
  pinned-hash guard failing; the prompt tab because of the guidance above. The superseded-hash
  record carries the old values, and the pre-toggles reconstruction was re-anchored.

## Tests

- `packages/core` covers a rename lock that clears (the write lands) and one that does not (the
  error names the cause, the old content survives, no temp file is left). Windows-only, because
  the condition is — a POSIX rename over an open file succeeds.
- `packages/core` covers the preamble end to end: a real spawn proves GBK PowerShell output
  becomes readable UTF-8, and a second proves the exit code and a native command's stderr are
  untouched.
- `packages/cli` acknowledges `pets` and `skins` in the tsup coverage list.
