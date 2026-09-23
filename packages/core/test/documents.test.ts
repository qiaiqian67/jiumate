/**
 * Document extraction, against real files.
 *
 * The fixtures under `test/fixtures/` were produced by the libraries everyone else uses to write
 * these formats — python-docx, openpyxl, python-pptx, reportlab — and committed, so the suite
 * needs nothing installed. That matters more here than usual: every one of the assertions below
 * was written *after* running the extractor against the file, and four of them were failing at the
 * time. A hand-built fixture would have confirmed my own reading of OOXML and caught none of it.
 *
 * The four, because each is the kind of thing that silently produces plausible wrong output:
 *
 * - **docx tables came out as raw HTML.** Turndown's GFM rules `keep` any table whose first row is
 *   not all-`<th>`, and mammoth emits `<td>` for a Word table's header row. A model reading raw
 *   HTML in a Markdown tool result is worse off than one reading nothing.
 * - **pptx returned the wrong slide order.** PowerPoint reorders by rewriting `p:sldIdLst`, leaving
 *   the filenames alone, so walking `slide1.xml`, `slide2.xml`, ... scrambles any deck that has
 *   been reordered. The fixture is deliberately built that way.
 * - **odt lost its document structure.** Parsing XML into an object groups repeated siblings, so
 *   the headings arrived together and the paragraphs arrived together, with no record of which
 *   came between which.
 * - **odt paragraphs vanished entirely.** ODF puts text in a direct string child, not a nested
 *   element, so looking for an inner element finds nothing.
 *
 * A fifth was found by the pdf fixture: pdf.js refuses a `standardFontDataUrl` without a trailing
 * forward slash, including on Windows, where a native path would end in a backslash.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DocumentExtractError,
  buildDocumentPreview,
  documentFormatOf,
  extractDocumentFromPath,
  renderExtraction,
  type DocumentFormat,
} from "../src/documents/index.js";

const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

const extract = async (name: string) => {
  const bytes = await readFile(path.join(fixtureDir, name));
  return extractDocumentFromPath(name, bytes);
};

const render = async (name: string) => renderExtraction(await extract(name));

describe("documentFormatOf", () => {
  it.each([
    ["report.docx", "docx"],
    ["a/b/c.PDF", "pdf"],
    ["a\\b\\c.pptx", "pptx"],
    ["sheet.xlsx", "xlsx"],
    ["notes.odt", "odt"],
  ])("reads %s as %s", (filePath, expected) => {
    expect(documentFormatOf(filePath)).toBe(expected);
  });

  it.each(["readme.md", "script.ts", "archive.zip", "noextension", "legacy.doc", "legacy.xls"])(
    "does not claim %s",
    (filePath) => {
      expect(documentFormatOf(filePath)).toBeNull();
    },
  );
});

describe("docx", () => {
  it("keeps headings, paragraphs and bullets", async () => {
    const result = await extract("sample.docx");
    const markdown = renderExtraction(result);
    expect(markdown).toContain("# Quarterly Report");
    expect(markdown).toContain("Revenue grew across every region this quarter, with the strongest");
    expect(markdown).toContain("## Highlights");
    expect(markdown).toContain("Revenue up 18% year over year");
  });

  // The regression described in the file header: a table has to arrive as a table, not as the
  // HTML the converter would otherwise pass through untouched.
  it("renders a table as Markdown rather than passing HTML through", async () => {
    const markdown = await render("sample.docx");
    expect(markdown).not.toContain("<table");
    expect(markdown).not.toContain("<td");
    expect(markdown).toContain("| Region | Revenue | Growth |");
    expect(markdown).toContain("| APAC | 4.2M | 24% |");
  });

  it("says that embedded images were dropped", async () => {
    const markdown = await render("sample.docx");
    expect(markdown).toContain("embedded image(s) were not extracted");
  });

  it("reports a file that is not a docx at all", async () => {
    const bytes = new TextEncoder().encode("this is plain text, not a zip");
    await expect(extractDocumentFromPath("fake.docx", bytes)).rejects.toThrow(DocumentExtractError);
  });
});

describe("xlsx", () => {
  it("returns one section per named sheet, in workbook order", async () => {
    const result = await extract("sample.xlsx");
    expect(result.units.map((unit) => unit.label)).toEqual(['sheet "Summary"', 'sheet "Detail"']);
  });

  it("renders cells as a table and states the used range", async () => {
    const markdown = await render("sample.xlsx");
    expect(markdown).toContain("Used range: A1:C5");
    expect(markdown).toContain("| Region | Revenue | Growth |");
    expect(markdown).toContain("| APAC | 4200000 | 0.24 |");
  });

  // A date cell must not arrive as a timestamp: the sheet holds a day, and inventing a time would
  // be inventing precision.
  it("renders a date as a day", async () => {
    const markdown = await render("sample.xlsx");
    expect(markdown).toContain("2026-09-23");
    expect(markdown).not.toContain("2026-09-23T");
  });

  it("renders booleans as spreadsheet text", async () => {
    const markdown = await render("sample.xlsx");
    expect(markdown).toContain("| Northwind | Dana | TRUE |");
    expect(markdown).toContain("| Contoso | Ravi | FALSE |");
  });

  it("says that formulas and charts are not represented", async () => {
    const markdown = await render("sample.xlsx");
    expect(markdown).toContain("Only cell values were extracted");
  });
});

describe("pptx", () => {
  // The fixture's slides are reordered by rewriting p:sldIdLst while the part filenames stay put,
  // which is what PowerPoint does. Filename order would produce the reverse of this.
  it("follows the presentation's slide order, not the part filenames", async () => {
    const result = await extract("sample.pptx");
    expect(result.units.map((unit) => unit.label)).toEqual([
      "slide 1 — What next",
      "slide 2 — Where we are",
      "slide 3 — Agenda",
    ]);
  });

  it("gives each slide its title once, as a heading, and its body as lines", async () => {
    const result = await extract("sample.pptx");
    const slide = result.units[0]!.markdown;
    expect(slide.startsWith("## What next\nHire two engineers\nShip the migration")).toBe(true);
    // The title appears as the heading and nowhere else. Before the fix it also opened the body,
    // because a sweep for `<a:t>` collected the title shape along with everything else.
    expect(slide.match(/What next/g)).toHaveLength(1);
  });

  it("includes speaker notes", async () => {
    const result = await extract("sample.pptx");
    expect(result.units[0]!.markdown).toContain("_Speaker notes:_ Owners named in the appendix.");
  });

  it("reports a pptx whose parts are missing", async () => {
    // A zip that is valid but not a presentation package.
    const { zipSync, strToU8 } = await import("fflate");
    const bytes = zipSync({ "hello.txt": strToU8("not a deck") });
    await expect(extractDocumentFromPath("fake.pptx", bytes)).rejects.toThrow(
      /no ppt\/presentation\.xml/,
    );
  });
});

describe("pdf", () => {
  it("returns one section per page with the text reconstructed into lines", async () => {
    const result = await extract("sample.pdf");
    expect(result.units.map((unit) => unit.label)).toEqual(["page 1", "page 2", "page 3"]);
    expect(result.units[0]!.markdown).toContain("Quarterly Report");
    expect(result.units[0]!.markdown).toContain(
      "The strongest gains were in the Asia-Pacific segment.",
    );
  });

  // A page whose only content is an image is not an empty page, and the difference decides whether
  // the model retries with OCR or concludes the document says nothing.
  it("distinguishes a page that is a scan from one that is blank", async () => {
    const markdown = await render("sample.pdf");
    expect(markdown).toContain("likely a scanned document");
  });

  it("reports a file that is not a PDF", async () => {
    const bytes = new TextEncoder().encode("definitely not a pdf");
    await expect(extractDocumentFromPath("fake.pdf", bytes)).rejects.toThrow(DocumentExtractError);
  });
});

describe("odt", () => {
  // Both odt regressions in one assertion: the paragraph exists at all, and it sits between the two
  // headings rather than after both of them.
  it("keeps headings and paragraphs in document order", async () => {
    const markdown = await render("sample.odt");
    const heading1 = markdown.indexOf("# Quarterly Report");
    const paragraph = markdown.indexOf("Revenue grew across every region this quarter.");
    const heading2 = markdown.indexOf("## By region");
    expect(heading1).toBeGreaterThanOrEqual(0);
    expect(paragraph).toBeGreaterThan(heading1);
    expect(heading2).toBeGreaterThan(paragraph);
  });

  it("renders an ODF table with its displayed cell text", async () => {
    const markdown = await render("sample.odt");
    expect(markdown).toContain("| Region | Revenue |");
    expect(markdown).toContain("| APAC | 4,200,000 |");
  });

  it("reports an odt with no content.xml", async () => {
    const { zipSync, strToU8 } = await import("fflate");
    const bytes = zipSync({ mimetype: strToU8("application/vnd.oasis.opendocument.text") });
    await expect(extractDocumentFromPath("fake.odt", bytes)).rejects.toThrow(/no content\.xml/);
  });
});

describe("buildDocumentPreview", () => {
  const preview = async (name: string, format: DocumentFormat) =>
    buildDocumentPreview(await readFile(path.join(fixtureDir, name)), format);

  // The preview is the same conversion asked by a different reader, so what matters is that it
  // keeps what the tool deliberately drops: the images, and the structure a pane can lay out.
  it("keeps a docx's embedded image, which the tool drops", async () => {
    const result = await preview("sample.docx", "docx");
    expect(result.kind).toBe("html");
    if (result.kind !== "html") return;
    expect(result.html).toContain("<img");
    expect(result.html).toContain("data:image/png;base64,");
    // The opposite of the Markdown path: a preview keeps the table as markup, because the point
    // is to draw the document rather than to describe it.
    expect(result.html).toContain("<table");
  });

  it("returns a workbook as cells a grid can lay out, one entry per sheet", async () => {
    const result = await preview("sample.xlsx", "xlsx");
    expect(result.kind).toBe("grid");
    if (result.kind !== "grid") return;
    expect(result.sheets.map((s) => s.name)).toEqual(["Summary", "Detail"]);
    expect(result.sheets[0]!.rows[0]).toEqual(["Region", "Revenue", "Growth"]);
    // Rendered values, matching what the sheet shows.
    expect(result.sheets[0]!.rows[4]![1]).toBe("2026-09-23");
  });

  it("returns a deck as slides in presentation order", async () => {
    const result = await preview("sample.pptx", "pptx");
    expect(result.kind).toBe("slides");
    if (result.kind !== "slides") return;
    expect(result.slides.map((s) => s.title)).toEqual(["What next", "Where we are", "Agenda"]);
    expect(result.slides[0]!.lines).toEqual(["Hire two engineers", "Ship the migration"]);
    expect(result.slides[0]!.notes).toBe("Owners named in the appendix.");
  });

  it("falls back to Markdown for ODF", async () => {
    const result = await preview("sample.odt", "odt");
    expect(result.kind).toBe("markdown");
    if (result.kind !== "markdown") return;
    expect(result.markdown).toContain("Quarterly Report");
  });

  // A PDF has no converted form on purpose: the browser's viewer beats anything this could emit.
  it("refuses a PDF rather than producing a worse rendering", async () => {
    await expect(preview("sample.pdf", "pdf")).rejects.toThrow(/browser directly/);
  });
});

describe("renderExtraction", () => {
  it("windows the units and says how to continue", async () => {
    const result = await extract("sample.pdf");
    const markdown = renderExtraction(result, { offset: 2, limit: 1 });
    expect(markdown).toContain("## page 2");
    expect(markdown).not.toContain("## page 1");
    expect(markdown).toContain("showing 2–2 of 3");
    expect(markdown).toContain("call again with offset 3");
  });

  // Paging past the end is how a caller discovers the length; it is not an error.
  it("explains an offset past the end instead of failing", async () => {
    const result = await extract("sample.xlsx");
    const markdown = renderExtraction(result, { offset: 99, limit: 5 });
    expect(markdown).toContain("this document has only 2 sections");
  });
});
