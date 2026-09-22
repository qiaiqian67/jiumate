/**
 * Shell selection for command sessions.
 *
 * Commands run via `bash -lc <cmd>` wherever a bash exists. Neither platform guarantees one
 * — Windows has none by default, and a POSIX box can be launched with a PATH that has none —
 * so the resolver picks the best available shell once per process:
 *
 * 1. `LINSIGHT_SHELL` (explicit executable name or path) always wins, on every platform;
 *    the argument shape is inferred from its basename (see below).
 * 2. Otherwise, non-Windows uses `bash -lc` — but only after confirming a `bash` exists.
 *    A GUI-launched app inherits the desktop session's PATH, not a login shell's, and a
 *    trimmed session PATH (or a distribution that simply does not install bash) leaves
 *    `spawn("bash")` dying with ENOENT before the command runs at all. So: `bash` on
 *    PATH, then the usual absolute locations, then `$SHELL` when it is some other POSIX
 *    shell, then `sh`. The probe is a PATH walk, not a subprocess.
 * 3. On Windows, probe PATH for `bash` (a full Git for Windows install — best compatibility
 *    with the skill/prompt ecosystem, which is written for a POSIX shell). A `bash` that is
 *    the WSL launcher — under the Windows system directory, or the Store App Execution Alias
 *    under WindowsApps — is skipped: it runs commands inside a Linux distro with a different
 *    filesystem view (and fails outright when no distro is configured). Skipping means moving
 *    on to the next PATH match, not abandoning bash: System32 sits early in almost every PATH,
 *    so stopping at index 0 would discard a working Git/MSYS bash further down and drop the
 *    agent onto Windows PowerShell 5.1.
 * 4. Then `LINSIGHT_BUNDLED_SHELL` — the MinGit bash the Windows package ships (see the
 *    release workflow), advertised by the launcher shims as an absolute path. It comes
 *    *after* the PATH probe on purpose: a user's own Git for Windows carries the full MSYS
 *    userland (curl, tar, less, perl …), while MinGit carries ~60 core tools, so when both
 *    exist theirs is the better shell. This step is what makes the shell deterministic —
 *    without it, the same Agent and the same Skill behave differently on two Windows
 *    machines depending on what happens to be installed.
 * 5. Only then `pwsh` (PowerShell 7+), and finally `powershell` (Windows PowerShell 5.1,
 *    always present). These remain reachable for npm installs, which ship no bundle.
 *
 * Argument shapes by basename (also applied to `LINSIGHT_SHELL` values):
 * - `pwsh` / `powershell` -> `-NoLogo -NoProfile -Command <cmd>`
 * - `cmd`                 -> `/d /s /c <cmd>`
 * - anything else         -> `-lc <cmd>` (bash/zsh/sh-style login shell)
 *
 * `-lc` matters for the bundled shell: as a login shell it sources MinGit's `etc/profile`,
 * which defaults to `MSYS2_PATH_TYPE=inherit` and yields
 * `/mingw64/bin:/usr/local/bin:/usr/bin:/bin:<inherited Windows PATH>` — the bundled coreutils
 * and git first, the inherited Windows PATH still behind them, so System32's `curl.exe` and
 * `tar.exe` (which MinGit does not carry) keep resolving. Nothing has to plumb PATH by hand.
 *
 * The resolved shell's name is surfaced to the model via the session environment (the
 * `Shell:` line in the system prompt), so it knows which syntax the exec tool speaks.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/** A resolved shell invocation: `spawn(command, [...args, preamble + cmd])` runs `cmd` in that shell. */
