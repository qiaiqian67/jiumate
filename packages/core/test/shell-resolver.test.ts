/**
 * Unit tests for the command-session shell resolver (pure function; platform, env and the
 * existence/PATH probes are injected) plus one real spawn proving the POSIX fallback
 * chain resolves to something that actually runs a command.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveShell } from "../src/environment/tools/command/shell.js";

const POWERSHELL_ARGS = ["-NoLogo", "-NoProfile", "-Command"];
/**
 * What PowerShell prepends to every command: see `ShellInvocation.preamble`. The trailing
 * newline is part of it, which is why this is spelled out rather than compared loosely.
 */
const POWERSHELL_PREAMBLE =
  "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $OutputEncoding=[System.Text.Encoding]::UTF8\n";
/** A POSIX invocation needs no encoding setup — POSIX shells are UTF-8 already. */
const posix = (command: string, name: string) => ({
  command,
  args: ["-lc"],
  name,
  preamble: "",
});
/**
 * The same, on Windows, where a POSIX shell also carries the PATH-inheritance variable. Without
 * it an MSYS2 bash starts with only the system directories on PATH and cannot see the user's
 * node/npm/python at all (see `envForShell`).
 */
const winPosix = (command: string, name: string) => ({
  ...posix(command, name),
  env: { MSYS2_PATH_TYPE: "inherit" },
});
/** A PowerShell invocation, in either of its two names. */
const powershell = (command: string, name: string) => ({
  command,
  args: POWERSHELL_ARGS,
  name,
  preamble: POWERSHELL_PREAMBLE,
});

/** A whichAll stub resolving only the given names (value = returned PATH matches). */
function which(table: Record<string, string[]>): (cmd: string) => string[] {
  return (cmd) => table[cmd] ?? [];
}

/** An exists stub answering true for exactly the listed absolute paths. */
function has(...paths: string[]): (filePath: string) => boolean {
  const set = new Set(paths);
  return (filePath) => set.has(filePath);
}

