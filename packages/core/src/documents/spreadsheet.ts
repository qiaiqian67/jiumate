/**
 * .xlsx extraction: every sheet as a Markdown table, via read-excel-file.
 *
 * The library reads values, not formulas. That is the right output for a model — the value is
 * what the sheet says, and a formula is an implementation detail of how it says it — but it means
 * the extraction cannot be written back to produce an equivalent file, so it is read-only by
 * construction. Writing goes through the surgical XML path instead, which never round-trips
 * through this representation.
 *
 * Sheets are units, and the output names each one, because a workbook is navigated by sheet and a
 * model asked about "the Q3 numbers" needs to know which sheets exist before it can ask for one.
 *
 * Two caps keep a pathological workbook from becoming a tool result: columns and rows per sheet.
 * Both are reported when they bite — a truncated table that does not say it was truncated reads
 * as a sheet that simply ends there.
 */
import { DocumentExtractError, type ExtractResult, type ExtractedUnit } from "./types.js";

/** Max columns rendered per sheet; beyond this the row is cut and the cut is reported. */
const MAX_COLUMNS = 40;

/** Max rows rendered per sheet. */
const MAX_ROWS = 500;

/** A cell as read-excel-file reports it. */
type CellValue = string | number | boolean | Date | null;

/** Renders one cell for a Markdown table: pipes escaped, newlines flattened, dates as ISO days. */
function renderCell(value: CellValue): string {
  if (value === null || value === undefined) return "";
  let text: string;
  if (value instanceof Date) {
    // Excel dates are day-granular unless they carry a time; emitting a full ISO timestamp for a
    // date-only cell would invent precision the sheet does not have.
    const hasTime =
      value.getUTCHours() !== 0 ||
      value.getUTCMinutes() !== 0 ||
      value.getUTCSeconds() !== 0 ||
      value.getUTCMilliseconds() !== 0;
    text = hasTime ? value.toISOString() : value.toISOString().slice(0, 10);
  } else if (typeof value === "boolean") {
    text = value ? "TRUE" : "FALSE";
  } else {
    text = String(value);
  }
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

/** Excel's column letters for a 0-based index: 0 -> A, 26 -> AA. */
function columnLetter(index: number): string {
  let n = index;
  let letters = "";
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letters;
}

/** Drops trailing rows and columns that hold nothing, so a padded sheet reports its real size. */
function trimGrid(rows: CellValue[][]): CellValue[][] {
  const isBlank = (row: CellValue[]): boolean =>
    row.every((cell) => cell === null || cell === undefined || String(cell).trim() === "");
  let end = rows.length;
  while (end > 0 && isBlank(rows[end - 1]!)) end -= 1;
  const kept = rows.slice(0, end);
  let width = 0;
  for (const row of kept) {
    let last = row.length;
    while (last > 0 && (row[last - 1] === null || String(row[last - 1]).trim() === "")) last -= 1;
    width = Math.max(width, last);
  }
  return kept.map((row) => row.slice(0, width));
}

function sheetToMarkdown(
  name: string,
  grid: CellValue[][],
): { markdown: string; warnings: string[] } {
  const warnings: string[] = [];
  if (grid.length === 0) {
    return { markdown: `_Sheet "${name}" is empty._`, warnings };
  }

  const width = Math.max(...grid.map((row) => row.length));
  const columns = Math.min(width, MAX_COLUMNS);
  const rows = Math.min(grid.length, MAX_ROWS);

  if (width > MAX_COLUMNS) {
    warnings.push(
      `Sheet "${name}": showing the first ${MAX_COLUMNS} of ${width} columns (through ${columnLetter(MAX_COLUMNS - 1)}).`,
    );
  }
  if (grid.length > MAX_ROWS) {
    warnings.push(`Sheet "${name}": showing the first ${MAX_ROWS} of ${grid.length} rows.`);
  }

  const lines: string[] = [];
  // The used range, stated before the table: it is what a later edit needs in order to name a
  // cell, and it is the one piece of address information a value-only read can still provide.
  lines.push(`Used range: A1:${columnLetter(Math.max(0, width - 1))}${grid.length}`);
  lines.push("");

  const header = grid[0]!;
  const renderRow = (row: CellValue[]): string => {
    const cells: string[] = [];
    for (let i = 0; i < columns; i += 1) cells.push(renderCell(row[i] ?? null));
    return `| ${cells.join(" | ")} |`;
  };

  lines.push(renderRow(header));
  lines.push(`| ${Array.from({ length: columns }, () => "---").join(" | ")} |`);
  for (let i = 1; i < rows; i += 1) lines.push(renderRow(grid[i]!));

  return { markdown: lines.join("\n"), warnings };
}

export async function extractXlsx(data: Uint8Array): Promise<ExtractResult> {
  const { default: readXlsxFile } = await import("read-excel-file/node");

  let sheets: Awaited<ReturnType<typeof readXlsxFile>>;
  try {
    // Buffer.from over the same memory rather than a copy: read-excel-file only reads it.
    sheets = await readXlsxFile(Buffer.from(data));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new DocumentExtractError(
      `This .xlsx file could not be read (${message}). It may be corrupt, password-protected, or saved in the legacy .xls format instead.`,
    );
  }

  const warnings: string[] = [];
  const units: ExtractedUnit[] = [];
  for (const { sheet, data: rows } of sheets) {
    const grid = trimGrid(rows as CellValue[][]);
    const rendered = sheetToMarkdown(sheet, grid);
    warnings.push(...rendered.warnings);
    units.push({ label: `sheet "${sheet}"`, markdown: rendered.markdown });
  }

  if (units.length === 0) {
    warnings.push("This workbook contains no sheets.");
  } else {
    // Worth saying outright: a workbook that extracts as tables but whose charts and pivot
    // tables are missing should not read as complete.
    warnings.push(
      "Only cell values were extracted. Formulas are shown as their results, and charts, pivot tables and conditional formatting are not represented.",
    );
  }

  return { format: "xlsx", units, warnings };
}
