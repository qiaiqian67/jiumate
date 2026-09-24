/**
 * pandoc-service.ts unit tests. The runner is injected (see BuildDepsOverrides.pandoc), so nothing
 * here ever spawns a process — every test scripts the runner's inputs and outcome.
 *
 * The output-file tests are the ones worth reading. Real Pandoc refuses to write a binary format to
 * stdout (`Cannot write docx output to stdout`) and exits 5, so the service hands it a path via `-o`
 * and reads the file back. These tests previously asserted `--output -` and returned canned bytes on
 * stdout, which is how the service came to ship an invocation that could not work: the test asserted
 * the implementation instead of the contract, and the contract is with a program the test never ran.
 * So the fake runner now behaves like Pandoc — it writes the `-o` path and leaves stdout empty — and
 * a service that went back to reading stdout would return nothing rather than passing.
 */
import { describe, expect, it } from "vitest";
import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { HttpError } from "../src/http/errors.js";
import { PandocService } from "../src/services/pandoc-service.js";
import type { PandocRunExit, PandocRunner } from "../src/services/pandoc-service.js";

/** A runner the test fully controls. */
function scriptedRunner(
  program: (
    pandocPath: string,
    args: string[],
    stdin: Buffer,
    timeoutMs: number,
  ) => Promise<PandocRunExit>,
): {
  runner: PandocRunner;
  calls: { path: string; args: string[]; stdin: Buffer; timeoutMs: number }[];
} {
  const calls: { path: string; args: string[]; stdin: Buffer; timeoutMs: number }[] = [];
  const runner: PandocRunner = async (path, args, stdin, timeoutMs) => {
    calls.push({ path, args, stdin, timeoutMs });
    return program(path, args, stdin, timeoutMs);
  };
  return { runner, calls };
}

/** The value `-o` names, or null when the invocation did not ask for a file. */
function outputPath(args: string[]): string | null {
  const index = args.indexOf("-o");
  return index >= 0 ? (args[index + 1] ?? null) : null;
}

/** A runner that behaves like Pandoc: it writes `bytes` to the `-o` path and prints nothing. */
function pandocLikeRunner(bytes: Buffer) {
  return scriptedRunner(async (_path, args) => {
    const target = outputPath(args);
    if (target !== null) await writeFile(target, bytes);
    return { exitCode: 0, timedOut: false, stdout: Buffer.from(""), stderr: "" };
  });
}

describe("PandocService.available", () => {
  it("is true when a binary path was injected", () => {
    const svc = new PandocService({ pandocPath: "/usr/bin/pandoc" });
    expect(svc.available).toBe(true);
  });

  it("is false when no binary was found at startup", () => {
    const svc = new PandocService({ pandocPath: null });
    expect(svc.available).toBe(false);
  });
});

describe("PandocService.version", () => {
  it("returns the first line of `pandoc --version`", async () => {
    const { runner } = scriptedRunner(async () => ({
      exitCode: 0,
      timedOut: false,
      stdout: Buffer.from("pandoc 3.1.11\nCompiled with...\n"),
      stderr: "",
    }));
    const svc = new PandocService({ pandocPath: "/usr/bin/pandoc", runner });
    expect(await svc.version()).toBe("pandoc 3.1.11");
  });

  it("returns null when the binary is unavailable", async () => {
    const svc = new PandocService({ pandocPath: null });
    expect(await svc.version()).toBe(null);
  });

  it("returns null on a non-zero exit (corrupt binary, wrong architecture, etc.)", async () => {
    const { runner } = scriptedRunner(async () => ({
      exitCode: 1,
      timedOut: false,
      stdout: Buffer.from(""),
      stderr: "fatal: cannot load",
    }));
    const svc = new PandocService({ pandocPath: "/usr/bin/pandoc", runner });
    expect(await svc.version()).toBe(null);
  });
});

