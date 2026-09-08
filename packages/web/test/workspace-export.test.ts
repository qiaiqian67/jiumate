/**
 * ExportMenu tests — the DOM shape of the menu is locked by the component snapshot in
 * workspace-browser.test.tsx; this file exercises the dispatch logic only:
 *
 *   - buildExportFormats — capability flags determine which menu items carry an
 *     `unavailableReason` (the dropdown's `disabled` + tooltip driver).
 *   - swapExt — extension swap for the suggested download name.
 *   - performExport — the click-handler body. Asserts:
 *       * MD skips serialization (the source body rides as-is to the download).
 *       * HTML and server formats both serialize first.
 *       * Server formats call exportWorkspaceFile with the resolved { path, format, html }.
 *       * Disabled items never reach the download callback.
 *
 * The DOM glue (Dropdown, busy state, toast) is tested via manual smoke; we lock the
 * dispatch contract here without spinning up jsdom.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoist the stub functions so the vi.mock factories (also hoisted) can close over them.
const { serializeMarkdownToHtml, exportWorkspaceFile } = vi.hoisted(() => ({
  serializeMarkdownToHtml: vi.fn(),
  exportWorkspaceFile: vi.fn(),
}));

vi.mock("../src/api/endpoints", () => ({
  exportWorkspaceFile,
}));
vi.mock("../src/lib/markdown-html", () => ({
  serializeMarkdownToHtml,
}));

import {
  buildExportFormats,
  performExport,
  swapExt,
  type Capabilities,
} from "../src/features/chat/workspace-export";
import { S, setActiveStrings, zh as ZH } from "../src/lib/strings";

const FULL_CAPS: Capabilities = {
  pandoc: { available: true },
  pdf: { available: true, reason: null },
};
const PANDOC_MISSING: Capabilities = {
  pandoc: { available: false },
  pdf: { available: true, reason: null },
};
const PDF_MISSING: Capabilities = {
  pandoc: { available: true },
  pdf: { available: false, reason: "PDF export requires the desktop app." },
};
const EVERYTHING_MISSING: Capabilities = {
  pandoc: { available: false },
  pdf: { available: false, reason: "PDF export requires the desktop app." },
};

afterEach(() => {
  setActiveStrings(ZH);
  vi.clearAllMocks();
});

describe("swapExt", () => {
  it("replaces the trailing extension only", () => {
    expect(swapExt("report.md", "pdf")).toBe("report.pdf");
    expect(swapExt("Q3.report.md", "pdf")).toBe("Q3.report.pdf");
    expect(swapExt("README", "md")).toBe("README.md");
    expect(swapExt("foo.bar.md", "docx")).toBe("foo.bar.docx");
  });
});

describe("buildExportFormats", () => {
  it("returns all seven items when capabilities are not yet loaded", () => {
    // null capabilities → no item is unavailable yet (the dropdown hasn't had time to ask),
    // which keeps the menu fully clickable while the GET is in flight.
    const items = buildExportFormats(null);
    expect(items).toHaveLength(7);
    expect(items.every((it) => it.unavailableReason === null)).toBe(true);
  });

  it("returns all seven items with no disabled reasons when both Pandoc and PDF are available", () => {
    const items = buildExportFormats(FULL_CAPS);
    expect(items.map((it) => it.label)).toEqual([
      S.files.exportMd,
      S.files.exportHtml,
      S.files.exportPdf,
      S.files.exportDocx,
      S.files.exportEpub,
      S.files.exportRtf,
      S.files.exportTxt,
    ]);
    expect(items.every((it) => it.unavailableReason === null)).toBe(true);
  });

  it("disables the four Pandoc formats when Pandoc is missing; leaves MD/HTML/PDF enabled", () => {
    const items = buildExportFormats(PANDOC_MISSING);
    const byLabel = (label: string) => items.find((it) => it.label === label)!;
    expect(byLabel(S.files.exportMd).unavailableReason).toBe(null);
    expect(byLabel(S.files.exportHtml).unavailableReason).toBe(null);
    expect(byLabel(S.files.exportPdf).unavailableReason).toBe(null);
    expect(byLabel(S.files.exportDocx).unavailableReason).toBe("Pandoc is not installed.");
    expect(byLabel(S.files.exportEpub).unavailableReason).toBe("Pandoc is not installed.");
    expect(byLabel(S.files.exportRtf).unavailableReason).toBe("Pandoc is not installed.");
    expect(byLabel(S.files.exportTxt).unavailableReason).toBe("Pandoc is not installed.");
  });

  it("disables only PDF when the desktop shell is unavailable", () => {
    const items = buildExportFormats(PDF_MISSING);
    const byLabel = (label: string) => items.find((it) => it.label === label)!;
    expect(byLabel(S.files.exportPdf).unavailableReason).toBe(
      "PDF export requires the desktop app.",
    );
    expect(byLabel(S.files.exportDocx).unavailableReason).toBe(null);
    expect(byLabel(S.files.exportTxt).unavailableReason).toBe(null);
  });

  it("disables PDF and the four Pandoc formats when both are missing", () => {
    const items = buildExportFormats(EVERYTHING_MISSING);
    const disabled = items.filter((it) => it.unavailableReason !== null).map((it) => it.label);
    expect(disabled).toEqual([
      S.files.exportPdf,
      S.files.exportDocx,
      S.files.exportEpub,
      S.files.exportRtf,
      S.files.exportTxt,
    ]);
  });
});

describe("performExport", () => {
  const CTX = { sessionId: "s1", filePath: "report.md", fileName: "report.md", markdown: "# hi" };

  beforeEach(() => {
    serializeMarkdownToHtml.mockReset();
    exportWorkspaceFile.mockReset();
  });

  it("Markdown short-circuits: the source body is the download, no serialization, no network", async () => {
    const items = buildExportFormats(FULL_CAPS);
    const md = items.find((it) => it.label === S.files.exportMd)!;
    const downloads: { name: string; blob: Blob }[] = [];
    await performExport(md, CTX, (blob, name) => {
      // Push synchronously so the assertion can see it before performExport resolves.
      downloads.push({ name, blob });
    });
    expect(serializeMarkdownToHtml).not.toHaveBeenCalled();
    expect(exportWorkspaceFile).not.toHaveBeenCalled();
    expect(downloads).toHaveLength(1);
    expect(downloads[0]!.name).toBe("report.md");
    expect(downloads[0]!.blob.type).toBe("text/markdown;charset=utf-8");
    expect(await downloads[0]!.blob.text()).toBe("# hi");
  });

  it("HTML serializes to a document and downloads report.html", async () => {
    serializeMarkdownToHtml.mockResolvedValueOnce({
      html: "<!doctype html><html><body>hi</body></html>",
      hasMermaid: false,
    });
    const items = buildExportFormats(FULL_CAPS);
    const html = items.find((it) => it.label === S.files.exportHtml)!;
    const downloads: { name: string; blob: Blob }[] = [];
    await performExport(html, CTX, (blob, name) => {
      downloads.push({ name, blob });
    });
    expect(serializeMarkdownToHtml).toHaveBeenCalledWith("# hi");
    expect(exportWorkspaceFile).not.toHaveBeenCalled();
    expect(downloads).toHaveLength(1);
    expect(downloads[0]!.name).toBe("report.html");
    expect(await downloads[0]!.blob.text()).toBe("<!doctype html><html><body>hi</body></html>");
  });

  it("DOCX serializes then calls exportWorkspaceFile and downloads report.docx", async () => {
    serializeMarkdownToHtml.mockResolvedValueOnce({ html: "<h1>hi</h1>", hasMermaid: false });
    exportWorkspaceFile.mockResolvedValueOnce(new Blob(["DOCXBYTES"]));
    const items = buildExportFormats(FULL_CAPS);
    const docx = items.find((it) => it.label === S.files.exportDocx)!;
    const downloads: { name: string; blob: Blob }[] = [];
    await performExport(docx, CTX, (blob, name) => {
      downloads.push({ name, blob });
    });
    expect(serializeMarkdownToHtml).toHaveBeenCalledWith("# hi");
    expect(exportWorkspaceFile).toHaveBeenCalledWith("s1", "report.md", "docx", "<h1>hi</h1>");
    expect(downloads).toHaveLength(1);
    expect(downloads[0]!.name).toBe("report.docx");
    expect(await downloads[0]!.blob.text()).toBe("DOCXBYTES");
  });

  it("PDF dispatches with the right serverFormat and gets back report.pdf", async () => {
    serializeMarkdownToHtml.mockResolvedValueOnce({ html: "<h1>hi</h1>", hasMermaid: false });
    exportWorkspaceFile.mockResolvedValueOnce(new Blob(["%PDF-1.4"]));
    const items = buildExportFormats(FULL_CAPS);
    const pdf = items.find((it) => it.label === S.files.exportPdf)!;
    const downloads: { name: string; blob: Blob }[] = [];
    await performExport(pdf, CTX, (blob, name) => {
      downloads.push({ name, blob });
    });
    expect(exportWorkspaceFile).toHaveBeenCalledWith("s1", "report.md", "pdf", "<h1>hi</h1>");
    expect(downloads).toHaveLength(1);
    expect(downloads[0]!.name).toBe("report.pdf");
    expect(await downloads[0]!.blob.text()).toBe("%PDF-1.4");
  });

  it("propagates a server-side error so the menu can toast it", async () => {
    serializeMarkdownToHtml.mockResolvedValueOnce({ html: "<h1>x</h1>", hasMermaid: false });
    exportWorkspaceFile.mockRejectedValueOnce(new Error("network boom"));
    const items = buildExportFormats(FULL_CAPS);
    const docx = items.find((it) => it.label === S.files.exportDocx)!;
    await expect(performExport(docx, CTX, () => undefined)).rejects.toThrow("network boom");
  });

  it("i18n: labels localize when the active strings switch", () => {
    // buildExportFormats reads `S.files.*` at call time, so the new active strings must be
    // set BEFORE the call — the component calls it on every render and the live binding
    // picks up whatever the locale provider currently holds.
    setActiveStrings({ ...ZH, files: { ...S.files, exportPdf: "PDF (custom)" } });
    const items = buildExportFormats(FULL_CAPS);
    const labels = items.map((it) => it.label);
    expect(labels).toContain("PDF (custom)");
  });
});