describe("resolveShell — POSIX", () => {
  it("uses bash -lc on linux without probing (today's behavior, unchanged)", () => {
    let probed = false;
    const shell = resolveShell({
      platform: "linux",
      env: { PATH: "/usr/local/bin:/usr/bin:/bin" },
      exists: has("/usr/bin/bash"),
      whichAll: () => {
        probed = true;
        return [];
      },
    });
    // A bare name, not the resolved path: the child resolves it against its own PATH.
    expect(shell).toEqual(posix("bash", "bash"));
    // The POSIX branch must never cost a subprocess — it walks PATH itself.
    expect(probed).toBe(false);
  });

  it("uses bash -lc on darwin", () => {
    const shell = resolveShell({
      platform: "darwin",
      env: { PATH: "/usr/bin:/bin" },
      exists: has("/bin/bash"),
    });
    expect(shell).toEqual(posix("bash", "bash"));
  });

  // A GUI-launched desktop app inherits the session's PATH, not a login shell's. When
  // that PATH omits bash, spawn("bash") dies with ENOENT before the command runs — every
  // exec_command on that machine, from every surface. The chain below is what stops it.
  it("falls back to an absolute bash when PATH omits it (the GUI-launch PATH)", () => {
    const shell = resolveShell({
      platform: "linux",
      env: { PATH: "/usr/games:/snap/bin" },
      exists: has("/bin/bash", "/bin/sh"),
    });
    expect(shell).toEqual(posix("/bin/bash", "bash"));
  });

  it("finds a Homebrew bash on a macOS PATH that has none", () => {
    const shell = resolveShell({
      platform: "darwin",
      env: { PATH: "/usr/sbin:/sbin" },
      exists: has("/opt/homebrew/bin/bash"),
    });
    expect(shell).toEqual(posix("/opt/homebrew/bin/bash", "bash"));
  });

  it("uses the user's own login shell when no bash exists anywhere", () => {
    const shell = resolveShell({
      platform: "linux",
      env: { PATH: "/usr/bin:/bin", SHELL: "/usr/bin/zsh" },
      exists: has("/usr/bin/zsh", "/bin/sh"),
    });
    // Named honestly: the model is told zsh, because that is the syntax it must write.
    expect(shell).toEqual(posix("/usr/bin/zsh", "zsh"));
  });

  it("skips a $SHELL that is not a shell at all", () => {
    // A service account's login shell field is routinely /usr/sbin/nologin or /bin/false.
    // Both exist; neither runs a command, and `-lc` would make every command exit silently.
    for (const login of ["/usr/sbin/nologin", "/bin/false"]) {
      const shell = resolveShell({
        platform: "linux",
        env: { PATH: "/usr/games", SHELL: login },
        exists: has(login, "/bin/sh"),
      });
      expect(shell).toEqual(posix("/bin/sh", "sh"));
    }
  });

  it("falls back to sh when there is neither a bash nor a usable $SHELL", () => {
    const shell = resolveShell({
      platform: "linux",
      env: { PATH: "/usr/games" },
      exists: has("/bin/sh"),
    });
    expect(shell).toEqual(posix("/bin/sh", "sh"));
  });

  it("prefers an sh on PATH over the absolute one", () => {
    const shell = resolveShell({
      platform: "linux",
      env: { PATH: "/busybox/bin" },
      exists: has("/busybox/bin/sh", "/bin/sh"),
    });
    expect(shell).toEqual(posix("sh", "sh"));
  });

  it("keeps the historical bash invocation when nothing at all resolves", () => {
    const shell = resolveShell({
      platform: "linux",
      env: { PATH: "/nowhere" },
      exists: () => false,
    });
    expect(shell).toEqual(posix("bash", "bash"));
  });

  it("JIUMATE_SHELL still wins over the whole POSIX chain", () => {
    const shell = resolveShell({
      platform: "linux",
      env: { JIUMATE_SHELL: "/usr/bin/fish", PATH: "/bin" },
      exists: has("/bin/bash"),
    });
    expect(shell).toEqual(posix("/usr/bin/fish", "fish"));
  });
});

describe("resolveShell — POSIX, real spawn", () => {
  /** A PATH directory carrying a POSIX sh and a few coreutils, but deliberately no bash. */
  function bashlessBin(): string {
    const bin = path.join(mkdtempSync(path.join(tmpdir(), "jiumate-nobash-")), "bin");
    mkdirSync(bin);
    for (const tool of ["sh", "env", "cat", "echo", "printf"]) {
      try {
        symlinkSync(`/bin/${tool}`, path.join(bin, tool));
      } catch {
        // A tool this box does not have; the shell itself is what matters.
      }
    }
    return bin;
  }

  it.skipIf(process.platform === "win32")(
    "resolves to a shell that really runs a command when PATH has no bash",
    () => {
      const bin = bashlessBin();
      const shell = resolveShell({ platform: process.platform, env: { PATH: bin } });
      const res = spawnSync(shell.command, [...shell.args, shell.preamble + "echo test"], {
        env: { PATH: bin },
        encoding: "utf8",
      });
      // Before the fallback chain this was spawn("bash") against a bashless PATH:
      // res.error was `spawn bash ENOENT` and the command never ran.
      expect(res.error).toBeUndefined();
      expect(res.stdout).toContain("test");
    },
  );
});