export interface ShellInvocation {
  /** Executable name or absolute path handed to spawn(). */
  command: string;
  /** Fixed argument prefix placed before the command string. */
  args: string[];
  /** Short lowercase name (basename without extension), shown to the model (e.g. "bash", "pwsh"). */
  name: string;
  /**
   * Shell setup placed inside the command string, ahead of the caller's own command. Empty for
   * shells that need none.
   *
   * It exists for one thing: Windows PowerShell writes its output in the console's OEM code page
   * — GBK on a Chinese install — while the session decodes stdout as UTF-8, so every Chinese
   * path or message a command echoes arrives as mojibake (`目录` -> `Ŀ¼`). A model that cannot
   * read its own output cannot verify what it wrote, which in a real session is what pushed it
   * into screenshotting a page with a browser it then spent thirteen minutes installing.
   *
   * Setting the encoding here rather than decoding differently downstream is the load-bearing
   * choice: PowerShell also *decodes* a native command's output using the same setting, so this
   * fixes `node`/`git`/`curl` output in the same stroke. Decoding the pipe as GBK instead would
   * fix PowerShell's own formatting and corrupt every native command that emits UTF-8.
   */
  preamble: string;
  /**
   * Extra environment for the spawn, merged over the caller's own (see `envForShell`). Only a
   * POSIX shell on Windows has any: it must be told to inherit the user's PATH, or the user's
   * tools are invisible to it. Undefined when the shell needs nothing.
   */
  env?: Record<string, string>;
}

/** Injection points for unit tests; production callers use the defaults. */
export interface ResolveShellOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  /** Returns the PATH resolutions of an executable name, best match first ([] when not found). */
  whichAll?: (cmd: string) => string[];
  /** The Windows system root (to recognize the WSL bash launcher); default `env.SystemRoot` or C:\Windows. */
  systemRoot?: string;
  /** Existence probe for the bundled shell path (injected in tests); default `fs.existsSync`. */
  exists?: (filePath: string) => boolean;
}

/** Basename without a trailing .exe/.cmd/.bat/.ps1 extension, lowercased ("C:\...\pwsh.EXE" -> "pwsh"). */
function shellBasename(command: string): string {
  // path.win32 handles both separators, so LINSIGHT_SHELL=/usr/bin/zsh still yields "zsh".
  return path.win32
    .basename(command)
    .replace(/\.(exe|cmd|bat|ps1)$/i, "")
    .toLowerCase();
}

/**
 * Absolute POSIX locations to try when no `bash` is on PATH. A GUI launch can inherit a
 * PATH that omits the directory bash actually lives in, while the binary is right there.
 */
const POSIX_BASH_PATHS = [
  "/bin/bash",
  "/usr/bin/bash",
  "/usr/local/bin/bash",
  "/opt/homebrew/bin/bash",
];

/** POSIX shells worth falling back to, in the order they are tried, once bash is ruled out. */
const POSIX_FALLBACK_SHELLS = ["sh", "/bin/sh", "/usr/bin/sh"];

/**
 * Basenames `$SHELL` is allowed to name. It carries the login shell of whatever account the
 * server runs as, and on a service account that field is routinely `/usr/sbin/nologin` or
 * `/bin/false` — both exist, neither runs a command, and `-lc` would turn every command into
 * a silent non-zero exit. Membership here means "accepts `-lc <cmd>`"; anything else falls
 * through to `sh`, which does.
 */
const POSIX_LOGIN_SHELLS = new Set([
  "bash",
  "zsh",
  "fish",
  "ksh",
  "ksh93",
  "mksh",
  "dash",
  "ash",
  "sh",
]);

/** Argument prefix for a shell, chosen by its basename (PowerShell-style vs cmd vs POSIX-style). */
function argsForShell(name: string): string[] {
  if (name === "pwsh" || name === "powershell") return ["-NoLogo", "-NoProfile", "-Command"];
  if (name === "cmd") return ["/d", "/s", "/c"];
  return ["-lc"];
}

/**
 * Is this PATH match the WSL launcher rather than a real bash?
 *
 * Two shapes ship, and both are stubs that hand off to a Linux distro — a different filesystem
 * view, and an outright failure when no distro is installed:
 *
 * - `<SystemRoot>\System32\bash.exe` (or `Sysnative` under WOW64);
 * - the Microsoft Store App Execution Alias at `...\Microsoft\WindowsApps\bash.exe`.
 *
 * Matched by path rather than by probing, because probing would mean running `bash -lc` at
 * resolution time: that sources a login profile which may be slow or interactive, and the
 * resolver runs once per process precisely so nothing pays a subprocess it does not need.
 * A Git for Windows, MSYS2 or Cygwin bash lives under its own install directory, never under
 * either of these, so the check has no false positives in practice.
 */
