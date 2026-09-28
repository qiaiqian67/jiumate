/**
 * Behavior tests for atomicWriteFile — the writer behind every Harness state file: the
 * replacement leaves no temp file behind on either path, `mode` lands exactly (the umask does
 * not mask it), and the symlink question is answered both ways, since the state files follow a
 * link into a dotfiles repository while the model-writable Memory directory deliberately does
 * not.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { atomicWriteFile } from "../src/internal/atomic-write.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "jiumate-atomic-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("atomicWriteFile", () => {
  it("creates a file and replaces its content, leaving no temp file behind", async () => {
    const file = path.join(dir, "system_config.yaml");
    await atomicWriteFile(file, "first\n");
    expect(await readFile(file, "utf8")).toBe("first\n");

    await atomicWriteFile(file, "second\n");
    expect(await readFile(file, "utf8")).toBe("second\n");
    expect(await readdir(dir)).toEqual(["system_config.yaml"]);
  });

  it("writes bytes as given when the content is not a string", async () => {
    const file = path.join(dir, "bundle.webz");
    await atomicWriteFile(file, new Uint8Array([0x1f, 0x8b, 0x00, 0xff]));
    expect([...(await readFile(file))]).toEqual([0x1f, 0x8b, 0x00, 0xff]);
  });

  it("leaves the previous content and no temp file when the write fails", async () => {
    const file = path.join(dir, "keep.toml");
    await atomicWriteFile(file, "kept\n");
    const aborted = AbortSignal.abort();
    await expect(atomicWriteFile(file, "lost\n", { signal: aborted })).rejects.toThrow();
    expect(await readFile(file, "utf8")).toBe("kept\n");
    expect(await readdir(dir)).toEqual(["keep.toml"]);
  });

  it.skipIf(process.platform === "win32")(
    "applies mode to a new and to an existing file, unmasked by the umask",
    async () => {
      const file = path.join(dir, ".vault.toml");
      await atomicWriteFile(file, "A = 'x'\n", { mode: 0o600 });
      expect((await lstat(file)).mode & 0o777).toBe(0o600);

      // Rename replaces the inode, so a file that was world-readable before converges to 0600.
      await chmod(file, 0o644);
      await atomicWriteFile(file, "A = 'y'\n", { mode: 0o600 });
      expect((await lstat(file)).mode & 0o777).toBe(0o600);
    },
  );

  it.skipIf(process.platform === "win32")(
    "replaces a symlink standing at the target by default",
    async () => {
      const outside = path.join(dir, "outside.md");
      const link = path.join(dir, "MEMORY.md");
      await writeFile(outside, "untouched\n", "utf8");
      await symlink(outside, link);

      await atomicWriteFile(link, "index\n");
      expect((await lstat(link)).isSymbolicLink()).toBe(false);
      expect(await readFile(link, "utf8")).toBe("index\n");
      expect(await readFile(outside, "utf8")).toBe("untouched\n");
    },
  );

  it.skipIf(process.platform === "win32")(
    "writes through a symlink when asked, keeping the link",
    async () => {
      const real = path.join(dir, "dotfiles", "zshrc");
      const link = path.join(dir, ".zshrc");
      await mkdir(path.dirname(real), { recursive: true });
      await writeFile(real, "old\n", "utf8");
      await symlink(real, link);

      await atomicWriteFile(link, "new\n", { followSymlinks: true });
      expect((await lstat(link)).isSymbolicLink()).toBe(true);
      expect(await readFile(real, "utf8")).toBe("new\n");
    },
  );

  it.skipIf(process.platform === "win32")(
    "follows a symlink chain that ends at a file which does not exist yet",
    async () => {
      const target = path.join(dir, "absent.yaml");
      const middle = path.join(dir, "middle.yaml");
      const link = path.join(dir, "GOAL.yaml");
      await symlink(target, middle);
      await symlink("middle.yaml", link);

      await atomicWriteFile(link, "objective: x\n", { followSymlinks: true });
      expect(await readFile(target, "utf8")).toBe("objective: x\n");
      expect((await lstat(link)).isSymbolicLink()).toBe(true);
      expect((await lstat(middle)).isSymbolicLink()).toBe(true);
    },
  );
});

/**
 * The locked-target retry.
 *
 * Windows refuses `rename` over a file another process holds open, with a bare `EPERM` that is
 * indistinguishable from a permissions problem. In a real session, three of sixteen `edit_file`
 * calls died that way — the user was viewing the page they were asking the agent to edit. These
 * tests drive the condition directly rather than imitating it, so what they pin is the retry
 * itself: that a lock which clears is ridden out, and that one which does not is reported as
 * what it is.
 *
 * Windows-only, because the condition is. A POSIX rename over a file that is open succeeds, so
 * there is nothing to retry and no failure to assert.
 */
describe.skipIf(process.platform !== "win32")("atomicWriteFile against a locked target", () => {
  /** Hold `file` open with sharing disabled, the way a viewer or a scanner does. */
  async function holdOpen(file: string, seconds: number): Promise<() => Promise<void>> {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `$fs=[System.IO.File]::Open('${file.replace(/'/g, "''")}','Open','Read','None'); ` +
          `Write-Output 'HELD'; Start-Sleep -Seconds ${String(seconds)}; $fs.Close()`,
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    // The handle has to exist before the write is attempted, or the test races its own setup.
    await new Promise<void>((resolve) => child.stdout.once("data", () => resolve()));
    return async () => {
      child.kill();
      await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    };
  }

  it("rides out a lock that clears, and lands the write", async () => {
    const file = path.join(dir, "page.html");
    await writeFile(file, "original\n", "utf8");
    const release = await holdOpen(file, 1);

    // The lock clears well inside the retry budget, so the write succeeds rather than failing.
    const writing = atomicWriteFile(file, "replaced\n");
    // Release after the first retry has already been burned, so the retry is what saves it.
    await new Promise((resolve) => setTimeout(resolve, 120));
    await release();

    await expect(writing).resolves.toBeUndefined();
    expect(await readFile(file, "utf8")).toBe("replaced\n");
    expect(await readdir(dir)).toEqual(["page.html"]);
  }, 30_000);

  it("names the cause instead of a bare EPERM when the lock never clears", async () => {
    const file = path.join(dir, "page.html");
    await writeFile(file, "original\n", "utf8");
    const release = await holdOpen(file, 30);

    try {
      // The retries run out in under a second; a 30-second lock outlives every one of them.
      const err = await atomicWriteFile(file, "never\n").then(
        () => null,
        (e: unknown) => e as Error,
      );
      expect(err).not.toBeNull();
      // The message has to name the actual condition: a reader told only "EPERM" reaches for a
      // chmod, which cannot help.
      expect(err!.message).toContain("holding it open");
      expect(err!.message).toContain("unchanged");
      // And it must not pretend to be a permissions failure.
      expect(err!.message).not.toContain("EACCES");
    } finally {
      await release();
    }

    // The failed write left the previous content, and no temp file, behind.
    expect(await readFile(file, "utf8")).toBe("original\n");
    expect(await readdir(dir)).toEqual(["page.html"]);
  }, 30_000);
});