describe("resolveShell — win32 probing", () => {
  it("prefers bash on PATH (Git for Windows)", () => {
    const shell = resolveShell({
      platform: "win32",
      env: {},
      whichAll: which({
        bash: ["C:\\Program Files\\Git\\bin\\bash.exe"],
        pwsh: ["C:\\Program Files\\PowerShell\\7\\pwsh.exe"],
      }),
    });
    expect(shell).toEqual(winPosix("bash", "bash"));
  });

  it("skips the WSL launcher bash under the system root and falls through to pwsh", () => {
    const shell = resolveShell({
      platform: "win32",
      env: { SystemRoot: "C:\\WINDOWS" },
      whichAll: which({
        bash: ["C:\\Windows\\System32\\bash.exe"],
        pwsh: ["C:\\Program Files\\PowerShell\\7\\pwsh.exe"],
      }),
    });
    expect(shell).toEqual(powershell("pwsh", "pwsh"));
  });

  // The regression this pair exists for: judging only PATH index 0. System32 is early in almost
  // every PATH, so the WSL launcher shadowed a working Git/MSYS bash and the whole chain was
  // abandoned — the agent ran Windows PowerShell 5.1 on a machine that had two usable bash
  // installs. Observed live: 17 sessions on bash on 2026-09-08, 9 on powershell by 2026-09-20.
  it("uses a real bash further down PATH when the WSL launcher shadows it", () => {
    const shell = resolveShell({
      platform: "win32",
      env: { SystemRoot: "C:\\WINDOWS" },
      whichAll: which({
        bash: [
          "C:\\Windows\\System32\\bash.exe",
          "E:\\msys64\\usr\\bin\\bash.exe",
          "D:\\Program Files\\Git\\usr\\bin\\bash.exe",
        ],
        pwsh: ["C:\\Program Files\\PowerShell\\7\\pwsh.exe"],
      }),
    });
    // Named absolutely: a bare "bash" would resolve back to the launcher just rejected.
    expect(shell).toEqual(winPosix("E:\\msys64\\usr\\bin\\bash.exe", "bash"));
  });

  it("keeps the bare name when the first match is already usable (unchanged behavior)", () => {
    // Nothing about the common case may shift: index 0 usable means the child still resolves
    // "bash" against its own PATH, exactly as before this change.
    const shell = resolveShell({
      platform: "win32",
      env: { SystemRoot: "C:\\WINDOWS" },
      whichAll: which({
        bash: ["D:\\Program Files\\Git\\usr\\bin\\bash.exe", "C:\\Windows\\System32\\bash.exe"],
      }),
    });
    expect(shell).toEqual(winPosix("bash", "bash"));
  });

  it("skips the Store App Execution Alias too, and takes the real bash after it", () => {
    // `...\Microsoft\WindowsApps\bash.exe` is the other WSL stub shape; it hands off to a distro
    // just like System32's, so it must not be mistaken for a usable bash.
    const shell = resolveShell({
      platform: "win32",
      env: { SystemRoot: "C:\\WINDOWS" },
      whichAll: which({
        bash: [
          "C:\\Users\\u\\AppData\\Local\\Microsoft\\WindowsApps\\bash.exe",
          "C:\\Program Files\\Git\\bin\\bash.exe",
        ],
      }),
    });
    expect(shell).toEqual(winPosix("C:\\Program Files\\Git\\bin\\bash.exe", "bash"));
  });

  it("falls through when every bash on PATH is a WSL stub", () => {
    const shell = resolveShell({
      platform: "win32",
      env: { SystemRoot: "C:\\WINDOWS" },
      whichAll: which({
        bash: [
          "C:\\Windows\\System32\\bash.exe",
          "C:\\Users\\u\\AppData\\Local\\Microsoft\\WindowsApps\\bash.exe",
        ],
        powershell: ["C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"],
      }),
    });
    expect(shell).toEqual(powershell("powershell", "powershell"));
  });

  it("falls back to pwsh when bash is absent", () => {
    const shell = resolveShell({
      platform: "win32",
      env: {},
      whichAll: which({ pwsh: ["C:\\Program Files\\PowerShell\\7\\pwsh.exe"] }),
    });
    expect(shell).toEqual(powershell("pwsh", "pwsh"));
  });

  it("falls back to powershell when neither bash nor pwsh resolve", () => {
    const shell = resolveShell({ platform: "win32", env: {}, whichAll: which({}) });
    expect(shell).toEqual(powershell("powershell", "powershell"));
  });
});