function isWslBashLauncher(candidate: string, systemRoot: string): boolean {
  const lower = candidate.toLowerCase();
  if (lower.startsWith(systemRoot.toLowerCase() + path.win32.sep)) return true;
  const storeAlias = `${path.win32.sep}microsoft${path.win32.sep}windowsapps${path.win32.sep}`;
  return lower.includes(storeAlias);
}

/**
 * Output-encoding setup for a shell, chosen by its basename (see `ShellInvocation.preamble`).
 *
 * PowerShell needs both settings, and they are not the same knob: `[Console]::OutputEncoding`
 * governs what PowerShell itself writes, `$OutputEncoding` what it hands to a native command.
 * Measured on a Chinese Windows 11 box with stdio piped — the exact condition a command session
 * runs in, and the one where a console encoding setter is most likely to throw — the pair
 * converts `Ŀ¼: ������Դ` into `目录: 数据来源` while leaving the exit code, a native command's
 * stderr, and multi-line commands untouched.
 *
 * The trailing newline keeps the setup on its own line, so PowerShell's own error echo — which
 * prints the line an error came from — shows the user's command rather than the command welded
 * onto the encoding calls.
 *
 * `cmd.exe` gets `chcp 65001` for the same reason, though its own output is the only thing it
 * governs: a native command's bytes pass through untouched, so this is a partial fix where
 * PowerShell's is total. POSIX shells are UTF-8 already and get nothing.
 */
function preambleForShell(name: string): string {
  if (name === "pwsh" || name === "powershell") {
    return (
      "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; " +
      "$OutputEncoding=[System.Text.Encoding]::UTF8\n"
    );
  }
  if (name === "cmd") return "chcp 65001>nul\n";
  return "";
}

/** The one place an invocation is assembled, so no return path can forget the preamble. */
function invocation(command: string, name: string, platform: NodeJS.Platform): ShellInvocation {
  const env = envForShell(name, platform);
  return {
    command,
    args: argsForShell(name),
    name,
    preamble: preambleForShell(name),
    ...(env ? { env } : {}),
  };
}

/**
 * Extra environment a shell needs at spawn time, keyed on its basename.
 *
 * `MSYS2_PATH_TYPE=inherit` is the load-bearing one, and it is a capability fix rather than a
 * speed one. An MSYS2 or Cygwin bash does **not** inherit the Windows PATH unless its
 * `/etc/profile` is told to — and that profile only consults this variable. A stock
 * `E:\msys64\usr\bin\bash.exe` therefore starts with 11 PATH entries, none of them the user's,
 * and `node`, `npm`, `python` and `git` all come back "command not found"; measured on the same
 * machine, the same bash with this variable set sees 87 entries and resolves all four. Git for
 * Windows ships the variable in its own profile, which is exactly why its bash works and a
 * stock MSYS2 one does not — so without this, preferring one bash install over another would be
 * a capability trade rather than a preference.
 *
 * Harmless where nothing reads it, and scoped to Windows because that is the only place the
 * variable means anything.
 */
function envForShell(name: string, platform: NodeJS.Platform): Record<string, string> | undefined {
  if (platform !== "win32" || !POSIX_LOGIN_SHELLS.has(name)) return undefined;
  return { MSYS2_PATH_TYPE: "inherit" };
}

/**
 * Is `name` reachable as a bare command on this PATH? A plain directory walk — the POSIX
 * branch resolves at every process start and must not pay for a subprocess to do it.
 */
function onPath(name: string, env: NodeJS.ProcessEnv, exists: (p: string) => boolean): boolean {
  const raw = env.PATH ?? "";
  for (const dir of raw.split(path.posix.delimiter)) {
    // An empty entry means the working directory. Skipped deliberately: the Workspace is
    // model-writable, and picking a shell out of it would be an execution primitive.
    if (dir === "") continue;
    if (exists(path.posix.join(dir, name))) return true;
  }
  return false;
}

/**
 * The POSIX shell, in preference order. `bash` stays first and stays a *bare* name when
 * PATH has it, so the overwhelmingly common case is byte-identical to what shipped
 * before: the Skill and prompt ecosystem is written for bash, and the child resolves the
 * name against its own PATH. Everything after it exists so a box without bash degrades to
 * a working shell instead of an ENOENT on every single command.
 */