describe("PandocService.exportHtmlTo", () => {
  it("throws 503 pandoc_unavailable when no binary was found", async () => {
    const svc = new PandocService({ pandocPath: null });
    await expect(svc.exportHtmlTo("<p>hi</p>", "docx")).rejects.toMatchObject({
      status: 503,
      code: "pandoc_unavailable",
    });
  });

  it("throws 400 invalid_format for unknown formats", async () => {
    const { runner } = scriptedRunner(async () => {
      throw new Error("runner should not be called for an invalid format");
    });
    const svc = new PandocService({ pandocPath: "/usr/bin/pandoc", runner });
    await expect(svc.exportHtmlTo("<p>hi</p>", "pdf" as unknown as "docx")).rejects.toMatchObject({
      status: 400,
      code: "invalid_format",
    });
  });

  it("asks Pandoc for an output file, and returns what it wrote there", async () => {
    const { runner, calls } = pandocLikeRunner(Buffer.from("DOCX-BYTES"));
    const svc = new PandocService({ pandocPath: "/opt/pandoc/3.1/pandoc", runner });
    const out = await svc.exportHtmlTo("<h1>hi</h1>", "docx");

    // The bytes come from the file, not from stdout — the fake runner leaves stdout empty, so
    // reading it would return nothing at all.
    expect(out.toString("utf8")).toBe("DOCX-BYTES");
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.path).toBe("/opt/pandoc/3.1/pandoc");
    expect(call.args.slice(0, 4)).toEqual(["-f", "html", "-t", "docx"]);
    // `-o <path>`, never `--output -`: Pandoc refuses a binary format on stdout.
    expect(outputPath(call.args)).toMatch(/export\.docx$/);
    expect(call.args).not.toContain("-");
    expect(call.stdin.toString("utf8")).toBe("<h1>hi</h1>");
    expect(call.timeoutMs).toBe(30_000);
  });

  it("accepts every supported format, each through an output file", async () => {
    for (const format of ["docx", "epub", "rtf", "txt"] as const) {
      const { runner, calls } = pandocLikeRunner(Buffer.from(`${format}-out`));
      const svc = new PandocService({ pandocPath: "/usr/bin/pandoc", runner });
      const out = await svc.exportHtmlTo("<p>x</p>", format);
      expect(out.toString("utf8")).toBe(`${format}-out`);
      expect(calls[0]!.args.slice(0, 4)).toEqual(["-f", "html", "-t", format]);
      expect(outputPath(calls[0]!.args)).toMatch(new RegExp(`export\\.${format}$`));
    }
  });

  it("leaves no output file behind", async () => {
    const { runner, calls } = pandocLikeRunner(Buffer.from("BYTES"));
    const svc = new PandocService({ pandocPath: "/usr/bin/pandoc", runner });
    await svc.exportHtmlTo("<p>x</p>", "docx");
    const dir = path.dirname(outputPath(calls[0]!.args)!);
    // The temporary directory is removed on the way out, so a conversion leaves nothing on disk.
    // `stat` is the check — `mkdtemp` would happily create a *new* directory beside the old name
    // and prove nothing.
    await expect(stat(dir)).rejects.toThrow();
    expect(dir.startsWith(tmpdir())).toBe(true);
  });

  it("leaves no output file behind when the conversion fails", async () => {
    const { runner, calls } = scriptedRunner(async () => ({
      exitCode: 23,
      timedOut: false,
      stdout: Buffer.from(""),
      stderr: "boom",
    }));
    const svc = new PandocService({ pandocPath: "/usr/bin/pandoc", runner });
    await expect(svc.exportHtmlTo("<p>x</p>", "docx")).rejects.toMatchObject({ status: 500 });
    // A failure is the case that would otherwise accumulate: one directory per failed export.
    await expect(stat(path.dirname(outputPath(calls[0]!.args)!))).rejects.toThrow();
  });

  it("honors a custom timeoutMs passed through the constructor", async () => {
    const { runner, calls } = pandocLikeRunner(Buffer.from(""));
    const svc = new PandocService({
      pandocPath: "/usr/bin/pandoc",
      runner,
      timeoutMs: 5_000,
    });
    await svc.exportHtmlTo("<p>x</p>", "docx");
    expect(calls[0]!.timeoutMs).toBe(5_000);
  });

  it("maps a timed-out run to 504 pandoc_timeout", async () => {
    const { runner } = scriptedRunner(async () => ({
      exitCode: -1,
      timedOut: true,
      stdout: Buffer.from(""),
      stderr: "killed",
    }));
    const svc = new PandocService({ pandocPath: "/usr/bin/pandoc", runner });
    await expect(svc.exportHtmlTo("<p>x</p>", "docx")).rejects.toMatchObject({
      status: 504,
      code: "pandoc_timeout",
    });
  });

  it("maps a spawn error to 500 pandoc_failed with the OS message", async () => {
    const { runner } = scriptedRunner(async () => ({
      exitCode: -1,
      timedOut: false,
      stdout: Buffer.from(""),
      stderr: "",
      spawnError: "ENOENT: no such file or directory",
    }));
    const svc = new PandocService({ pandocPath: "/missing/pandoc", runner });
    try {
      await svc.exportHtmlTo("<p>x</p>", "docx");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).status).toBe(500);
      expect((err as HttpError).code).toBe("pandoc_failed");
      expect((err as HttpError).message).toMatch(/ENOENT/);
    }
  });

  it("maps a non-zero exit to 500 pandoc_failed with the first 1KB of stderr", async () => {
    const longStderr = "x".repeat(4096);
    const { runner } = scriptedRunner(async () => ({
      exitCode: 23,
      timedOut: false,
      stdout: Buffer.from(""),
      stderr: longStderr,
    }));
    const svc = new PandocService({ pandocPath: "/usr/bin/pandoc", runner });
    try {
      await svc.exportHtmlTo("<p>x</p>", "docx");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).status).toBe(500);
      expect((err as HttpError).code).toBe("pandoc_failed");
      // Truncated to 1024 bytes of detail, not the full 4KB.
      expect((err as HttpError).message).toMatch(/^Pandoc exited 23: x{1024}$/);
    }
  });
});
