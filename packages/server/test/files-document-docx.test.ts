/**
 * files/document-docx route tests — the write half of editing a Word document.
 *
 * The PandocService is injected through `BuildDepsOverrides`, so nothing here spawns a process. What
 * these pin is that the route sends **HTML** to Pandoc and writes what comes back, because that is
 * the property the whole design rests on: save and export run the same converter, so the file you
 * get from Save is the file you get from Export. They used to run different converters — save went
 * through a hand-written OOXML writer — and the two disagreed about the same text.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { Buffer } from "node:buffer";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createTestApp, provisionUser, apiClient } from "./helpers.js";
import type { ProjectCreateResponse, SessionCreateResponse } from "../src/api/types.js";
import { PandocService } from "../src/services/pandoc-service.js";
import type { PandocRunner } from "../src/services/pandoc-service.js";

describe("files/document-docx route (edited HTML → .docx)", () => {
  let t: Awaited<ReturnType<typeof createTestApp>>;
  let owner: ReturnType<typeof apiClient>;
  let sessionId: string;
  let workspace: string;
  let ownerCookie: string;
  let pandocCalls: { path: string; args: string[]; stdin: Buffer; timeoutMs: number }[];

  beforeEach(async () => {
    pandocCalls = [];
    const pandocRunner: PandocRunner = async (pandocPath, args, stdin, timeoutMs) => {
      pandocCalls.push({ path: pandocPath, args, stdin, timeoutMs });
      const outIndex = args.indexOf("-o");
      if (outIndex >= 0 && args[outIndex + 1]) {
        await fs.writeFile(args[outIndex + 1]!, Buffer.from("GENERATED-DOCX"));
      }
      return { exitCode: 0, timedOut: false, stdout: Buffer.from(""), stderr: "" };
    };
    const pandoc = new PandocService({ pandocPath: "/opt/pandoc", runner: pandocRunner });

    t = await createTestApp({ pandoc });
    const a = await provisionUser(t.app, "owner");
    ownerCookie = a.cookie;
    owner = apiClient(t.app, a.cookie);
    const created = (await (
      await owner.post("/api/projects", { projectId: "owner-docx", name: "project" })
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
    await fs.writeFile(path.join(workspace, "report.docx"), Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  });

  afterEach(async () => {
    await t.cleanup();
  });

  it("sends the editor's HTML to Pandoc and writes what it produces", async () => {
    const res = await owner.put(`/api/sessions/${sessionId}/files/document-docx?path=report.docx`, {
      html: "<h1>Edited</h1><p>body</p>",
      targetPath: "copy.docx",
    });
    expect(res.status).toBe(204);
    expect(pandocCalls).toHaveLength(1);
    const call = pandocCalls[0]!;
    expect(call.args.slice(0, 4)).toEqual(["-f", "html", "-t", "docx"]);
    expect(call.stdin.toString("utf8")).toBe("<h1>Edited</h1><p>body</p>");
    expect(await fs.readFile(path.join(workspace, "copy.docx"), "utf8")).toBe("GENERATED-DOCX");
  });

  it("requires html, not markdown", async () => {
    const res = await owner.put(`/api/sessions/${sessionId}/files/document-docx?path=report.docx`, {
      markdown: "# nope",
      targetPath: "copy.docx",
    });
    expect(res.status).toBe(400);
    expect(pandocCalls).toHaveLength(0);
  });

  it("refuses an existing target with no If-Match", async () => {
    await fs.writeFile(path.join(workspace, "other.docx"), Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    const res = await owner.put(`/api/sessions/${sessionId}/files/document-docx?path=report.docx`, {
      html: "<p>x</p>",
      targetPath: "other.docx",
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("file_exists");
    expect(pandocCalls).toHaveLength(0);
  });

  it("overwrites the original in place when the ETag matches, and refuses without one", async () => {
    // The read route is where the editor gets the version it will save under.
    const got = await owner.get(`/api/sessions/${sessionId}/files/content?path=report.docx`);
    const etag = got.headers.get("etag");
    expect(etag).toBeTruthy();

    const saveInPlace = (ifMatch?: string) =>
      t.app.request(`/api/sessions/${sessionId}/files/document-docx?path=report.docx`, {
        method: "PUT",
        headers: {
          cookie: ownerCookie,
          "content-type": "application/json",
          ...(ifMatch === undefined ? {} : { "if-match": ifMatch }),
        },
        body: JSON.stringify({ html: "<p>saved in place</p>", targetPath: "report.docx" }),
      });

    // The source exists, so an unversioned write is refused rather than clobbering it.
    expect((await saveInPlace()).status).toBe(409);

    expect((await saveInPlace(etag!)).status).toBe(204);
    expect(await fs.readFile(path.join(workspace, "report.docx"), "utf8")).toBe("GENERATED-DOCX");
  });
});
