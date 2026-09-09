/**
 * desktop-export-port.ts unit tests. The shell is replaced with a scripted sender and a
 * fake `port.on("message", ...)`; no Electron, no real PDF rendering.
 */
import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
  DesktopExportPort,
  parseExportResult,
  type ShellPort,
} from "../src/services/desktop-export-port.js";
import type { DesktopExportRequest } from "../src/api/desktop-export.js";

/** A scripted `parentPort`: the test pushes `message` events into it, observes sent frames. */
function fakePort(): { port: ShellPort; sent: unknown[]; emit: (data: unknown) => void } {
  const sent: unknown[] = [];
  let listener: ((e: { data: unknown }) => void) | null = null;
  const port: ShellPort = {
    on: (_event, l) => {
      listener = l;
    },
    postMessage: (m) => {
      sent.push(m);
    },
  };
  return {
    port,
    sent,
    emit: (data) => {
      if (listener === null) throw new Error("no listener registered");
      listener({ data });
    },
  };
}

describe("parseExportResult", () => {
  it("accepts a well-formed result with bytes", () => {
    const r = parseExportResult({
      type: "desktop-export-pdf-result",
      requestId: "abc",
      bytes: Buffer.from("PDF"),
    });
    expect(r?.requestId).toBe("abc");
    expect(Buffer.isBuffer(r?.bytes)).toBe(true);
  });

  it("accepts a well-formed error result", () => {
    const r = parseExportResult({
      type: "desktop-export-pdf-result",
      requestId: "abc",
      error: "boom",
    });
    expect(r?.error).toBe("boom");
  });

  it("rejects a wrong type", () => {
    expect(parseExportResult({ type: "other", requestId: "abc" })).toBe(null);
  });

  it("rejects a missing requestId", () => {
    expect(parseExportResult({ type: "desktop-export-pdf-result" })).toBe(null);
  });

  it("rejects non-buffer / non-string error payloads", () => {
    expect(
      parseExportResult({ type: "desktop-export-pdf-result", requestId: "x", bytes: 42 }),
    ).toBe(null);
    expect(
      parseExportResult({ type: "desktop-export-pdf-result", requestId: "x", error: { msg: 1 } }),
    ).toBe(null);
  });
});

describe("DesktopExportPort.printHtmlToPdf", () => {
  it("sends a request and resolves with the bytes the shell returns", async () => {
    const { port, sent, emit } = fakePort();
    const p = new DesktopExportPort((msg) => port.postMessage(msg));
    p.attachMessageListener(port);

    const promise = p.printHtmlToPdf("<h1>hi</h1>", "report.pdf");
    expect(sent).toHaveLength(1);
    const req = sent[0] as DesktopExportRequest;
    expect(req.type).toBe("desktop-export-pdf-request");
    expect(req.html).toBe("<h1>hi</h1>");
    expect(req.suggestedFilename).toBe("report.pdf");
    expect(typeof req.requestId).toBe("string");

    emit({
      type: "desktop-export-pdf-result",
      requestId: req.requestId,
      bytes: Buffer.from("%PDF-1.4\n"),
    });
    await expect(promise).resolves.toEqual(Buffer.from("%PDF-1.4\n"));
    expect(p.inflightCount()).toBe(0);
  });

  it("rejects with 502 pdf_render_failed when the shell reports an error", async () => {
    const { port, sent, emit } = fakePort();
    const p = new DesktopExportPort((msg) => port.postMessage(msg));
    p.attachMessageListener(port);

    const promise = p.printHtmlToPdf("<h1>x</h1>", "x.pdf");
    const req = sent[0] as DesktopExportRequest;
    emit({ type: "desktop-export-pdf-result", requestId: req.requestId, error: "print failed" });
    await expect(promise).rejects.toMatchObject({ status: 502, code: "pdf_render_failed" });
  });

  it("rejects with 502 when the shell returns neither bytes nor error", async () => {
    const { port, sent, emit } = fakePort();
    const p = new DesktopExportPort((msg) => port.postMessage(msg));
    p.attachMessageListener(port);

    const promise = p.printHtmlToPdf("<h1>x</h1>", "x.pdf");
    const req = sent[0] as DesktopExportRequest;
    emit({ type: "desktop-export-pdf-result", requestId: req.requestId });
    await expect(promise).rejects.toMatchObject({ status: 502, code: "pdf_render_failed" });
  });

  it("ignores results for unknown requestIds (e.g. a stale shell reply)", async () => {
    const { port, emit } = fakePort();
    const p = new DesktopExportPort((msg) => port.postMessage(msg));
    p.attachMessageListener(port);

    emit({ type: "desktop-export-pdf-result", requestId: "ghost", bytes: Buffer.from("x") });
    expect(p.inflightCount()).toBe(0);
  });

  it("rejects with 504 pdf_render_timeout if the shell never responds", async () => {
    const { port } = fakePort();
    // 50ms deadline keeps the test under a second; the production default is 30s and
    // would otherwise pin the test runner until the timer fired.
    const p = new DesktopExportPort((msg) => port.postMessage(msg), 50);
    p.attachMessageListener(port);

    await expect(p.printHtmlToPdf("<h1>x</h1>", "x.pdf")).rejects.toMatchObject({
      status: 504,
      code: "pdf_render_timeout",
    });
    expect(p.inflightCount()).toBe(0);
  });
});
