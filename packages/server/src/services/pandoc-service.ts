/**
 * Pandoc-backed HTML→{DOCX, EPUB, RTF, plain text} exporter.
 *
 * Pandoc is the standard Markdown↔DOCX/EPUB/RTF converter and the only path to high-quality
 * Word output from GFM-with-mermaid/tables. The web app pre-renders Mermaid to inline SVG and
 * KaTeX to HTML, then posts the resulting self-contained HTML here; we just pass it to Pandoc
 * on stdin and stream the binary out. The server has no Markdown or HTML pipeline of its own
 * — keeping the conversion logic on the client side avoids a second `unified`/`rehype-stringify`
 * stack and keeps KaTeX/Mermaid font and CSS choices in one place (the web app).
 *
 * `runner` is injected so tests can substitute a scripted implementation through
 * `BuildDepsOverrides.pandoc` (the same pattern as `UpdateJobService` and `UpdateRunner`,
 * see services/update-job.ts:120-160). The default runner follows the spawn-with-timeout
 * pattern from `spawnUpdateRunner`: SIGTERM on deadline, SIGKILL 10s later, timer unref'd so
 * the timeout itself never holds the process open.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { HttpError } from "../http/errors.js";

/** Formats the service knows how to emit. The export route enforces this same set. */
export type PandocFormat = "docx" | "epub" | "rtf" | "txt";

const SUPPORTED_FORMATS: readonly PandocFormat[] = ["docx", "epub", "rtf", "txt"] as const;

/** A single Pandoc invocation's outcome. Mirrors `UpdateRunExit` so tests feel familiar. */
export interface PandocRunExit {
  /** Process exit code, or -1 if it died without one (spawn error / signal). */
  exitCode: number;
  /** True when the deadline fired and the process was killed. */
  timedOut: boolean;
  /** Captured stdout (the converted document bytes for `exportHtmlTo`). */
  stdout: Buffer;
  /** Captured stderr, kept short — Pandoc reports parse errors here. */
  stderr: string;
  /** Spawn-time error (binary not found, no permission); absent on a clean exit. */
  spawnError?: string;
}

export type PandocRunner = (
  pandocPath: string,
  args: string[],
  stdin: Buffer,
  timeoutMs: number,
) => Promise<PandocRunExit>;

const DEFAULT_TIMEOUT_MS = 30_000;

export const spawnPandocRunner: PandocRunner = (pandocPath, args, stdin, timeoutMs) =>
  new Promise((resolve) => {
    const child = spawn(pandocPath, args, { stdio: ["pipe", "pipe", "pipe"] });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.stdin.on("error", () => {
      // EPIPE happens when Pandoc reads less than we write (e.g. parse error before the
      // first byte); swallow so the close handler can report the real exit code.
    });
    child.stdin.end(stdin);

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      // Same backstop as the update runner — a SIGTERM-ignoring child cannot strand the
      // server, and unref so the timer itself doesn't pin the event loop.
      setTimeout(() => child.kill("SIGKILL"), 10_000).unref();
    }, timeoutMs);
    timer.unref();

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        exitCode: -1,
        timedOut: false,
        stdout: Buffer.concat(stdoutChunks),
        stderr: stderrChunks.map((c) => c.toString("utf8")).join(""),
        spawnError: err.message,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code ?? -1,
        timedOut,
        stdout: Buffer.concat(stdoutChunks),
        stderr: stderrChunks.map((c) => c.toString("utf8")).join(""),
      });
    });
  });

/** Sentinel — the desktop installer ships no Pandoc and the dev box has none installed. */
const PANDOC_UNAVAILABLE = "pandoc_unavailable";

export class PandocService {
  /**
   * `pandocPath` is the resolved absolute path to the `pandoc` binary, or `null` when no
   * binary was found at startup. The constructor never probes — detection happens once in
   * `buildAppDeps`, and the result is injected here so the service is testable without
   * `child_process` mocks.
   */
  constructor(
    private readonly opts: {
      pandocPath: string | null;
      runner?: PandocRunner;
      timeoutMs?: number;
    },
  ) {}

  /** Memoized answer to `referenceDocFlag`, which costs a `pandoc --version` spawn to compute. */
  private referenceFlag: string | undefined;

  /** True iff a binary path was resolved at startup. Mirrored on the client as a capabilities flag. */
  get available(): boolean {
    return this.opts.pandocPath !== null;
  }

  /**
   * `pandoc --version` first line ("pandoc 3.1.11\n..."). Returns `null` when Pandoc is
   * unavailable or fails to start — the version is informational, surfaced via the
   * capabilities endpoint, and never blocks an export.
   */
  async version(): Promise<string | null> {
    if (!this.opts.pandocPath) return null;
    const r = await this.runOnce(this.opts.pandocPath, ["--version"], Buffer.alloc(0), 5_000);
    if (r.exitCode !== 0) return null;
    return r.stdout.toString("utf8").split("\n", 1)[0]?.trim() ?? null;
  }

