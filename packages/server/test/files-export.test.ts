/**
 * files/export route tests. The PandocService and DesktopExportPort are injected through
 * `BuildDepsOverrides`, so the test never spawns a process and never reaches the desktop
 * shell — the assertions cover auth, format validation, and dispatch (which service got
 * the request, with which bytes).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Buffer } from "node:buffer";
import { createTestApp, apiClient, provisionUser } from "./helpers.js";
import type { ProjectCreateResponse, SessionCreateResponse } from "../src/api/types.js";
import { DesktopExportPort } from "../src/services/desktop-export-port.js";
import { PandocService } from "../src/services/pandoc-service.js";
import type { PandocRunner } from "../src/services/pandoc-service.js";

describe("files/export route (workspace file → binary export)", () => {
  let t: Awaited<ReturnType<typeof createTestApp>>;
  let owner: ReturnType<typeof apiClient>;
  let outsider: ReturnType<typeof apiClient>;
  let sessionId: string;
  let workspace: string;

  // Scripted runners + the calls they saw, captured per test.
  let pandocCalls: { path: string; args: string[]; stdin: Buffer; timeoutMs: number }[];
  let portBytes: Buffer | null;
  let portError: string | null;

  beforeEach(async () => {
    pandocCalls = [];
    portBytes = null;
    portError = null;

    const pandocRunner: PandocRunner = async (path, args, stdin, timeoutMs) => {
      pandocCalls.push({ path, args, stdin, timeoutMs });
      // Behaves like Pandoc: the converted bytes go to the `-o` path, and stdout stays empty. The
      // route test therefore fails if the service ever goes back to reading stdout, which is what
      // shipped once — Pandoc refuses a binary format there and exits 5.
      const outIndex = args.indexOf("-o");
      if (outIndex >= 0 && args[outIndex + 1]) {
        await fs.writeFile(args[outIndex + 1]!, Buffer.from(`OUT-${args[args.indexOf("-t") + 1]}`));
      }
      return {
        exitCode: 0,
        timedOut: false,
        stdout: Buffer.from(""),
        stderr: "",
      };
    };
    const pandoc = new PandocService({ pandocPath: "/opt/pandoc", runner: pandocRunner });
    const port = new DesktopExportPort(() => {
      /* not used — overridden via port.send below */
    });
    port.printHtmlToPdf = async (html: string) => {
      if (portError !== null) {
        const e = new Error(portError) as Error & { status: number; code: string };
        e.status = 502;
        e.code = "pdf_render_failed";
        throw e;
      }
      return portBytes ?? Buffer.from("%PDF-1.4\n");
    };

    t = await createTestApp({ pandoc, desktopExportPort: port });
    const a = await provisionUser(t.app, "owner");
    const b = await provisionUser(t.app, "outsider");
    owner = apiClient(t.app, a.cookie);
    outsider = apiClient(t.app, b.cookie);
    const created = (await (
      await owner.post("/api/projects", { projectId: "owner-export", name: "project" })
    ).json()) as ProjectCreateResponse;
    const projectId = created.project.projectId;
    await owner.put(`/api/projects/${projectId}/models`, {
      defaultModel: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
      models: [{ provider: "anthropic", modelId: "claude-sonnet-4-6", contextWindow: 128000 }],
    });
    const sess = (await (
      await owner.post(`/api/projects/${projectId}/agents/default_agent/sessions`, {})
    ).json()) as SessionCreateResponse;
    sessionId = sess.session.sessionId;
    workspace = sess.session.workspace;
    await fs.writeFile(path.join(workspace, "report.md"), "# hello");
  });

  afterEach(async () => {
    await t.cleanup();
  });

  it("dispatches DOCX to Pandoc with the expected argv and returns the bytes", async () => {
    const res = await owner.post(`/api/sessions/${sessionId}/files/export`, {
      path: "report.md",
      format: "docx",
      html: "<h1>hi</h1>",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(res.headers.get("content-disposition")).toContain("attachment");
    expect(res.headers.get("content-disposition")).toContain("report.docx");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(pandocCalls).toHaveLength(1);
    const call = pandocCalls[0]!;
    expect(call.path).toBe("/opt/pandoc");
    expect(call.args.slice(0, 4)).toEqual(["-f", "html", "-t", "docx"]);
    // `-o <file>`, never `--output -`: Pandoc cannot write a binary format to stdout.
    expect(call.args[4]).toBe("-o");
    expect(call.args[5]).toMatch(/export\.docx$/);
    expect(call.stdin.toString("utf8")).toBe("<h1>hi</h1>");
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.toString("utf8")).toBe("OUT-docx");
  });

  it("returns a .docx source unchanged for format=docx, without calling Pandoc", async () => {
    // A Word document exported as Word is a copy, not a conversion. Sending the preview's HTML
    // through Pandoc produced a different document from the one on disk — the reason a preview and
    // its export could disagree. The bytes on disk are the better answer to "give me this file".
    const source = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5]); // PK zip magic + noise
    await fs.writeFile(path.join(workspace, "original.docx"), source);

    const res = await owner.post(`/api/sessions/${sessionId}/files/export`, {
      path: "original.docx",
      format: "docx",
      html: "<h1>this rendering must be ignored</h1>",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("original.docx");
    expect(Buffer.from(await res.arrayBuffer()).equals(source)).toBe(true);
    // The HTML is a rendering of the file; converting it would answer a different question.
    expect(pandocCalls).toHaveLength(0);
  });

  it("still converts a non-docx source to docx through Pandoc", async () => {
    const res = await owner.post(`/api/sessions/${sessionId}/files/export`, {
      path: "report.md",
      format: "docx",
      html: "<h1>hi</h1>",
    });
    expect(res.status).toBe(200);
    expect(pandocCalls).toHaveLength(1);
  });

  it("dispatches EPUB and RTF and TXT through the same Pandoc path", async () => {
    for (const format of ["epub", "rtf", "txt"] as const) {
      const res = await owner.post(`/api/sessions/${sessionId}/files/export`, {
        path: "report.md",
        format,
        html: "<p>x</p>",
      });
      expect(res.status).toBe(200);
      const call = pandocCalls.at(-1)!;
      expect(call.args.slice(0, 4)).toEqual(["-f", "html", "-t", format]);
      expect(call.args[4]).toBe("-o");
      expect(call.args[5]).toMatch(new RegExp(`export\\.${format}$`));
      expect(res.headers.get("content-type")).toMatch(/^(application|text)\//);
    }
  });

  it("dispatches PDF to the desktop export port and streams application/pdf", async () => {
    portBytes = Buffer.from("%PDF-1.4\n…binary…\n%%EOF");
    const res = await owner.post(`/api/sessions/${sessionId}/files/export`, {
      path: "report.md",
      format: "pdf",
      html: "<h1>hi</h1>",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain("report.pdf");
    expect(pandocCalls).toHaveLength(0); // PDF never reaches Pandoc.
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.toString("utf8")).toBe("%PDF-1.4\n…binary…\n%%EOF");
  });

  it("rejects an outsider with 404 (the same not-found-for-no-access pattern as other file routes)", async () => {
    const res = await outsider.post(`/api/sessions/${sessionId}/files/export`, {
      path: "report.md",
      format: "docx",
      html: "<h1>x</h1>",
    });
    expect(res.status).toBe(404);
    expect(pandocCalls).toHaveLength(0);
  });

  it("returns 400 for an unknown format", async () => {
    const res = await owner.post(`/api/sessions/${sessionId}/files/export`, {
      path: "report.md",
      format: "xlsx",
      html: "<h1>x</h1>",
    });
    expect(res.status).toBe(400);
    expect(pandocCalls).toHaveLength(0);
  });

  it("returns 413 for an html body above the 50MB cap", async () => {
    const big = "x".repeat(51 * 1024 * 1024);
    const res = await owner.post(`/api/sessions/${sessionId}/files/export`, {
      path: "report.md",
      format: "docx",
      html: big,
    });
    expect(res.status).toBe(413);
    expect(pandocCalls).toHaveLength(0);
  });

  it("returns 404 for a path that does not exist in the workspace", async () => {
    const res = await owner.post(`/api/sessions/${sessionId}/files/export`, {
      path: "missing.md",
      format: "docx",
      html: "<h1>x</h1>",
    });
    expect(res.status).toBe(404);
    expect(pandocCalls).toHaveLength(0);
  });
});