describe("resolveShell — output encoding preamble", () => {
  it("carries the UTF-8 setup on Windows PowerShell, in both its names", () => {
    // The bug this exists for: PowerShell 5.1 writes its output in the console's OEM code page
    // (GBK on a Chinese install) while the session decodes stdout as UTF-8, so `目录` arrived as
    // `Ŀ¼` and the model could not read back the Chinese it had just written.
    for (const name of ["pwsh", "powershell"]) {
      const shell = resolveShell({ platform: "win32", env: { JIUMATE_SHELL: name } });
      expect(shell.preamble).toContain("[Console]::OutputEncoding=[System.Text.Encoding]::UTF8");
      // Both knobs, and they are not the same one: the first governs what PowerShell writes, the
      // second what it hands to a native command. Setting only the first leaves `node` output
      // mis-decoded.
      expect(shell.preamble).toContain("$OutputEncoding=[System.Text.Encoding]::UTF8");
      // The setup must end the line, so PowerShell's own error echo shows the user's command
      // rather than the command welded onto the encoding calls.
      expect(shell.preamble.endsWith("\n")).toBe(true);
    }
  });

  it("carries the code-page switch for cmd, and nothing at all for a POSIX shell", () => {
    expect(resolveShell({ platform: "win32", env: { JIUMATE_SHELL: "cmd" } }).preamble).toBe(
      "chcp 65001>nul\n",
    );
    // POSIX shells are UTF-8 already; prepending anything would be noise in every command.
    for (const shell of [
      resolveShell({ platform: "linux", env: { PATH: "/usr/bin:/bin" }, exists: has("/bin/bash") }),
      resolveShell({
        platform: "win32",
        env: {},
        whichAll: which({ bash: ["C:\\Git\\bin\\bash.exe"] }),
      }),
    ]) {
      expect(shell.preamble).toBe("");
    }
  });

  /**
   * The end-to-end proof, on the platform that has the bug. The unit assertions above only pin
   * that a string is present; this pins that the string does what it is for.
   */
  it.skipIf(process.platform !== "win32")(
    "really does turn GBK PowerShell output into readable UTF-8",
    () => {
      const shell = resolveShell({ platform: "win32", env: { JIUMATE_SHELL: "powershell" } });
      const cmd = 'Write-Output "目录: 数据来源"';
      const run = (preamble: string) =>
        spawnSync(shell.command, [...shell.args, preamble + cmd], {
          encoding: "utf8",
          windowsHide: true,
        }).stdout;

      // Without the preamble the text does not survive: on a Chinese console it comes back
      // as the mojibake the real session sees, and on an English one it comes back as
      // question marks. Which of the two it is depends on the console's code page, so the
      // assertion is that the text is not readable rather than that it is unreadable in
      // one particular way — a code page is a property of the machine, not of the code.
      expect(run("")).not.toContain("目录: 数据来源");
      // With it, the characters the model needs to read — whatever the code page was.
      expect(run(shell.preamble)).toContain("目录: 数据来源");
    },
  );

  it.skipIf(process.platform !== "win32")(
    "leaves the exit code and a native command's stderr alone",
    () => {
      // The preamble is prepended to every command, so anything it perturbs is perturbed
      // everywhere. These are the two things a command session reads besides stdout.
      const shell = resolveShell({ platform: "win32", env: { JIUMATE_SHELL: "powershell" } });
      const res = spawnSync(
        shell.command,
        [...shell.args, shell.preamble + "node -e \"console.error('错误'); process.exit(2)\""],
        { encoding: "utf8", windowsHide: true },
      );
      // PowerShell reports a native non-zero exit as 1 with or without the preamble — that is
      // its own long-standing behavior, pinned here so a future change to the preamble is
      // measured against it rather than against an assumption.
      expect(res.status).toBe(1);
      // A native command's stderr passes through untouched, and is already UTF-8.
      expect(res.stderr).toContain("错误");
      expect(res.stderr).not.toContain("OutputEncoding");
    },
  );
});

