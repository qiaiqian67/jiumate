/**
 * Types shared by the document extractors.
 *
 * The unit of extraction is deliberately "a list of labelled units" rather than one blob of
 * text: a PDF's pages, a workbook's sheets, a deck's slides and an ODF document's pages are the
 * divisions a reader navigates by, and the tool needs them to serve a window rather than
 * everything at once. A format with no natural division (a .docx) reports a single unit.
 */

/** Formats this module extracts. Legacy binary Office formats (.doc/.xls/.ppt) are not here. */
export type DocumentFormat = "docx" | "pdf" | "xlsx" | "pptx" | "odt" | "ods" | "odp";

/** Extension (lowercase, no dot) to format. Anything absent is not a document. */
export const DOCUMENT_EXTENSIONS: Record<string, DocumentFormat> = {
  docx: "docx",
  pdf: "pdf",
  xlsx: "xlsx",
  pptx: "pptx",
  odt: "odt",
  ods: "ods",
  odp: "odp",
};

/** The format for a path, or null when the extension is not a supported document. */
export function documentFormatOf(filePath: string): DocumentFormat | null {
  const name = filePath.slice(filePath.lastIndexOf("/") + 1).slice(filePath.lastIndexOf("\\") + 1);
  const dot = name.lastIndexOf(".");
  if (dot < 0) return null;
  return DOCUMENT_EXTENSIONS[name.slice(dot + 1).toLowerCase()] ?? null;
}

/** One navigable division: a page, a sheet, a slide. */
export interface ExtractedUnit {
  /** Human-readable label, e.g. `page 3`, `sheet "Q3"`, `slide 2`. */
  label: string;
  /** The unit's content as Markdown. Empty when the unit had no extractable content. */
  markdown: string;
}

export interface ExtractResult {
  format: DocumentFormat;
  units: ExtractedUnit[];
  /**
   * What could not be represented. Always surfaced rather than swallowed: a document whose
   * tables were flattened, or whose images were dropped, has to say so, or the model reads a
   * lossy extraction as the whole file.
   */
  warnings: string[];
}

/** Anything a format module may throw to report a problem the caller should render verbatim. */
export class DocumentExtractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentExtractError";
  }
}
