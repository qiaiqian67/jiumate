# Stop discarding a working bash, and give a Windows POSIX shell the user's PATH

- **Date:** 2026-09-20
- **Type:** fix
- **Scope:** `core`

[中文版](2026-09-20-fix-shell-resolution-and-path-inheritance.zh.md)

A trace of a real session — an agent building an HTML dashboard in the packaged app, 47 minutes
of wall-clock — showed the agent running on Windows PowerShell 5.1 on a machine that had two
working bash installs. That single fact explains a chain of trouble: GBK output it could not
read back, a nested `powershell -Command "$x = …"` whose variables the outer shell expanded to
nothing before the inner shell saw them, and a five-round detour that ended with the dashboard
rewritten from scratch because the model concluded its UTF-8 was broken. The shell resolution is
fixed here, along with the PATH inheritance that made the first fix a regression on its own.

## A usable bash is no longer thrown away

- `resolveShell` looked only at `whichAll("bash")[0]` when deciding whether a bash was usable. It
  rejects a bash under the system root, because that is the WSL launcher — which runs commands
  inside a Linux distro with a different filesystem view, and fails outright when no distro is
  configured. But System32 sits early in almost every PATH, so on a machine whose first match is
  the launcher the check failed and the whole chain was abandoned, even with a Git for Windows or
  MSYS2 bash sitting at index 1 and 2.
- Measured on the machine this was found on: `C:\Windows\System32\bash.exe` at index 0 (the WSL
  launcher), then `E:\msys64\usr\bin\bash.exe` and `D:\Program Files\Git\usr\bin\bash.exe`, both
  of which run commands fine. The resolver returned `powershell`.
- The resolver now scans every PATH match and takes the first that is not a WSL launcher. A first
  match that is usable still yields the bare name `bash`, so the common case is byte-identical to
  before; a later match is named by absolute path, because `spawn("bash")` would otherwise resolve
  straight back to the launcher just rejected.
- The Microsoft Store App Execution Alias (`…\Microsoft\WindowsApps\bash.exe`) is the other WSL
  stub shape and is skipped the same way. Both are recognized by path rather than by probing,
  because probing would mean running `bash -lc` at resolution time — which sources a login profile
  that may be slow or interactive — and resolution happens once per process precisely so nothing
  pays a subprocess it does not need.
- This is a regression, not a long-standing condition: the same project's traces show 17 sessions
  on `bash` on 2026-09-08 and 9 on `powershell` by 2026-09-20.

## A Windows POSIX shell now inherits the user's PATH

- Fixing the above alone made things **worse**, and the test suite caught it: an MSYS2 bash does
  not inherit the Windows PATH unless its `/etc/profile` is told to, and that profile only
  consults `MSYS2_PATH_TYPE`. The same bash starts with 11 PATH entries — none of them the user's
  — so `node`, `npm`, `python` and `git` all answer "command not found". Git for Windows ships the
  variable in its own profile, which is exactly why its bash works and a stock MSYS2 one does not.
- `ShellInvocation` gained an optional `env`, merged over the caller's environment at spawn.
  A POSIX shell on Windows carries `MSYS2_PATH_TYPE=inherit`; PowerShell and `cmd` carry nothing,
  because they already inherit the PATH and the variable means nothing to them.
- Measured: the same `E:\msys64\usr\bin\bash.exe` sees 11 PATH entries and no `node` without the
  variable, and 87 entries with `node`, `npm`, `python` and `git` all resolving with it. This is a
  capability gain rather than a trade — the same shell, with the user's tools reachable — which is
  why it is set unconditionally rather than only when the chosen bash looks like MSYS2.
- PowerShell keeps working unchanged for the machines that reach it (an npm install with no
  bundled shell, or a PATH with no bash at all).

## The prompt says what it means about browsers and shells

- The browser rule was reworded so it **raises** verification quality instead of trading it away.
  The previous wording offered `curl` plus reading the markup as an equally good way to check a
  page you wrote, which can talk the model out of looking at the page at all. It now says to check
  what the machine already has — a system Chrome or Edge, or an already-installed Playwright — and
  render the page with it, because that is the only way to see what the user will see; markup
  reading is the fallback for a machine with no browser. The prohibition on installing one is
  unchanged and now carries its reason.
- A new tool-use rule: write the syntax of the shell named in the Environment section rather than
  spawning a second copy of it to run a snippet. Nesting re-parses the command before the inner
  shell sees it, so `powershell -Command "$x = 1"` reaches the inner shell with `$x` already
  expanded to nothing by the outer one — a script that looks correct dying on a syntax error the
  model cannot explain. A one-liner that gets unwieldy becomes a script file instead.

## Kernel

- The prompt tab moved; the version is unchanged, because it is already today's date. The
  superseded-hash record carries the old value, and the pre-toggles reconstruction was re-anchored
  alongside it.

## Tests

- `packages/core` covers the resolution cases: a real bash used when the WSL launcher shadows it
  (named absolutely), the bare name kept when the first match is already usable, the Store alias
  skipped, and the fall-through to PowerShell when every match is a stub.
- `packages/core` covers the PATH inheritance both ways: a unit assertion that the variable is set
  for a Windows POSIX shell and for nothing else, and a real spawn proving the user's tools are
  reachable with it — the assertion that distinguishes a capability gain from a capability trade.
