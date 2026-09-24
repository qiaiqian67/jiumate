/**
 * Writing a .docx from Markdown.
 *
 * This is the second half of editing a Word document: the preview reads one by converting it to
 * Markdown (mammoth drops the styling and keeps the structure), the user edits that Markdown in the
 * same editor the workspace already uses for .md files, and this turns the result back into a
 * .docx. Going through Markdown rather than editing the OOXML in place is a deliberate trade, and
 * the trade is fidelity: see the note at the bottom of this file.
 *
 * The document is built with the `docx` library rather than by assembling OOXML by hand. The parts
 * a .docx needs beyond its content — `[Content_Types].xml`, relationships, `styles.xml`, the
 * numbering definitions a list depends on — are exactly the parts that are tedious to get right and
 * produce a file that opens in one reader and not another when you get them subtly wrong. The
 * library is MIT and actively maintained; hand-rolling it would be reimplementing a solved problem
 * to save one dependency.
 *
 * Markdown is tokenized with `marked` rather than parsed into an AST. The tokens are flat and
 * already shaped like the output — a heading is a heading, a list is a list — so a visitor over
 * them is shorter than one over a tree, and the only nesting that matters (a list item's own
 * blocks, a table cell's inline runs) is one level deep and handled where it arises.
 *
 * ## What does not survive
 *
 * The round trip is lossy, and the direction that loses is this one. Reading a .docx with mammoth
 * discards styling, headers and footers, footnotes, comments, tracked changes, embedded objects and
 * the original theme; nothing downstream can put back what was never read. So a document that goes
 * through an edit comes out with its text, headings, lists, tables, emphasis and links intact, and
 * its visual design replaced by this writer's defaults.
 *
 * That is why the caller must treat the result as a new document rather than as a save: the UI
 * offers "save as a new file" and requires an explicit choice to overwrite. Silently replacing a
 * designed document with a plain one would be the same class of mistake as dropping a chart while
 * editing a cell.
 */
import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { marked, type Token, type Tokens } from "marked";
import { DocumentExtractError } from "./types.js";

/** Heading level for a Markdown heading depth, clamped to what Word has. */
function headingLevel(depth: number): (typeof HeadingLevel)[keyof typeof HeadingLevel] {
  switch (depth) {
    case 1:
      return HeadingLevel.HEADING_1;
    case 2:
      return HeadingLevel.HEADING_2;
    case 3:
      return HeadingLevel.HEADING_3;
    case 4:
      return HeadingLevel.HEADING_4;
    case 5:
      return HeadingLevel.HEADING_5;
    default:
      return HeadingLevel.HEADING_6;
  }
}

/** The reference name for the bullet list numbering this writer defines. */
const BULLET_LIST = "markdown-bullets";

/** A run-level child: plain text, or a hyperlink wrapping some. */
type InlineNode = TextRun | ExternalHyperlink;

/**
 * Turns inline tokens into runs.
 *
 * Nested emphasis is flattened rather than composed: `**bold *and italic* bold**` produces runs
 * that are bold, then bold-and-italic, then bold. Word composes them the same way, so the nesting
 * is preserved in the output without the visitor having to carry a style stack through it.
 */
function inlineRuns(
  tokens: readonly Token[] | undefined,
  style: { bold?: boolean; italics?: boolean; strike?: boolean } = {},
): InlineNode[] {
  if (!tokens) return [];
  const runs: InlineNode[] = [];
  for (const token of tokens) {
    switch (token.type) {
      case "strong":
        runs.push(...inlineRuns((token as Tokens.Strong).tokens, { ...style, bold: true }));
        break;
      case "em":
        runs.push(...inlineRuns((token as Tokens.Em).tokens, { ...style, italics: true }));
        break;
      case "del":
        runs.push(...inlineRuns((token as Tokens.Del).tokens, { ...style, strike: true }));
        break;
      case "codespan":
        runs.push(
          new TextRun({
            text: (token as Tokens.Codespan).text,
            font: "Consolas",
            ...style,
          }),
        );
        break;
      case "link": {
        // A real Word hyperlink rather than styled text: the URL is the point of the link, and
        // plain runs would leave it visible only as its label.
        const link = token as Tokens.Link;
        runs.push(
          new ExternalHyperlink({
            link: link.href,
            children: inlineRuns(link.tokens, style).map((child) =>
              child instanceof TextRun
                ? child
                : new TextRun({ text: link.href, style: "Hyperlink" }),
            ),
          }),
        );
        break;
      }
      case "br":
        runs.push(new TextRun({ text: "", break: 1, ...style }));
        break;
      case "text": {
        const text = token as Tokens.Text;
        // A text token may carry its own inline children (a link inside a paragraph, say).
        if (text.tokens && text.tokens.length > 0) {
          runs.push(...inlineRuns(text.tokens, style));
        } else {
          runs.push(new TextRun({ text: text.text, ...style }));
        }
        break;
      }
      default: {
        const raw = (token as { text?: unknown }).text;
        if (typeof raw === "string") runs.push(new TextRun({ text: raw, ...style }));
      }
    }
  }
  return runs;
}

