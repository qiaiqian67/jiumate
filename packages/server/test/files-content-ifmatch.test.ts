/**
 * ETag / If-Match conflict detection for the Workspace file save route. The in-place
 * Markdown editor reads a file, captures its ETag, and echoes it back as If-Match on save;
 * the server uses the mtime encoded in the ETag to reject writes that would clobber a
 * file the Agent has touched since the user opened it. The contract tested here:
 *
 *   1. GET /files/content surfaces an ETag derived from mtimeMs.
 *   2. PUT without If-Match still works (backward compat — desktop / scripted callers).
 *   3. PUT with a matching If-Match succeeds and returns a fresh ETag.
 *   4. PUT with a mismatched If-Match returns 409 file_conflict.
 *   5. PUT with If-Match on a file that has been deleted returns 409 (resurrection guard).
 *   6. PUT with a syntactically malformed If-Match returns 400 (never silently disable
 *      the conflict check by passing a parser-fail through).
 *   7. PUT with a non-existent path while supplying If-Match still returns 409, since the
 *      caller's expectation of a known version cannot be honored.
 *   8. Outsider PUTs are still rejected as 404 before any conflict logic runs.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProjectCreateResponse, SessionCreateResponse } from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const WEAK_ETAG = /^W\/"(-?\d+(?:\.\d+)?)"$/;

function parseEtag(value: string | null): number {
  expect(value, "response must carry an ETag header").not.toBeNull();
  const m = WEAK_ETAG.exec(value ?? "");
  expect(m, `ETag "${value}" is not a weak ETag of the expected shape`).not.toBeNull();
  return Number(m![1]);
}

/** PUT /files/content with optional If-Match. apiClient.put cannot set extra headers. */
async function putFile(
  t: TestApp,
  cookie: string,
  sessionId: string,
  rel: string,
  body: { dataBase64: string },
  ifMatch?: string,
): Promise<Response> {
  return t.app.request(`/api/sessions/${sessionId}/files/content?path=${encodeURIComponent(rel)}`, {
    method: "PUT",
    headers: {
      cookie,
      "content-type": "application/json",
      ...(ifMatch !== undefined ? { "If-Match": ifMatch } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function setupSession(): Promise<{
  t: TestApp;
  owner: ReturnType<typeof apiClient>;
  ownerCookie: string;
  sessionId: string;
  workspace: string;
}> {
  const t = await createTestApp();
  const a = await provisionUser(t.app, "owner");
  const owner = apiClient(t.app, a.cookie);
  const created = (await (
    await owner.post("/api/projects", { projectId: "owner-ifmatch", name: "project" })
  ).json()) as ProjectCreateResponse;
  const projectId = created.project.projectId;
  await owner.put(`/api/projects/${projectId}/models`, {
    defaultModel: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
    models: [{ provider: "anthropic", modelId: "claude-sonnet-4-6", contextWindow: 128000 }],
  });
  const sess = (await (
    await owner.post(`/api/projects/${projectId}/agents/default_agent/sessions`, {})
  ).json()) as SessionCreateResponse;
  const sessionId = sess.session.sessionId;
  const workspace = sess.session.workspace;
  await fs.writeFile(path.join(workspace, "note.md"), "# original\n");
  return { t, owner, ownerCookie: a.cookie, sessionId, workspace };
}

describe("files/content ETag + If-Match conflict detection", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let sessionId: string;
  let workspace: string;
  let ownerCookie: string;

  beforeEach(async () => {
    ({ t, owner, ownerCookie, sessionId, workspace } = await setupSession());
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("GET /files/content surfaces a weak ETag derived from the file's mtime", async () => {
    const res = await owner.get(`/api/sessions/${sessionId}/files/content?path=note.md`);
    expect(res.status).toBe(200);
    const mtimeMs = parseEtag(res.headers.get("etag"));
    const stat = await fs.stat(path.join(workspace, "note.md"));
    // Sub-second resolution may round; allow a 5ms window to absorb the fs write that ran
    // moments before. The contract is "ETag encodes this file's mtime", not "exact equality
    // with a wall-clock read taken in another call".
    expect(Math.abs(stat.mtimeMs - mtimeMs)).toBeLessThan(5);
  });

  it("PUT without If-Match: still works (backward compat) and returns a fresh ETag", async () => {
    const put = await putFile(t, ownerCookie, sessionId, "note.md", {
      dataBase64: Buffer.from("# edited\n").toString("base64"),
    });
    expect(put.status).toBe(204);
    expect(parseEtag(put.headers.get("etag"))).toBeGreaterThan(0);
    expect(await fs.readFile(path.join(workspace, "note.md"), "utf8")).toBe("# edited\n");
  });

  it("PUT with a matching If-Match: succeeds and returns a new ETag for the next round-trip", async () => {
    const got = await owner.get(`/api/sessions/${sessionId}/files/content?path=note.md`);
    const before = parseEtag(got.headers.get("etag"));

    const put = await putFile(
      t,
      ownerCookie,
      sessionId,
      "note.md",
      { dataBase64: Buffer.from("# saved with If-Match\n").toString("base64") },
      `W/"${before}"`,
    );
    expect(put.status).toBe(204);
    const after = parseEtag(put.headers.get("etag"));
    expect(after).toBeGreaterThan(0);
    expect(after).not.toBe(before); // the save wrote the file, so the new mtime differs

    // The new ETag matches a fresh GET — round-trip closure.
    const got2 = await owner.get(`/api/sessions/${sessionId}/files/content?path=note.md`);
    expect(parseEtag(got2.headers.get("etag"))).toBe(after);
  });

  it("PUT with a stale If-Match: 409 file_conflict, file is unchanged", async () => {
    const got = await owner.get(`/api/sessions/${sessionId}/files/content?path=note.md`);
    const stale = parseEtag(got.headers.get("etag")) - 1; // any value that won't match

    // The Agent (or another editor) writes to the file between the user's GET and PUT:
    // this is exactly the race the If-Match header exists to detect.
    await fs.writeFile(path.join(workspace, "note.md"), "# agent wrote this\n");

    const put = await putFile(
      t,
      ownerCookie,
      sessionId,
      "note.md",
      { dataBase64: Buffer.from("# user typed this\n").toString("base64") },
      `W/"${stale}"`,
    );
    expect(put.status).toBe(409);
    const body = (await put.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("file_conflict");
    expect(body.error.message.toLowerCase()).toContain("reload");
    // The on-disk content is whatever the Agent wrote — the rejected PUT must NOT have
    // overwritten it. This is the whole point.
    expect(await fs.readFile(path.join(workspace, "note.md"), "utf8")).toBe("# agent wrote this\n");
  });

  it("PUT with If-Match: * overwrites anyway — the conflict dialog's answer", async () => {
    const got = await owner.get(`/api/sessions/${sessionId}/files/content?path=note.md`);
    const stale = parseEtag(got.headers.get("etag")) - 1;

    // Same race as the test above: the Agent rewrote the file while the user had it open.
    await fs.writeFile(path.join(workspace, "note.md"), "# agent wrote this\n");

    // The dialog said the file moved on and asked; this is the user saying yes. The stale ETag
    // cannot express that — re-sending it is refused for the same reason the first attempt was,
    // so the dialog would reopen forever. `*` is the If-Match wildcard: overwrite whatever is
    // there. The check is opted out of explicitly, not silently.
    const put = await putFile(
      t,
      ownerCookie,
      sessionId,
      "note.md",
      { dataBase64: Buffer.from("# user typed this\n").toString("base64") },
      "*",
    );
    expect(put.status).toBe(204);
    expect(await fs.readFile(path.join(workspace, "note.md"), "utf8")).toBe("# user typed this\n");
  });

  it("PUT with If-Match on a deleted file: 409 file_conflict, file does not get resurrected", async () => {
    const got = await owner.get(`/api/sessions/${sessionId}/files/content?path=note.md`);
    const etag = parseEtag(got.headers.get("etag"));

    await fs.rm(path.join(workspace, "note.md"));

    const put = await putFile(
      t,
      ownerCookie,
      sessionId,
      "note.md",
      { dataBase64: Buffer.from("# resurrection\n").toString("base64") },
      `W/"${etag}"`,
    );
    expect(put.status).toBe(409);
    const body = (await put.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("file_conflict");
    expect(body.error.message.toLowerCase()).toContain("no longer exists");
    await expect(fs.access(path.join(workspace, "note.md"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("PUT with a malformed If-Match: 400, the conflict check is not silently disabled", async () => {
    const cases = [
      "no-quotes",
      '"12345"', // strong ETag — parser rejects
      `W/'12345'`, // single quotes — parser rejects
      `W/"not-a-number"`,
      `W/""`, // empty payload
      `W/`,
      "12345", // missing weak marker
    ];
    for (const malformed of cases) {
      const res = await putFile(
        t,
        ownerCookie,
        sessionId,
        "note.md",
        { dataBase64: Buffer.from("# x\n").toString("base64") },
        malformed,
      );
      expect(res.status, `expected 400 for If-Match: ${JSON.stringify(malformed)}`).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("bad_request");
    }
    // The original file must still be intact after every malformed attempt.
    expect(await fs.readFile(path.join(workspace, "note.md"), "utf8")).toBe("# original\n");
  });

  it("PUT with If-Match on a never-existed path: 409 (caller's version expectation cannot be honored)", async () => {
    const res = await putFile(
      t,
      ownerCookie,
      sessionId,
      "brand-new.md",
      { dataBase64: Buffer.from("# new\n").toString("base64") },
      'W/"1700000000000"',
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("file_conflict");
    // The file must NOT have been created — this guards against a force-save silently
    // resurrecting a path the user thought didn't exist (e.g. it had been removed while
    // their editor held a stale preview).
    await expect(fs.access(path.join(workspace, "brand-new.md"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("outsider PUT with a matching If-Match is still rejected as 404 (no access, no existence leak)", async () => {
    const b = await provisionUser(t.app, "outsider");
    const got = await owner.get(`/api/sessions/${sessionId}/files/content?path=note.md`);
    const etag = parseEtag(got.headers.get("etag"));
    const put = await putFile(
      t,
      b.cookie,
      sessionId,
      "note.md",
      { dataBase64: Buffer.from("# outsider\n").toString("base64") },
      `W/"${etag}"`,
    );
    expect(put.status).toBe(404);
    // File untouched — the conflict check never ran, ownership gates first.
    expect(await fs.readFile(path.join(workspace, "note.md"), "utf8")).toBe("# original\n");
  });
});
