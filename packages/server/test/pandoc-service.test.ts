/**
 * pandoc-service.ts unit tests. The runner is injected (see BuildDepsOverrides.pandoc), so
 * nothing here ever spawns a process — every test scripts the runner's inputs and outcome.
 */
import { describe, expect, it } from "vitest";
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

  it("invokes the runner with -f html -t <format> --output - and pipes HTML on stdin", async () => {
    const { runner, calls } = scriptedRunner(async () => ({
      exitCode: 0,
      timedOut: false,
      stdout: Buffer.from("DOCX-BYTES"),
      stderr: "",
    }));
    const svc = new PandocService({ pandocPath: "/opt/pandoc/3.1/pandoc", runner });
    const out = await svc.exportHtmlTo("<h1>hi</h1>", "docx");
    expect(out.toString("utf8")).toBe("DOCX-BYTES");
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.path).toBe("/opt/pandoc/3.1/pandoc");
    expect(call.args).toEqual(["-f", "html", "-t", "docx", "--output", "-"]);
    expect(call.stdin.toString("utf8")).toBe("<h1>hi</h1>");
    expect(call.timeoutMs).toBe(30_000);
  });

  it("accepts every supported format", async () => {
    for (const format of ["docx", "epub", "rtf", "txt"] as const) {
      const { runner, calls } = scriptedRunner(async () => ({
        exitCode: 0,
        timedOut: false,
        stdout: Buffer.from(`${format}-out`),
        stderr: "",
      }));
      const svc = new PandocService({ pandocPath: "/usr/bin/pandoc", runner });
      const out = await svc.exportHtmlTo("<p>x</p>", format);
      expect(out.toString("utf8")).toBe(`${format}-out`);
      expect(calls[0]!.args).toEqual(["-f", "html", "-t", format, "--output", "-"]);
    }
  });

  it("honors a custom timeoutMs passed through the constructor", async () => {
    const { runner, calls } = scriptedRunner(async () => ({
      exitCode: 0,
      timedOut: false,
      stdout: Buffer.from(""),
      stderr: "",
    }));
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
