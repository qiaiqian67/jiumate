/**
 * .odt / .ods / .odp extraction, from the single `content.xml` each package carries.
 *
 * ODF is the easier of the two families: where OOXML splits a document across many parts that
 * reference each other, ODF puts the whole body in `content.xml` with the styles in a separate
 * `styles.xml` that does not affect the text. So this is one parse and a walk.
 *
 * Two things about ODF shape this file, and both were wrong in the first version:
 *
 * - **Child order carries meaning.** `<text:h>`, `<text:p>` and `<table:table>` are siblings, and
 *   a parse that groups them by tag returns the headings and then the paragraphs, losing the
 *   document's structure entirely. So this walks an order-preserving parse rather than an object.
 * - **Text is a direct string child, not a nested element.** `<text:p>Hello</text:p>` has no inner
 *   element to find; looking for one finds nothing and the paragraph disappears. Whitespace is
 *   also not in the text at all — ODF encodes it as `<text:s>` (with a repeat count), `<text:tab>`
 *   and `<text:line-break>`, so a reader that ignores those collapses runs of spaces and drops
 *   the separation between columns.
 *
 * What differs between the three formats is only which element delimits a unit — headings and
 * paragraphs for a document, tables for a spreadsheet, pages for a presentation — which is why one
 * module covers all three rather than three near-identical ones.
 *
 * ODF also has a flat single-file variant (`.fodt`) that is plain XML rather than a zip. That is
 * a different extension and not claimed here; opening one as a zip fails with the archive message,
 * which is accurate enough to act on.
 */
import {
  childNodes,
  findNode,
  nodeAttrs,
  nodeChildren,
  nodeTag,
  parsePartOrdered,
  readArchive,
  readPart,
  type OrderedNode,
} from "./ooxml.js";
import {
  DocumentExtractError,
  type DocumentFormat,
  type ExtractResult,
  type ExtractedUnit,
} from "./types.js";

/**
 * The text of one ODF node, in order.
 *
 * Recurses through spans and links, and translates the elements ODF uses *instead of* literal
 * whitespace: `text:s` is one or more spaces (`text:c` gives the count), `text:tab` a tab, and
 * `text:line-break` a newline. Without those, "Name\tValue" arrives as "NameValue".
 */
function odfText(node: OrderedNode): string {
  const tag = nodeTag(node);
  if (tag === "#text") {
    const value = node["#text"];
    if (typeof value === "string") return value;
    return Array.isArray(value) ? value.map(odfText).join("") : "";
  }
  if (tag === "text:s") {
    const count = Number(nodeAttrs(node)["text:c"] ?? "1");
    return " ".repeat(Number.isFinite(count) && count > 0 ? Math.min(count, 200) : 1);
  }
  if (tag === "text:tab") return "\t";
  if (tag === "text:line-break") return "\n";

  let out = "";
  for (const child of nodeChildren(node)) out += odfText(child);
  return out;
}