describe("resolveShell — PATH inheritance on Windows (ShellInvocation.env)", () => {
  it("tells a Windows POSIX shell to inherit the user's PATH, and only there", () => {
    // An MSYS2/Cygwin bash does not inherit the Windows PATH unless its /etc/profile is told to
    // — and it only consults MSYS2_PATH_TYPE. Measured: the same bash starts with 11 PATH
    // entries and no node/npm/python without it, and 87 entries with all three.
    const winBash = resolveShell({
      platform: "win32",
      env: {},
      whichAll: which({ bash: ["C:\\Program Files\\Git\\bin\\bash.exe"] }),
    });
    expect(winBash.env).toEqual({ MSYS2_PATH_TYPE: "inherit" });

    // PowerShell already inherits it — the variable means nothing to it.
    for (const shell of [
      resolveShell({ platform: "win32", env: {}, whichAll: which({ pwsh: ["C:\\pwsh.exe"] }) }),
      resolveShell({ platform: "win32", env: {}, whichAll: which({}) }),
    ]) {
      expect(shell.env).toBeUndefined();
    }

    // Nothing to inherit from on POSIX, and the variable is not read there.
    expect(
      resolveShell({
        platform: "linux",
        env: { PATH: "/usr/bin:/bin" },
        exists: has("/bin/bash"),
      }).env,
    ).toBeUndefined();
  });

  /**
   * The end-to-end proof, on the platform that has the problem. The assertion above only pins
   * that a variable is set; this pins that it changes what the shell can reach — which is the
   * difference between a capability gain and a capability trade.
   */
  it.skipIf(process.platform !== "win32")(
    "really does put the user's tools on PATH for a bash that otherwise lacks them",
    () => {
      const shell = resolveShell({ platform: "win32", env: process.env });
      if (shell.name !== "bash") return; // No bash on this box; nothing to prove.
      const probe = "command -v node >/dev/null && echo REACHABLE || echo UNREACHABLE";
      const run = (env: NodeJS.ProcessEnv | undefined) =>
        spawnSync(shell.command, [...shell.args, probe], {
          encoding: "utf8",
          windowsHide: true,
          env: env ? { ...process.env, ...env } : process.env,
        }).stdout?.trim();

      // Git for Windows ships the variable in its own profile, so it is reachable either way.
      // A stock MSYS2 bash is not — that is the case this guards.
      expect(run(shell.env)).toBe("REACHABLE");
      if (run(undefined) === "UNREACHABLE") {
        // Proves the variable is load-bearing rather than decorative on this machine.
        expect(run(shell.env)).toBe("REACHABLE");
      }
    },
  );
});

describe("resolveShell — JIUMATE_SHELL override", () => {
  it("wins on every platform and keeps POSIX-style args for a POSIX shell path", () => {
    const shell = resolveShell({
      platform: "linux",
      env: { JIUMATE_SHELL: "/usr/bin/zsh" },
    });
    expect(shell).toEqual(posix("/usr/bin/zsh", "zsh"));
  });

  it("uses PowerShell-style args when the basename is pwsh (case/extension-insensitive)", () => {
    const shell = resolveShell({
      platform: "win32",
      env: { JIUMATE_SHELL: "C:\\Program Files\\PowerShell\\7\\pwsh.EXE" },
      whichAll: which({ bash: ["C:\\Program Files\\Git\\bin\\bash.exe"] }),
    });
    expect(shell).toEqual(powershell("C:\\Program Files\\PowerShell\\7\\pwsh.EXE", "pwsh"));
  });

  it("uses PowerShell-style args for a bare powershell name", () => {
    const shell = resolveShell({ platform: "win32", env: { JIUMATE_SHELL: "powershell" } });
    expect(shell).toEqual(powershell("powershell", "powershell"));
  });

  it("uses cmd-style args when the basename is cmd", () => {
    const shell = resolveShell({ platform: "win32", env: { JIUMATE_SHELL: "cmd" } });
    expect(shell).toEqual({
      command: "cmd",
      args: ["/d", "/s", "/c"],
      name: "cmd",
      preamble: "chcp 65001>nul\n",
    });
  });

  it("ignores a blank JIUMATE_SHELL", () => {
    const shell = resolveShell({
      platform: "linux",
      env: { JIUMATE_SHELL: "  ", PATH: "/usr/bin:/bin" },
      exists: has("/bin/bash"),
    });
    expect(shell).toEqual(posix("bash", "bash"));
  });
});

