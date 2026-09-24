/**
 * What the workspace shows when a user opens a document.
 *
 * The same question as extraction, asked by a different reader. The tool answers a model, which
 * wants text and nothing else; this answers a person looking at a pane, who wants the thing to
 * look like the document. So the payload is structured rather than Markdown — a docx becomes HTML
 * with its images intact, a workbook becomes cells a grid can lay out, a deck becomes slides —
 * and the web app decides how to draw each one.
 *
 * Four shapes rather than one, because the four are genuinely different to render and a single
 * "document HTML" string would force every caller to re-parse what the converter already knew:
 *
 * - `html` — a docx, already converted, to be shown in a sandboxed frame.
 * - `grid` — a workbook, as rows of rendered cell text, one entry per sheet.
 * - `slides` — a deck, as title / lines / notes per slide.
 * - `markdown` — the fallback for ODF, whose text extraction is good but whose layout is not
 *   worth reconstructing. The web app already renders Markdown, so this costs nothing to support
 *   and is honest about being text.
 *
 * PDF is deliberately absent: the browser renders it natively in an iframe, and converting it
 * would only produce a worse version of what the viewer already shows.
 *
 * The warnings ride along for the same reason they do in extraction — a preview that silently
 * drops a chart is a preview that lies — but they are advisory here, because the original file is
 * one click away and the user can see for themselves.
 */
import { docxToHtml } from "./docx.js";
import { extractOdf } from "./odf.js";
import { pptxSlides, type PptxSlide } from "./slides.js";
import { xlsxSheets, type SheetGrid } from "./spreadsheet.js";
import { DocumentExtractError, type DocumentFormat } from "./types.js";

export type DocumentPreview =
  | { kind: "html"; html: string; warnings: string[] }
  | { kind: "grid"; sheets: SheetGrid[]; warnings: string[] }
  | { kind: "slides"; slides: PptxSlide[]; warnings: string[] }
  | { kind: "markdown"; markdown: string; warnings: string[] };

/** Builds the preview payload for a document whose format is already known. */
export async function buildDocumentPreview(
  data: Uint8Array,
  format: DocumentFormat,
): Promise<DocumentPreview> {
  switch (format) {
    case "docx": {
      const { html, warnings } = await docxToHtml(data);
      return { kind: "html", html, warnings };
    }
    case "xlsx": {
      const sheets = await xlsxSheets(data);
      const warnings: string[] = [];
      if (sheets.length === 0) warnings.push("This workbook contains no sheets.");
      else {
        warnings.push(
          "Cell values are shown as the file stores them. Formulas are displayed as their results, and charts, pivot tables and conditional formatting are not drawn.",
        );
      }
      return { kind: "grid", sheets, warnings };
    }
    case "pptx": {
      const slides = await pptxSlides(data);
      const warnings: string[] = [];
      if (slides.length === 0) warnings.push("No slides were found in this presentation.");
      else {
        warnings.push(
          "Slides are shown as their text. Images, charts, SmartArt, animations and layout are not drawn.",
        );
      }
      return { kind: "slides", slides, warnings };
    }
    case "pdf":
      // Reached only by a caller that ignored the design: a PDF has no payload because the
      // browser's own viewer is better than anything this could produce, and the web app embeds
      // the file directly. Stated rather than left to a default branch, so the omission reads as
      // a decision instead of a gap.
      throw new DocumentExtractError(
        "A PDF is previewed by the browser directly and has no converted form.",
      );
    case "odt":
    case "ods":
    case "odp": {
      const result = await extractOdf(data, format);
      return {
        kind: "markdown",
        markdown: result.units
          .map((unit) => `## ${unit.label}\n\n${unit.markdown}`)
          .join("\n\n")
          .trim(),
        warnings: result.warnings,
      };
    }
  }
}

/** Builds the preview payload for a document whose format comes from the file name. */
export async function buildDocumentPreviewFromPath(
  filePath: string,
  data: Uint8Array,
  format: DocumentFormat,
): Promise<DocumentPreview> {
  if (data.length === 0) {
    throw new DocumentExtractError(`"${filePath}" is empty, so there is nothing to preview.`);
  }
  return buildDocumentPreview(data, format);
}
