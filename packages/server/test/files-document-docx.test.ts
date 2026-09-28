/**
 * files/document-docx route tests — the write half of editing a Word document.
 *
 * These pin the property the whole design rests on: **the bytes arriving in the body are the
 * document**, and the route stores them. It used to receive HTML and hand it to Pandoc, which
 * rebuilt a .docx from it against the source as a style reference. That preserved the styles and
 * nothing else — every part Pandoc has no model for was reconstructed, and every save was a fresh
 * chance for the result to differ from the file the user had open. The editor now parses and
 * serializes OOXML in the browser, so the most important assertion here is the negative one: saving
 * must not convert, and must not reach for Pandoc at all.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { Buffer } from "node:buffer";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createTestApp, provisionUser, apiClient } from "./helpers.js";
import type { ProjectCreateResponse, SessionCreateResponse } from "../src/api/types.js";
import { PandocService } from "../src/services/pandoc-service.js";
import type { PandocRunner } from "../src/services/pandoc-service.js";

/** Stands in for a serialized document. Anything comparing bytes compares against this. */
const SAVED = Buffer.from("PK\u0003\u0004-SERIALIZED-DOCX-BYTES");

describe("files/document-docx route (the editor's bytes → the file)", () => {
  let t: Awaited<ReturnType<typeof createTestApp>>;
  let owner: ReturnType<typeof apiClient>;
  let sessionId: string;
  let workspace: string;
  let ownerCookie: string;
  let pandocCalls: { args: string[]; stdin: Buffer }[];

  beforeEach(async () => {
    pandocCalls = [];
    const pandocRunner: PandocRunner = async (_pandocPath, args, stdin) => {
      pandocCalls.push({ args, stdin });
      const outIndex = args.indexOf("-o");
      if (outIndex >= 0 && args[outIndex + 1]) {
        await fs.writeFile(args[outIndex + 1]!, Buffer.from("CONVERTED"));
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

  /** A save, with the bytes in the body and the paths where they belong. */
  const save = (opts: {
    source: string;
    target: string;
    bytes?: Buffer;
    ifMatch?: string;
  }) =>
    t.app.request(
      `/api/sessions/${sessionId}/files/document-docx?path=${encodeURIComponent(opts.source)}&target=${encodeURIComponent(opts.target)}`,
      {
        method: "PUT",
        headers: {
          cookie: ownerCookie,
          // The write guard admits a fixed list of content types and the .docx media type is not on
          // it — the client sends the generic binary one, so the tests do too.
          "content-type": "application/octet-stream",
          ...(opts.ifMatch === undefined ? {} : { "if-match": opts.ifMatch }),
        },
        body: opts.bytes ?? SAVED,
      },
    );

  it("stores the document's bytes unchanged, without converting them", async () => {
    const res = await save({ source: "report.docx", target: "copy.docx" });
    expect(res.status).toBe(204);
    expect(await fs.readFile(path.join(workspace, "copy.docx"))).toEqual(SAVED);
    // The regression this exists for: a save must not reach for Pandoc. It did, and the document
    // that came back was one Pandoc had rebuilt rather than the one the user edited.
    expect(pandocCalls).toHaveLength(0);
  });

  it("leaves the source alone when saving to a new name", async () => {
    const before = await fs.readFile(path.join(workspace, "report.docx"));
    const res = await save({ source: "report.docx", target: "copy.docx" });
    expect(res.status).toBe(204);
    expect(await fs.readFile(path.join(workspace, "report.docx"))).toEqual(before);
  });

  it("refuses an empty body", async () => {
    const res = await save({ source: "report.docx", target: "copy.docx", bytes: Buffer.alloc(0) });
    expect(res.status).toBe(400);
    expect(pandocCalls).toHaveLength(0);
  });

  it("requires a target", async () => {
    const res = await t.app.request(
      `/api/sessions/${sessionId}/files/document-docx?path=report.docx`,
      {
        method: "PUT",
        headers: { cookie: ownerCookie, "content-type": "application/octet-stream" },
        body: SAVED,
      },
    );
    expect(res.status).toBe(400);
  });

  it("refuses a target that is not a .docx", async () => {
    const res = await save({ source: "report.docx", target: "copy.md" });
    expect(res.status).toBe(400);
  });

  it("refuses an existing target with no If-Match", async () => {
    await fs.writeFile(path.join(workspace, "other.docx"), Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    const res = await save({ source: "report.docx", target: "other.docx" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("file_exists");
  });

  it("overwrites the original in place when the ETag matches, and refuses without one", async () => {
    // The read route is where the editor gets the version it will save under.
    const got = await owner.get(`/api/sessions/${sessionId}/files/content?path=report.docx`);
    const etag = got.headers.get("etag");
    expect(etag).toBeTruthy();

    // The source exists, so an unversioned write is refused rather than clobbering it.
    expect((await save({ source: "report.docx", target: "report.docx" })).status).toBe(409);

    expect(
      (await save({ source: "report.docx", target: "report.docx", ifMatch: etag! })).status,
    ).toBe(204);
    expect(await fs.readFile(path.join(workspace, "report.docx"))).toEqual(SAVED);
  });

  it("treats If-Match: * as the overwrite the conflict dialog promised", async () => {
    // The wildcard is what the user answering "overwrite anyway" sends. Re-sending the stale ETag
    // instead is what made the dialog reopen forever.
    expect(
      (await save({ source: "report.docx", target: "report.docx", ifMatch: "*" })).status,
    ).toBe(204);
    expect(await fs.readFile(path.join(workspace, "report.docx"))).toEqual(SAVED);
  });
});