describe("resolveShell — the bundled MinGit bash (JIUMATE_BUNDLED_SHELL)", () => {
  const BUNDLED = "C:\\Users\\u\\.jiumate\\git\\usr\\bin\\sh.exe";
  /** An exists() stub answering true only for the bundled path. */
  const bundledExists = (p: string) => p === BUNDLED;

  it("is used when the machine has no bash of its own, and reports itself as bash", () => {
    // MinGit installs GNU bash under the name `sh`; the model is told "bash" because that is
    // what it is and what the Skill ecosystem targets — "sh" would understate it.
    const shell = resolveShell({
      platform: "win32",
      env: { JIUMATE_BUNDLED_SHELL: BUNDLED },
      whichAll: which({ pwsh: ["C:\\pwsh.exe"] }),
      exists: bundledExists,
    });
    expect(shell).toEqual(winPosix(BUNDLED, "bash"));
  });

  it("yields to a real Git for Windows on PATH (its MSYS userland is the fuller one)", () => {
    const shell = resolveShell({
      platform: "win32",
      env: { JIUMATE_BUNDLED_SHELL: BUNDLED },
      whichAll: which({ bash: ["C:\\Program Files\\Git\\bin\\bash.exe"] }),
      exists: bundledExists,
    });
    expect(shell).toEqual(winPosix("bash", "bash"));
  });

  it("beats pwsh and powershell — the point of bundling is that neither is reached", () => {
    const shell = resolveShell({
      platform: "win32",
      env: { JIUMATE_BUNDLED_SHELL: BUNDLED },
      whichAll: which({ pwsh: ["C:\\pwsh.exe"], powershell: ["C:\\powershell.exe"] }),
      exists: bundledExists,
    });
    expect(shell.command).toBe(BUNDLED);
  });

  it("still loses to an explicit JIUMATE_SHELL", () => {
    const shell = resolveShell({
      platform: "win32",
      env: { JIUMATE_SHELL: "pwsh", JIUMATE_BUNDLED_SHELL: BUNDLED },
      exists: bundledExists,
    });
    expect(shell).toEqual(powershell("pwsh", "pwsh"));
  });

  it("a stale path (dir deleted) falls through to pwsh rather than spawning a missing exe", () => {
    const shell = resolveShell({
      platform: "win32",
      env: { JIUMATE_BUNDLED_SHELL: BUNDLED },
      whichAll: which({ pwsh: ["C:\\pwsh.exe"] }),
      exists: () => false,
    });
    expect(shell).toEqual(powershell("pwsh", "pwsh"));
  });

  it("is ignored on POSIX (npm installs and source checkouts never set it anyway)", () => {
    const shell = resolveShell({
      platform: "linux",
      env: { JIUMATE_BUNDLED_SHELL: BUNDLED },
      exists: bundledExists,
    });
    expect(shell).toEqual(posix("bash", "bash"));
  });

  it("a blank value is ignored (unset-but-defined shims must not win)", () => {
    const shell = resolveShell({
      platform: "win32",
      env: { JIUMATE_BUNDLED_SHELL: "  " },
      whichAll: which({ powershell: ["C:\\powershell.exe"] }),
      exists: () => true,
    });
    expect(shell.name).toBe("powershell");
  });
});