/** Paragraphs for one block-level token, flattened so a list item can hold several. */
function blockParagraphs(token: Token, depth = 0): (Paragraph | Table)[] {
  switch (token.type) {
    case "heading": {
      const heading = token as Tokens.Heading;
      return [
        new Paragraph({
          heading: headingLevel(heading.depth),
          children: inlineRuns(heading.tokens),
        }),
      ];
    }
    case "paragraph": {
      const paragraph = token as Tokens.Paragraph;
      return [new Paragraph({ children: inlineRuns(paragraph.tokens) })];
    }
    case "code": {
      const code = token as Tokens.Code;
      // One paragraph per line, each shaded: Word has no block-level code style, and a single
      // paragraph with newlines collapses them.
      return code.text.split("\n").map(
        (line) =>
          new Paragraph({
            children: [new TextRun({ text: line || " ", font: "Consolas", size: 20 })],
            shading: { fill: "F3F4F6" },
            spacing: { before: 0, after: 0 },
          }),
      );
    }
    case "blockquote": {
      const quote = token as Tokens.Blockquote;
      return quote.tokens.flatMap((inner) =>
        blockParagraphs(inner, depth).map((block) => {
          if (block instanceof Paragraph) {
            return new Paragraph({
              children: inlineRuns((inner as Tokens.Paragraph).tokens),
              indent: { left: 480 },
              border: { left: { style: "single", size: 12, color: "D1D5DB", space: 8 } },
            });
          }
          return block;
        }),
      );
    }
    case "list": {
      const list = token as Tokens.List;
      const out: (Paragraph | Table)[] = [];
      for (const item of list.items) {
        item.tokens.forEach((inner, index) => {
          const blocks = blockParagraphs(inner, depth + 1);
          // The first paragraph of an item carries the bullet or number; the rest are its
          // continuation, indented under it. Building the marker paragraph from the item's own
          // inline tokens is what avoids reaching into an already-built Paragraph — the library
          // keeps those internal, and rightly so.
          const inline =
            inner.type === "paragraph"
              ? (inner as Tokens.Paragraph).tokens
              : inner.type === "text"
                ? (inner as Tokens.Text).tokens
                : undefined;
          if (index === 0 && inline !== undefined) {
            const level = Math.min(depth, 4);
            out.push(
              list.ordered
                ? new Paragraph({
                    children: inlineRuns(inline),
                    numbering: { reference: BULLET_LIST, level },
                  })
                : new Paragraph({ children: inlineRuns(inline), bullet: { level } }),
            );
            out.push(...blocks.slice(1));
          } else {
            out.push(...blocks);
          }
        });
      }
      return out;
    }
    case "table": {
      const table = token as Tokens.Table;
      const rows = [
        new TableRow({
          tableHeader: true,
          children: table.header.map(
            (cell) =>
              new TableCell({
                children: [new Paragraph({ children: inlineRuns(cell.tokens) })],
              }),
          ),
        }),
        ...table.rows.map(
          (row) =>
            new TableRow({
              children: row.map(
                (cell) =>
                  new TableCell({
                    children: [new Paragraph({ children: inlineRuns(cell.tokens) })],
                  }),
              ),
            }),
        ),
      ];
      return [new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } })];
    }
    case "hr":
      return [
        new Paragraph({
          text: "",
          border: { bottom: { style: "single", size: 6, color: "D1D5DB", space: 1 } },
        }),
      ];
    case "space":
      return [];
    default: {
      const raw = (token as { raw?: unknown }).raw;
      if (typeof raw === "string" && raw.trim() !== "") {
        return [new Paragraph({ children: [new TextRun({ text: raw })] })];
      }
      return [];
    }
  }
}

/**
 * Converts Markdown to a .docx.
 *
 * Throws DocumentExtractError only when the library fails; Markdown that does not parse is not an
 * error here, because the caller has already shown the user the text they are saving.
 */
export async function markdownToDocx(markdown: string): Promise<Uint8Array> {
  const tokens = marked.lexer(markdown);
  const children = tokens.flatMap((token) => blockParagraphs(token));

  try {
    const doc = new Document({
      // Word has no built-in decimal numbering this can rely on; defining it here means an ordered
      // list renders as one instead of as a bulleted list, which is the default when the numbering
      // reference is missing.
      numbering: {
        config: [
          {
            reference: BULLET_LIST,
            levels: Array.from({ length: 5 }, (_, level) => ({
              level,
              format: LevelFormat.DECIMAL,
              text: `%${level + 1}.`,
              alignment: AlignmentType.START,
            })),
          },
        ],
      },
      sections: [{ children: children.length > 0 ? children : [new Paragraph({ text: "" })] }],
    });
    const buffer = await Packer.toBuffer(doc);
    return new Uint8Array(buffer);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new DocumentExtractError(`Could not build the .docx (${message}).`);
  }
}
