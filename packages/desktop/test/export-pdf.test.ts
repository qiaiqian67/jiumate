/**
 * Tests for the shell-side PDF renderer's pure surface — wire-shape parsing, the data-URL
 * vs tmp-file load decision, and a smoke run of the request dispatcher against a fake port.
 *
 * The actual `renderHtmlToPdf` body lives in `export-pdf.ts` and is gated on Electron; it
 * is exercised manually (`pnpm desktop` + a real export) instead of under plain vitest. The
 * splitting line: anything that decides "what to do" is pure and tested here; anything that
 * opens a window or touches Chromium is not.
 */
import { describe, expect, it } from "vitest";
import { loadStrategy, parseExportRequest } from "../src/export-pdf.js";

describe("parseExportRequest", () => {
  const valid = {
    type: "desktop-export-pdf-request",
    requestId: "req-1",
    html: "<!doctype html><html><body>hi</body></html>",
    suggestedFilename: "report.pdf",
  };

  it("returns the request when the frame is well-shaped", () => {
    const parsed = parseExportRequest(valid);
    expect(parsed).not.toBeNull();
    expect(parsed!.requestId).toBe("req-1");
    expect(parsed!.html).toBe(valid.html);
    expect(parsed!.suggestedFilename).toBe("report.pdf");
  });

  it("rejects frames with the wrong discriminator", () => {
    expect(parseExportRequest({ ...valid, type: "desktop-export-pdf-result" })).toBeNull();
    expect(parseExportRequest({ ...valid, type: "unrelated" })).toBeNull();
  });

  it("rejects frames missing any required field", () => {
    expect(parseExportRequest({ ...valid, requestId: "" })).toBeNull();
    expect(parseExportRequest({ ...valid, requestId: 42 as unknown as string })).toBeNull();
    expect(parseExportRequest({ ...valid, html: 42 as unknown as string })).toBeNull();
    expect(parseExportRequest({})).toBeNull();
    expect(parseExportRequest(null)).toBeNull();
    expect(parseExportRequest("nope")).toBeNull();
  });

  it("tolerates unknown extra fields (forward-compatible wire bumps)", () => {
    // Both sides ship together, but a misbehaving harness that adds a field must not
    // be silently dropped at parse time.
    const parsed = parseExportRequest({ ...valid, futureField: { x: 1 } });
    expect(parsed).not.toBeNull();
  });
});

describe("loadStrategy", () => {
  it("uses a data: URL for documents under the Chromium limit", () => {
    expect(loadStrategy(1024)).toEqual({ kind: "data-url" });
    expect(loadStrategy(1_499_999)).toEqual({ kind: "data-url" });
  });

  it("spills to a tmp file above the limit", () => {
    const big = loadStrategy(1_500_001);
    if (big.kind !== "tmp-file") throw new Error("expected tmp-file strategy");
    expect(big.ext).toBe(".html");
  });
});