/** The text of a paragraph-like node, trimmed and with runs of spaces collapsed. */
function paragraphOf(node: OrderedNode): string {
  return odfText(node)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** A cell's text: the displayed paragraph when there is one, otherwise the stored value. */
function odfCellText(cell: OrderedNode): string {
  const displayed = paragraphOf(cell);
  if (displayed !== "") return displayed;
  const attrs = nodeAttrs(cell);
  for (const key of [
    "office:value",
    "office:date-value",
    "office:time-value",
    "office:boolean-value",
  ]) {
    const value = attrs[key];
    if (typeof value === "string" && value !== "") return value;
  }
  return "";
}

/** Renders rows as a Markdown table, padding to the widest row. */
function renderTable(rows: string[][]): string {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  if (width === 0) return "";
  const render = (row: string[]): string =>
    `| ${Array.from({ length: width }, (_, i) => (row[i] ?? "").replace(/\|/g, "\\|")).join(" | ")} |`;
  const lines = [render(rows[0]!), `| ${Array.from({ length: width }, () => "---").join(" | ")} |`];
  for (const row of rows.slice(1)) lines.push(render(row));
  return lines.join("\n");
}

/** Rows of a `table:table`, following the order-preserving tree. */
function tableRows(table: OrderedNode): string[][] {
  const rows: string[][] = [];
  for (const row of childNodes(table, "table:table-row")) {
    const cells: string[] = [];
    for (const cell of childNodes(row, "table:table-cell")) {
      cells.push(odfCellText(cell));
      // A merged cell spans several columns; the covered columns are absent from the XML, so the
      // row would silently shift left without placeholders.
      const span = Number(nodeAttrs(cell)["table:number-columns-spanned"] ?? "1");
      for (let i = 1; i < (Number.isFinite(span) ? span : 1); i += 1) cells.push("");
    }
    rows.push(cells);
  }
  return rows;
}

/** The `office:body` child of the format's own kind, or throws with a usable message. */
function bodyOf(roots: OrderedNode[], tag: string, format: string): OrderedNode {
  const body = findNode(roots, "office:body");
  const wanted = body === null ? null : (childNodes(body, tag)[0] ?? null);
  if (wanted === null) {
    throw new DocumentExtractError(`This .${format} file has no ${tag} body.`);
  }
  return wanted;
}

function odtUnits(roots: OrderedNode[]): ExtractedUnit[] {
  const body = bodyOf(roots, "office:text", "odt");
  const lines: string[] = [];

  // One pass over the body's children in document order, so headings and paragraphs interleave
  // the way they do on the page.
  for (const child of nodeChildren(body)) {
    const tag = nodeTag(child);
    if (tag === "text:h") {
      const text = paragraphOf(child);
      const level = Number(nodeAttrs(child)["text:outline-level"] ?? "1");
      const hashes = "#".repeat(Math.min(Math.max(Number.isFinite(level) ? level : 1, 1), 6));
      if (text !== "") lines.push(`${hashes} ${text}`);
    } else if (tag === "text:p") {
      const text = paragraphOf(child);
      if (text !== "") lines.push(text);
    } else if (tag === "table:table") {
      const rendered = renderTable(tableRows(child));
      if (rendered !== "") lines.push("", rendered, "");
    }
  }

  return [
    {
      label: "document",
      markdown: lines
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim(),
    },
  ];
}

function odsUnits(roots: OrderedNode[]): ExtractedUnit[] {
  const body = bodyOf(roots, "office:spreadsheet", "ods");
  const units: ExtractedUnit[] = [];
  for (const table of childNodes(body, "table:table")) {
    const name = nodeAttrs(table)["table:name"] ?? `sheet ${units.length + 1}`;
    const rows = tableRows(table);
    const rendered = renderTable(rows);
    units.push({
      label: `sheet "${name}"`,
      markdown: rendered === "" ? `_Sheet "${name}" is empty._` : rendered,
    });
  }
  return units;
}

function odpUnits(roots: OrderedNode[]): ExtractedUnit[] {
  const body = bodyOf(roots, "office:presentation", "odp");
  const units: ExtractedUnit[] = [];
  for (const page of childNodes(body, "draw:page")) {
    const name = nodeAttrs(page)["draw:name"] ?? `slide ${units.length + 1}`;
    const lines: string[] = [];
    for (const frame of childNodes(page, "draw:frame")) {
      const text = paragraphOf(frame);
      if (text !== "") lines.push(text);
    }
    // Notes are their own element, not a frame; naming them keeps them from reading as content.
    for (const notes of childNodes(page, "presentation:notes")) {
      const text = paragraphOf(notes);
      if (text !== "") lines.push("", `_Speaker notes:_ ${text}`);
    }
    units.push({
      label: `slide ${units.length + 1} — ${name}`,
      markdown: lines.join("\n").trim(),
    });
  }
  return units;
}

export async function extractOdf(data: Uint8Array, format: DocumentFormat): Promise<ExtractResult> {
  const archive = readArchive(data, `.${format}`);
  if (readPart(archive, "content.xml") === null) {
    throw new DocumentExtractError(
      `This .${format} file has no content.xml, so it is not an OpenDocument package. It may be corrupt, or a flat single-file variant saved with a package extension.`,
    );
  }
  const roots = parsePartOrdered(archive, "content.xml");
  if (roots === null) {
    throw new DocumentExtractError(`This .${format} file has no readable content.xml.`);
  }

  const units =
    format === "odt" ? odtUnits(roots) : format === "ods" ? odsUnits(roots) : odpUnits(roots);
  const warnings: string[] = [];
  if (units.length === 0) warnings.push(`No content was found in this .${format} file.`);
  warnings.push("Only text was extracted. Images, charts and formatting are not represented.");
  return { format, units, warnings };
}