function resolvePosixShell(
  env: NodeJS.ProcessEnv,
  exists: (filePath: string) => boolean,
  platform: NodeJS.Platform,
): ShellInvocation {
  if (onPath("bash", env, exists)) return invocation("bash", "bash", platform);
  for (const candidate of POSIX_BASH_PATHS) {
    if (exists(candidate)) return invocation(candidate, "bash", platform);
  }
  // The user's own login shell, when it is one of the shells POSIX_LOGIN_SHELLS names (zsh,
  // fish, ksh …). It is named honestly to the model: `-lc` is what every one of them speaks,
  // but the syntax the model should write is that shell's, not bash's.
  const login = env.SHELL?.trim();
  if (login !== undefined && login.startsWith("/") && exists(login)) {
    const name = shellBasename(login);
    if (POSIX_LOGIN_SHELLS.has(name)) return invocation(login, name, platform);
  }
  for (const candidate of POSIX_FALLBACK_SHELLS) {
    if (candidate.startsWith("/") ? exists(candidate) : onPath(candidate, env, exists)) {
      return invocation(candidate, "sh", platform);
    }
  }
  // Nothing answered. Keep the historical invocation so the failure is the familiar one.
  return invocation("bash", "bash", platform);
}

/** Default PATH probe: `where` lists every match line by line, in PATH order (win32 only). */
function defaultWhichAll(cmd: string): string[] {
  try {
    const res = spawnSync("where", [cmd], {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    if (res.status !== 0 || !res.stdout) return [];
    return res.stdout
      .toString("utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}

/**
 * Resolves the shell for command sessions (pure given its options; see the module comment
 * for the order). Exported for unit tests; runtime code uses the cached `sessionShell()`.
 */
export function resolveShell(opts: ResolveShellOptions = {}): ShellInvocation {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;

  const explicit = env.LINSIGHT_SHELL?.trim();
  if (explicit) {
    const name = shellBasename(explicit);
    return invocation(explicit, name, platform);
  }

  const exists = opts.exists ?? existsSync;
  if (platform !== "win32") {
    return resolvePosixShell(env, exists, platform);
  }

  const whichAll = opts.whichAll ?? defaultWhichAll;
  const systemRoot = opts.systemRoot ?? env.SystemRoot ?? "C:\\Windows";
  // Every bash on PATH, best match first — not just the first. A PATH commonly carries the WSL
  // launcher (`<SystemRoot>\System32\bash.exe`, or its App Execution Alias under WindowsApps)
  // ahead of a perfectly good Git for Windows or MSYS2 bash, and System32 is early in almost
  // every PATH. Judging only index 0 therefore threw away the whole chain on a machine that had
  // two working bash installs: the agent silently ran Windows PowerShell 5.1 instead, with its
  // GBK output, its `$`-interpolation traps in nested `-Command` strings, and its verbosity.
  const bashes = whichAll("bash");
  const usable = bashes.findIndex((candidate) => !isWslBashLauncher(candidate, systemRoot));
  if (usable === 0) {
    // The first match is the one spawn("bash") resolves to anyway, so the bare name keeps this
    // byte-identical to what shipped before.
    return invocation("bash", "bash", platform);
  }
  if (usable > 0) {
    // A later match has to be named absolutely: spawn("bash") would resolve the bare name back
    // to the launcher we just rejected.
    return invocation(bashes[usable]!, "bash", platform);
  }
  // The bundled MinGit bash (installed-package layout only; absent for npm installs). Reported
  // to the model as "bash" rather than its filename: MinGit installs GNU bash under the name
  // `sh`, and the Skill ecosystem targets bash, so "sh" would understate what it can run.
  const bundled = env.LINSIGHT_BUNDLED_SHELL?.trim();
  if (bundled && exists(bundled)) {
    return invocation(bundled, "bash", platform);
  }
  if (whichAll("pwsh").length > 0) {
    return invocation("pwsh", "pwsh", platform);
  }
  return invocation("powershell", "powershell", platform);
}

let cached: ShellInvocation | null = null;

/** The process-wide shell for command sessions; resolved once (probing PATH costs a subprocess on Windows). */
export function sessionShell(): ShellInvocation {
  if (!cached) cached = resolveShell();
  return cached;
}
