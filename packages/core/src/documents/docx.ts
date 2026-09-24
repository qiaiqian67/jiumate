/**
 * .docx extraction: mammoth to HTML, then Turndown to Markdown.
 *
 * Two libraries rather than one because they answer different halves of the question. mammoth
 * reads the OOXML — it knows that a paragraph is a paragraph and a table is a table, and it
 * deliberately discards visual formatting, which is the right trade for feeding text to a model:
 * a run that is bold and centred carries no meaning the model needs. Turndown then does the one
 * job mammoth does not, which is emit Markdown rather than HTML, so the output matches what the
 * other extractors produce and what the workspace editor can round-trip.
 *
 * Headings, lists, tables, links and footnotes survive. Images do not — mammoth hands them back
 * as data URIs, which would be megabytes of base64 inside a tool result — so their presence is
 * reported instead, and `read_image` remains the way to look at one.
 */
import { DocumentExtractError, type ExtractResult } from "./types.js";

/**
 * Normalizes mammoth's HTML into the shape Turndown's GFM table rules accept.
 *
 * Two adjustments, both forced by the rules rather than chosen:
 *
 * 1. **`<p>` inside a cell is unwrapped.** The rules treat a row as a heading only when its cells
 *    hold inline content, so a `<p>` in every `<td>` makes every row fail and the table is emitted
 *    as raw HTML. mammoth's output is machine-generated and this is exactly its shape, so
 *    unwrapping here is narrower than loosening the rule. Only single-paragraph cells are touched;
 *    a cell with several paragraphs keeps them, since collapsing those would join real lines.
 * 2. **The first row's cells become `<th>`.** A Word table marks no header row, and the rules
 *    `keep` any table whose first row is not all-`<th>` — verbatim HTML in the tool result, which
 *    is the one outcome worth avoiding. Markdown has no headerless table, so promoting the first
 *    row is the only way to express the table at all, and it matches how tables are written in
 *    practice. A table whose first row is genuinely data will read as having a header; the
 *    alternative is not reading as a table.
 */
function normalizeMammothHtml(html: string): string {
  const unwrapped = html.replace(
    /<(td|th)\b([^>]*)>\s*<p>([\s\S]*?)<\/p>\s*<\/\1>/g,
    (_match, tag: string, attrs: string, inner: string) => `<${tag}${attrs}>${inner}</${tag}>`,
  );
  return unwrapped.replace(/<table\b[\s\S]*?<\/table>/g, (table) => {
    let firstRow = true;
    return table.replace(/<tr\b[\s\S]*?<\/tr>/g, (row) => {
      if (!firstRow) return row;
      firstRow = false;
      return row.replace(/<td\b/g, "<th").replace(/<\/td>/g, "</th>");
    });
  });
}

/**
 * Reads a .docx into mammoth's HTML, images included.
 *
 * Separate from `extractDocx` because the two callers want opposite things from the same
 * conversion. The tool wants Markdown with images dropped — a data URI is megabytes of base64 in
 * a tool result, and a model cannot see an image anyway. The workspace preview wants HTML with
 * images *kept*, because it is rendering to a person who can. Both share the normalization and the
 * message handling below; only the last step differs.
 */
export async function docxToHtml(data: Uint8Array): Promise<{ html: string; warnings: string[] }> {
  const warnings: string[] = [];

  const mammoth = await import("mammoth");
  let html: string;
  try {
    const result = await mammoth.convertToHtml({ buffer: Buffer.from(data) });
    html = normalizeMammothHtml(result.value);
    // mammoth reports recoverable problems rather than failing, so they belong in the output:
    // an unrecognized style or a broken relationship is exactly what explains a gap in the text.
    for (const message of result.messages.slice(0, 10)) {
      warnings.push(`mammoth: ${message.message}`);
    }
    if (result.messages.length > 10) {
      warnings.push(`mammoth: ${result.messages.length - 10} further message(s) suppressed.`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new DocumentExtractError(
      `This .docx file could not be read (${message}). It may be corrupt, password-protected, or saved in the legacy .doc format instead.`,
    );
  }

  return { html, warnings };
}

/**
 * The document's text as Markdown, with no wrapper around it.
 *
 * This is the editing basis, and it is deliberately not `renderExtraction`'s output. That function
 * frames the body for a model — a `# docx document — 1 section` title, a `## document` heading — and
 * those frames are output, not content. Feeding them back through `markdownToDocx` writes them into
 * the user's document as literal headings, which is how a round trip quietly grows a paragraph
 * nobody typed.
 *
 * So: the tool renders, the editor edits, and only the body crosses between them.
 */
export async function docxToMarkdown(data: Uint8Array): Promise<string> {
  const result = await extractDocx(data);
  return result.units
    .map((unit) => unit.markdown)
    .join("\n\n")
    .trim();
}

export async function extractDocx(data: Uint8Array): Promise<ExtractResult> {
  const { html, warnings } = await docxToHtml(data);

  const imageCount = (html.match(/<img\b/g) ?? []).length;
  if (imageCount > 0) {
    warnings.push(
      `${imageCount} embedded image(s) were not extracted. Use read_image on the file if the visuals matter.`,
    );
  }

  const TurndownService = (await import("turndown")).default;
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });
  // Tables are the reason this plugin is here. Turndown's core has no table rule at all — it
  // emits a table's cells as loose paragraphs, which turns a financial table into a column of
  // unattributed numbers. The GFM rules restore the pipe syntax, and the extractors for the
  // other formats emit the same shape, so a model sees one representation across formats.
  const { gfm } = await import("turndown-plugin-gfm");
  turndown.use(gfm);
  // mammoth emits a bare `<img>` for every image; leaving them in would put base64 in the tool
  // result. They are reported as warnings instead, so the placeholder can be a plain marker.
  turndown.addRule("dropImages", {
    filter: "img",
    replacement: () => "[image omitted]",
  });

  const markdown = turndown.turndown(html).trim();
  if (markdown.length === 0) {
    warnings.push("No text was found in this document.");
  }

  return {
    format: "docx",
    units: [{ label: "document", markdown }],
    warnings,
  };
}
