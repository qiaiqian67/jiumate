/**
 * Document extraction: turn a .docx, .pdf, .xlsx, .pptx, .odt, .ods or .odp into Markdown.
 *
 * This module is the whole of "the agent can read a document". It exists as a subpath export of
 * core rather than inside the tool that first needed it, because the same conversion answers the
 * second question — what the workspace shows when a user opens a generated document — and the
 * server cannot reach into core's internals.
 *
 * Two properties are deliberate and worth keeping:
 *
 * - **Everything is a pure function of bytes.** No path handling, no workspace resolution, no
 *   I/O beyond reading the archive in memory. The tool owns paths; the preview service owns
 *   paths; neither has to trust this module with one.
 * - **Every format reports what it could not represent.** Extraction is lossy by nature — images,
 *   charts, formulas and layout all go — and a caller that cannot say so lets a model read a
 *   partial answer as the whole file. Warnings are part of the return value rather than a log
 *   line for that reason.
 *
 * Format-specific libraries are imported lazily, inside the branch that needs them. They are
 * several megabytes between them and most sessions never touch a document, so paying for them at
 * agent startup would be paying for nothing.
 */
import { extractDocx } from "./docx.js";
import { extractOdf } from "./odf.js";
import { extractPdf } from "./pdf.js";
import { extractPptx } from "./slides.js";
import { extractXlsx } from "./spreadsheet.js";
import {
  DocumentExtractError,
  documentFormatOf,
  type DocumentFormat,
  type ExtractResult,
} from "./types.js";

export {
  DOCUMENT_EXTENSIONS,
  DocumentExtractError,
  documentFormatOf,
  type DocumentFormat,
  type ExtractedUnit,
  type ExtractResult,
} from "./types.js";
export {
  buildDocumentPreview,
  buildDocumentPreviewFromPath,
  type DocumentPreview,
} from "./preview.js";
export type { PptxSlide } from "./slides.js";

/** Extraction by known format. Throws DocumentExtractError with a message fit to show the user. */
export async function extractDocument(
  data: Uint8Array,
  format: DocumentFormat,
): Promise<ExtractResult> {
  switch (format) {
    case "docx":
      return extractDocx(data);
    case "pdf":
      return extractPdf(data);
    case "xlsx":
      return extractXlsx(data);
    case "pptx":
      return extractPptx(data);
    case "odt":
    case "ods":
    case "odp":
      return extractOdf(data, format);
  }
}

/** Extracts a document whose format is taken from the file name. */
export async function extractDocumentFromPath(
  filePath: string,
  data: Uint8Array,
): Promise<ExtractResult> {
  const format = documentFormatOf(filePath);
  if (format === null) {
    throw new DocumentExtractError(
      `"${filePath}" is not a document this can read. Supported: .docx, .pdf, .xlsx, .pptx, .odt, .ods, .odp.`,
    );
  }
  return extractDocument(data, format);
}

/**
 * Renders an extraction as one Markdown string, with a heading per unit and the warnings last.
 *
 * The unit window is applied here rather than inside the extractors: a format module's job is to
 * describe the document, and "which part of it was asked for" is the caller's question. A window
 * that selects nothing is not an error — it is how a caller pages past the end and finds out.
 */
export function renderExtraction(
  result: ExtractResult,
  options: { offset?: number; limit?: number } = {},
): string {
  const total = result.units.length;
  const offset = Math.max(1, options.offset ?? 1);
  const limit = Math.max(1, options.limit ?? total);
  const window = result.units.slice(offset - 1, offset - 1 + limit);

  const parts: string[] = [];
  parts.push(`# ${result.format} document — ${total} ${total === 1 ? "section" : "sections"}`);

  if (window.length === 0) {
    parts.push("");
    parts.push(
      `Requested ${offset}–${offset + limit - 1}, but this document has only ${total} ${total === 1 ? "section" : "sections"}.`,
    );
    return parts.join("\n");
  }

  for (const [index, unit] of window.entries()) {
    parts.push("");
    parts.push(`## ${unit.label}`);
    parts.push("");
    parts.push(unit.markdown === "" ? "_(no text)_" : unit.markdown);
    const position = offset + index;
    if (position === offset + window.length - 1 && position < total) {
      parts.push("");
      parts.push(
        `_[showing ${offset}–${position} of ${total} — call again with offset ${position + 1} to continue]_`,
      );
    }
  }

  if (result.warnings.length > 0) {
    parts.push("");
    parts.push("## Notes");
    for (const warning of result.warnings) parts.push(`- ${warning}`);
  }

  return parts.join("\n");
}
