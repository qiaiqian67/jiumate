/**
 * .pdf extraction: text per page, via pdf.js.
 *
 * The hard part of PDF text extraction is not reading the glyphs, it is putting the spaces and
 * line breaks back. A PDF has no concept of a line: it has glyphs at coordinates, and a page of
 * prose is one long run of positioned strings. The reconstruction here uses the two signals that
 * are actually present — a change in the baseline y ends a line, and a horizontal gap wider than
 * a space reinserts a space — which is the same heuristic every extractor of this kind needs.
 *
 * Pages are separate units so the tool can serve one at a time; a 400-page manual should not have
 * to arrive whole.
 *
 * Encrypted files are refused rather than guessed at. A PDF that needs a password yields nothing
 * useful, and pdf.js's own failure mode is less clear than saying so.
 */
import { fileURLToPath } from "node:url";
import { DocumentExtractError, type ExtractResult, type ExtractedUnit } from "./types.js";

/** The parts of a pdf.js text item this needs: the string, where it sits, and how wide it is. */
interface PositionedItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  hasEOL: boolean;
}

/**
 * Joins one page's positioned text items into lines.
 *
 * pdf.js reports items in content-stream order, which is usually but not always reading order;
 * this keeps that order and only decides where to break. Items on a new baseline (a y that moved
 * by more than half a line height) start a new line. Within a line, a horizontal gap larger than
 * roughly a quarter of the line height is treated as a space — smaller gaps are kerning, and
 * treating them as spaces would spell words out letter by letter.
 */
function itemsToLines(items: PositionedItem[]): string[] {
  const lines: string[] = [];
  let current = "";
  let lastY: number | null = null;
  let lastX: number | null = null;
  let lastWidth = 0;
  let lineHeight = 0;

  const endLine = (): void => {
    if (current.trim() !== "") lines.push(current.trimEnd());
    current = "";
    lastX = null;
  };

  for (const item of items) {
    if (lastY !== null && Math.abs(item.y - lastY) > Math.max(1, item.height / 2)) endLine();
    lineHeight = Math.max(lineHeight, item.height);

    if (current !== "" && lastX !== null) {
      const gap = item.x - (lastX + lastWidth);
      // A quarter of the line height: wide enough to skip kerning, narrow enough to catch the
      // space that separates two words in the same run.
      if (gap > lineHeight * 0.25) current += " ";
    }
    current += item.str;
    lastY = item.y;
    lastX = item.x;
    lastWidth = item.width;
    if (item.hasEOL) endLine();
  }
  endLine();
  return lines;
}

/**
 * Pulls the positioned items out of a pdf.js text content result.
 *
 * `content.items` mixes real text items with marked-content markers, which carry no `str`. The
 * `in` check narrows the union without asserting a type, and the coordinate guard covers pdf.js's
 * optional transform entries — a text item whose position is unreadable is skipped rather than
 * placed at the origin, where it would silently reorder the page.
 */
function positionedItems(items: readonly unknown[]): PositionedItem[] {
  const out: PositionedItem[] = [];
  for (const item of items) {
    if (typeof item !== "object" || item === null || !("str" in item)) continue;
    const { str, transform, width, height, hasEOL } = item as {
      str: unknown;
      transform?: unknown;
      width?: unknown;
      height?: unknown;
      hasEOL?: unknown;
    };
    if (typeof str !== "string") continue;
    if (!Array.isArray(transform)) continue;
    const x = transform[4];
    const y = transform[5];
    if (typeof x !== "number" || typeof y !== "number") continue;
    const size =
      typeof height === "number" && height !== 0 ? Math.abs(height) : Math.abs(transform[3] ?? 10);
    out.push({
      str,
      x,
      y,
      width: typeof width === "number" ? width : 0,
      height: size,
      hasEOL: hasEOL === true,
    });
  }
  return out;
}

/**
 * The directory pdf.js reads its standard font metrics from.
 *
 * pdf.js warns loudly without it, and the warning is not cosmetic: a PDF that relies on the
 * base-14 fonts without embedding them has no glyph widths in the file, so without these metrics
 * pdf.js cannot tell where one character ends and the next begins and the extracted text runs
 * together. The path is resolved from the module's own location rather than assembled from
 * node_modules, so it stays right under a hoisted or nested install.
 *
 * Node's pdf.js reads the files itself rather than fetching them, so this has to be a filesystem
 * path — a `file://` URL fails at `path.join`. Resolution is allowed to fail: inside a packaged
 * archive the specifier may not resolve at all, and a missing metrics directory degrades the
 * output rather than preventing it.
 */
function standardFontDataDir(): string | undefined {
  try {
    const moduleUrl = import.meta.resolve("pdfjs-dist/legacy/build/pdf.mjs");
    // A literal forward slash, not `path.sep`: pdf.js checks the string for a trailing "/" and
    // rejects anything else, including the backslash a Windows path would end with.
    return `${fileURLToPath(new URL("../../standard_fonts/", moduleUrl))}/`;
  } catch {
    return undefined;
  }
}

export async function extractPdf(data: Uint8Array): Promise<ExtractResult> {
  const warnings: string[] = [];

  // The legacy build: the default one targets browsers and reaches for DOM APIs that do not
  // exist in Node.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const fontDir = standardFontDataDir();
  const task = pdfjs.getDocument({
    // pdf.js may transfer the buffer it is given; a copy keeps the caller's array usable for a
    // retry or a second read.
    data: new Uint8Array(data),
    useSystemFonts: false,
    useWorkerFetch: false,
    ...(fontDir === undefined ? {} : { standardFontDataUrl: fontDir }),
  });

  let doc: Awaited<typeof task.promise>;
  try {
    doc = await task.promise;
  } catch (err) {
    await task.destroy().catch(() => undefined);
    const name = (err as { name?: string })?.name;
    if (name === "PasswordException") {
      throw new DocumentExtractError(
        "This PDF is password-protected, so its text cannot be extracted. Ask the user for an unprotected copy.",
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new DocumentExtractError(
      `This PDF could not be opened (${message}). It may be corrupt or truncated.`,
    );
  }

  try {
    const units: ExtractedUnit[] = [];
    let emptyPages = 0;
    let imagePages = 0;

    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const lines = itemsToLines(positionedItems(content.items));

      // A page whose only content is an image extracts to nothing. Counting those lets the
      // warning distinguish "this PDF is a scan" from "this page is genuinely blank", which are
      // very different answers for the model to act on.
      if (lines.length === 0) {
        emptyPages += 1;
        const ops = await page.getOperatorList();
        if (ops.fnArray.includes(pdfjs.OPS.paintImageXObject)) imagePages += 1;
      }

      units.push({ label: `page ${pageNumber}`, markdown: lines.join("\n") });
      page.cleanup();
    }

    if (emptyPages > 0) {
      warnings.push(
        imagePages > 0
          ? `${emptyPages} of ${doc.numPages} page(s) yielded no text and contain images — this is likely a scanned document, which needs OCR rather than text extraction.`
          : `${emptyPages} of ${doc.numPages} page(s) contained no text.`,
      );
    }

    return { format: "pdf", units, warnings };
  } finally {
    // The loading task owns the worker; the document proxy has no destroy of its own.
    await task.destroy().catch(() => undefined);
  }
}
