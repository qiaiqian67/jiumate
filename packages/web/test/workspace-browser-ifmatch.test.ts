/**
 * Contracts the in-place Markdown editor's conflict-detection path depends on:
 *
 *   1. `apiFetchWithMeta` surfaces the `ETag` from the response — the editor reads the
 *      server's weak ETag, holds it through the user's edit, and sends it back as
 *      `If-Match` on save. A null ETag (server didn't send one) is honored, never a
 *      made-up default.
 *   2. `apiFetchWithMeta` forwards the `headers` option through to fetch unchanged — the
 *      `If-Match` header is the load-bearing detail, and a missing entry in the merge
 *      would silently disable the conflict check.
 *   3. `uploadWorkspaceFile` echoes its `ifMatch` argument as `If-Match` on the request
 *      and returns the new ETag from the response — the editor then feeds that into the
 *      next save's `ifMatch` to keep the round-trip alive.
 *   4. `uploadWorkspaceFile` without an `ifMatch` does NOT send an `If-Match` header at
 *      all — callers that don't care about conflict detection (desktop import, scripted
 *      writes) should not pay the round-trip.
 *   5. A 409 file_conflict response surfaces as `ApiError(409, "file_conflict", ...)`.
 *      The workspace-browser turns that into a reload/overwrite modal — if the code is
 *      anything else, the wrong branch runs.
 *
 * Component-level 409→modal behavior is asserted in e2e/workspace-edit.spec.mjs; this
 * file stays in node so the server endpoint contract can change without DOM coupling.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetchWithMeta } from "../src/api/client";
import { uploadWorkspaceFile } from "../src/api/endpoints";

type FetchCall = { url: string; init: RequestInit | undefined };

let fetchMock: ReturnType<typeof vi.fn>;
let calls: FetchCall[];

beforeEach(() => {
  calls = [];
  // fetchMock is just a stub the test fills in via mockResolvedValue/mockImplementation.
  // The real fetch the SUT sees is the recorder wrapper, which always pushes to `calls`
  // and then forwards to the mock — so a test that does `fetchMock.mockResolvedValueOnce(...)`
  // still gets a `calls` entry, and a test that doesn't override anything gets a 204.
  fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  const recorder: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return fetchMock(input, init);
  };
  vi.stubGlobal("fetch", recorder);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function lastCall(): FetchCall {
  expect(calls.length, "no fetch call was made").toBeGreaterThan(0);
  return calls[calls.length - 1]!;
}

function headersOf(call: FetchCall): Record<string, string> {
  const h = new Headers(call.init?.headers ?? {});
  const out: Record<string, string> = {};
  h.forEach((v, k) => {
    out[k.toLowerCase()] = v;
  });
  return out;
}

describe("apiFetchWithMeta: ETag passthrough", () => {
  it("surfaces the response's ETag header on a 200 with body", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ETag: 'W/"1700000000123"', "Content-Type": "application/json" },
      }),
    );
    const { data, etag } = await apiFetchWithMeta<{ ok: boolean }>("/api/anything");
    expect(data.ok).toBe(true);
    expect(etag).toBe('W/"1700000000123"');
  });

  it("returns etag=null when the server omits the header (older / non-file routes)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const { etag } = await apiFetchWithMeta<{ ok: boolean }>("/api/anything");
    expect(etag).toBeNull();
  });

  it("surfaces etag on a 204 (the save response carries it without a body)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 204, headers: { ETag: 'W/"1700000000456"' } }),
    );
    const { data, etag } = await apiFetchWithMeta<void>("/api/save");
    expect(data).toBeUndefined();
    expect(etag).toBe('W/"1700000000456"');
  });

  it("forwards the `headers` option through to fetch — If-Match reaches the wire", async () => {
    await apiFetchWithMeta<void>("/api/save", {
      method: "PUT",
      body: { dataBase64: "AAA=" },
      headers: { "If-Match": 'W/"42"' },
    });
    expect(headersOf(lastCall())["if-match"]).toBe('W/"42"');
  });

  it("merges headers into the JSON Content-Type, not the other way around", async () => {
    await apiFetchWithMeta<void>("/api/save", {
      method: "PUT",
      body: { dataBase64: "AAA=" },
      headers: { "If-Match": 'W/"42"' },
    });
    const h = headersOf(lastCall());
    expect(h["content-type"]).toBe("application/json");
    expect(h["if-match"]).toBe('W/"42"');
  });

  it("does not synthesize an If-Match header when none was supplied", async () => {
    await apiFetchWithMeta<void>("/api/save", {
      method: "PUT",
      body: { dataBase64: "AAA=" },
    });
    expect(headersOf(lastCall())["if-match"]).toBeUndefined();
  });
});

describe("uploadWorkspaceFile: ETag round-trip", () => {
  it("PUTs the file at the right URL with dataBase64 and query=path", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 204, headers: { ETag: 'W/"100"' } }),
    );
    await uploadWorkspaceFile("sess-1", "docs/a.md", "aGVsbG8=");
    const call = lastCall();
    expect(call.url).toBe("/api/sessions/sess-1/files/content?path=docs%2Fa.md");
    expect(call.init?.method).toBe("PUT");
    const body = JSON.parse(String(call.init?.body));
    expect(body.dataBase64).toBe("aGVsbG8=");
  });

  it("forwards the ifMatch argument as If-Match and returns the response ETag", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 204, headers: { ETag: 'W/"1700000000999"' } }),
    );
    const newEtag = await uploadWorkspaceFile(
      "sess-1",
      "docs/a.md",
      "aGVsbG8=",
      'W/"1700000000123"',
    );
    expect(headersOf(lastCall())["if-match"]).toBe('W/"1700000000123"');
    expect(newEtag).toBe('W/"1700000000999"');
  });

  it("does not send an If-Match header when ifMatch is omitted (backward compat)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 204, headers: { ETag: 'W/"1"' } }),
    );
    const etag = await uploadWorkspaceFile("sess-1", "docs/a.md", "aGVsbG8=");
    expect(headersOf(lastCall())["if-match"]).toBeUndefined();
    expect(etag).toBe('W/"1"');
  });

  it("returns null etag when the server omits the ETag (older / non-file responses)", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const etag = await uploadWorkspaceFile("sess-1", "docs/a.md", "aGVsbG8=", 'W/"42"');
    expect(etag).toBeNull();
  });

  it("a 409 file_conflict response surfaces as ApiError(409, file_conflict)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: "file_conflict",
            message: "File changed on disk since you opened it.",
          },
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ),
    );
    await expect(
      uploadWorkspaceFile("sess-1", "docs/a.md", "aGVsbG8=", 'W/"42"'),
    ).rejects.toMatchObject({
      status: 409,
      code: "file_conflict",
      message: expect.stringContaining("File changed on disk"),
    } satisfies Partial<ApiError>);
  });

  it("a 400 bad_request (malformed If-Match) surfaces with status=400, code=bad_request", async () => {
    // A Response can only be read once — mockImplementation returns a fresh body per call,
    // so the second assertion sees the same JSON shape the first did.
    fetchMock.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            error: { code: "bad_request", message: "If-Match header must be a weak ETag" },
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        ),
    );
    await expect(
      uploadWorkspaceFile("sess-1", "docs/a.md", "aGVsbG8=", "garbage"),
    ).rejects.toBeInstanceOf(ApiError);
    await expect(
      uploadWorkspaceFile("sess-1", "docs/a.md", "aGVsbG8=", "garbage"),
    ).rejects.toMatchObject({ status: 400, code: "bad_request" });
  });

  it("a non-JSON 5xx still throws ApiError(http_error) — the modal does not crash on bad bodies", async () => {
    fetchMock.mockResolvedValueOnce(new Response("upstream exploded", { status: 502 }));
    await expect(
      uploadWorkspaceFile("sess-1", "docs/a.md", "aGVsbG8=", 'W/"42"'),
    ).rejects.toMatchObject({ status: 502, code: "http_error" });
  });
});
