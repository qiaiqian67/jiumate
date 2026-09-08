/**
 * postBinary.ts tests — verify the contract the export endpoint relies on:
 * success returns a Blob; non-2xx throws ApiError with the server's code and message;
 * network failure maps to ApiError with code "network_error".
 *
 * The server's `/api/sessions/:id/files/export` is the only caller today; future binary
 * endpoints (agent export, trace download) can use the same helper and inherit this contract.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, postBinary } from "../src/api/client";

/** Restore the real fetch after every test so a vi.stubGlobal leak does not poison the suite. */
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("postBinary", () => {
  it("returns the response body as a Blob on 2xx", async () => {
    const expected = new Blob(["%PDF-1.4 hello"], { type: "application/pdf" });
    globalThis.fetch = vi.fn(
      async () =>
        new Response(expected, { status: 200, headers: { "Content-Type": "application/pdf" } }),
    ) as unknown as typeof fetch;

    const blob = await postBinary("/api/test", { foo: "bar" });
    expect(blob).toBeInstanceOf(Blob);
    expect(await blob.text()).toBe("%PDF-1.4 hello");
  });

  it("throws ApiError carrying the server's error code on non-2xx", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: { code: "pandoc_failed", message: "Pandoc exited 23" } }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        ),
    ) as unknown as typeof fetch;

    await expect(postBinary("/api/test", {})).rejects.toMatchObject({
      status: 500,
      code: "pandoc_failed",
      message: "Pandoc exited 23",
    });
  });

  it("falls back to http_error and the localized unknown message when the body is not JSON", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response("not json", { status: 502, headers: { "Content-Type": "text/plain" } }),
    ) as unknown as typeof fetch;

    let caught: unknown;
    try {
      await postBinary("/api/test", {});
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(502);
    expect((caught as ApiError).code).toBe("http_error");
    expect((caught as ApiError).message.length).toBeGreaterThan(0);
  });

  it("maps a fetch network failure to ApiError 0/network_error", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;

    await expect(postBinary("/api/test", {})).rejects.toMatchObject({
      status: 0,
      code: "network_error",
    });
  });
});