  /**
   * Convert an HTML string to a binary document. The Pandoc input format is fixed to `html`; the
   * output format comes from `format`. The MIME / extension mapping lives in the route — keeping it
   * here would duplicate knowledge the route already needs.
   *
   * **The output goes to a temporary file, not to stdout.** Pandoc refuses to write a binary
   * format to stdout — `Cannot write docx output to stdout. Specify an output file using the -o
   * option.` — and exits 5. docx and epub are both zip containers, so both are binary; rtf and txt
   * are not, but every format takes the same path so that the difference cannot be forgotten. It
   * was forgotten once: `--output -` was there from the start and the injected test runner returned
   * canned bytes, so no test ever asked real Pandoc to do it.
   *
   * `referenceDocx` is the document the output should look like. Pandoc's writer takes every
   * paragraph's formatting from named styles (`Heading1`, `FirstParagraph`, ...), and those styles
   * come from the reference file — so passing the document being edited is what keeps its fonts,
   * colours and table borders across a save. Without it every save quietly replaced the document's
   * design with Pandoc's default, which is how the preview and the export came to look like two
   * different documents. Only docx output has a reference.
   *
   * Errors:
   * - 503 when no Pandoc is configured.
   * - 400 for a format outside `SUPPORTED_FORMATS`.
   * - 504 on timeout, 500 on a spawn failure or a non-zero exit (stderr is truncated — a Pandoc
   *   parse error quotes the document, and this is a service, not a place to keep user text).
   */
  async exportHtmlTo(
    html: string,
    format: PandocFormat,
    opts?: { referenceDocx?: Buffer },
  ): Promise<Buffer> {
    if (!this.opts.pandocPath) {
      throw new HttpError(503, PANDOC_UNAVAILABLE, "Pandoc is not installed on this server.");
    }
    if (!SUPPORTED_FORMATS.includes(format)) {
      throw new HttpError(400, "invalid_format", `Unsupported format: ${format}`);
    }
    const timeoutMs = this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    // A private directory per call, so two concurrent exports cannot collide on a file name and
    // the output never appears anywhere a workspace could serve it from. It is also where the
    // reference document goes, which is why it is per-call: two saves of two documents must not
    // share a reference.
    const dir = await mkdtemp(path.join(tmpdir(), "linsight-pandoc-"));
    const outPath = path.join(dir, `export.${format}`);
    const args = ["-f", "html", "-t", format, "-o", outPath];
    if (format === "docx" && opts?.referenceDocx) {
      const referencePath = path.join(dir, "reference.docx");
      await writeFile(referencePath, opts.referenceDocx);
      args.push(await this.referenceDocFlag(), referencePath);
    }
    try {
      const r = await this.runOnce(
        this.opts.pandocPath,
        args,
        Buffer.from(html, "utf8"),
        timeoutMs,
      );
      if (r.timedOut) {
        throw new HttpError(504, "pandoc_timeout", "Pandoc took too long to convert the document.");
      }
      if (r.spawnError) {
        throw new HttpError(500, "pandoc_failed", `Could not start pandoc: ${r.spawnError}`);
      }
      if (r.exitCode !== 0) {
        const detail = r.stderr.slice(0, 1024) || "(no stderr)";
        throw new HttpError(500, "pandoc_failed", `Pandoc exited ${r.exitCode}: ${detail}`);
      }
      return await readFile(outPath);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /**
   * Which flag names the reference document, for the Pandoc in front of us.
   *
   * Pandoc 1.x called it `--reference-docx`; 2.0 renamed it to `--reference-doc` and dropped the old
   * spelling. Both are "the .docx whose styles the output inherits", so the choice is made from the
   * version rather than by trying one and retrying — a retry would run Pandoc twice on every save,
   * and the first attempt's failure would have to be told apart from a real one.
   *
   * Cached on the instance: `version()` spawns a process, and the answer cannot change under a
   * running server. An unparseable version falls to the legacy flag, because the only binaries that
   * fail to report a version are the old ones this exists for.
   */
  private async referenceDocFlag(): Promise<string> {
    if (this.referenceFlag !== undefined) return this.referenceFlag;
    const version = await this.version();
    const major = /(\d+)\./.exec(version ?? "")?.[1];
    this.referenceFlag =
      major !== undefined && Number(major) >= 2 ? "--reference-doc" : "--reference-docx";
    return this.referenceFlag;
  }

  private async runOnce(path: string, args: string[], stdin: Buffer, timeoutMs: number) {
    const runner = this.opts.runner ?? spawnPandocRunner;
    return runner(path, args, stdin, timeoutMs);
  }
}
