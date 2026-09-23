/**
 * Editing cells in a .xlsx without rewriting the workbook.
 *
 * The obvious implementation — parse the file into a model, change a value, serialize the model —
 * is the one this deliberately avoids. A spreadsheet holds far more than cells: charts, pivot
 * tables, conditional formatting, data validation, freeze panes, comments, named ranges. A model
 * that represents cells cannot represent those, so writing it back silently deletes them. The user
 * changed one number and lost the chart.
 *
 * So nothing is modelled. The package is unzipped, the one worksheet part that owns the edited
 * cell has a single `<c>` element replaced, and everything else — every other part, byte for byte —
 * is written back untouched. The edit is the size of the edit.
 *
 * Two details make that workable:
 *
 * - **New strings go in as inline strings** (`t="inlineStr"` with `<is><t>`), not into
 *   `sharedStrings.xml`. Appending to the shared table would mean touching a second part, keeping
 *   its `count` / `uniqueCount` attributes honest, and finding an unused index. Inline strings are
 *   valid OOXML, understood by Excel and every reader here, and keep the change local to one file.
 * - **A cell that does not exist yet has to be inserted in the right place.** Rows are ordered by
 *   `r` and cells within a row are ordered by column, and a part that violates that is rejected by
 *   Excel. So the insert walks to the correct position rather than appending.
 *
 * The zip is rebuilt rather than patched in place, so the archive's own metadata differs from the
 * original's. That is not a fidelity loss: nothing in the format depends on it, and the parts
 * inside are what a reader sees.
 */
import { unzipSync, zipSync } from "fflate";
import {
  asArray,
  attr,
  dig,
  parsePart,
  readArchive,
  readPart,
  relationshipTargets,
  resolveTarget,
} from "./ooxml.js";
import { DocumentExtractError } from "./types.js";

/** One cell to set. `value === null` clears the cell's content. */
export interface CellEdit {
  /** Sheet name as the workbook shows it. */
  sheet: string;
  /** A1-style address, e.g. `B7`. */
  address: string;
  value: string | number | null;
}

/** Escapes text for XML content. */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Splits an A1 address into its column letters and 1-based row number. */
export function parseAddress(address: string): { column: string; row: number } {
  const match = /^([A-Za-z]+)([1-9][0-9]*)$/.exec(address.trim());
  if (!match) {
    throw new DocumentExtractError(
      `"${address}" is not a cell address. Use A1-style references such as B7.`,
    );
  }
  return { column: match[1]!.toUpperCase(), row: Number(match[2]) };
}

/** Column letters to a 0-based index, so cells can be compared for order. */
function columnIndex(letters: string): number {
  let index = 0;
  for (const ch of letters) index = index * 26 + (ch.charCodeAt(0) - 64);
  return index - 1;
}

/** The `<c>` element for one cell, in the form Excel writes. */
function cellXml(address: string, value: string | number | null): string {
  if (value === null) return `<c r="${address}"/>`;
  if (typeof value === "number" && Number.isFinite(value)) {
    // No `t` attribute means "number" — that is the format's default.
    return `<c r="${address}"><v>${value}</v></c>`;
  }
  const text = escapeXml(String(value));
  // An empty string is a blank cell, not a cell holding "".
  if (text === "") return `<c r="${address}"/>`;
  return `<c r="${address}" t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
}

/** Finds the `<c>` element for `address` in a worksheet part, as [start, end) offsets. */
function findCell(xml: string, address: string): { start: number; end: number } | null {
  const pattern = new RegExp(`<c r="${address}"(?:\\s[^>]*)?(?:/>|>[\\s\\S]*?</c>)`);
  const match = pattern.exec(xml);
  if (!match || match.index === undefined) return null;
  return { start: match.index, end: match.index + match[0].length };
}

/**
 * The offset just past the last cell of `rowNumber` that sorts before `column`.
 *
 * Returns null when the row element itself is absent, which the caller handles by creating the row.
 * The scan is bounded to the row's own span so a cell in a later row cannot be mistaken for an
 * insertion point.
 */
function insertionOffsetInRow(xml: string, rowNumber: number, column: string): number | null {
  const rowPattern = new RegExp(`<row r="${rowNumber}"(?:\\s[^>]*)?(?:/>|>[\\s\\S]*?</row>)`);
  const row = rowPattern.exec(xml);
  if (!row || row.index === undefined) return null;
  const rowEnd = row.index + row[0].length;
  const wanted = columnIndex(column);

  let lastBefore = -1;
  const cellPattern = /<c r="([A-Za-z]+)[0-9]+"(?:\s[^>]*)?(?:\/>|>[\s\S]*?<\/c>)/g;
  cellPattern.lastIndex = row.index;
  for (;;) {
    const match = cellPattern.exec(xml);
    if (!match || match.index >= rowEnd) break;
    const letters = match[1]!;
    if (columnIndex(letters) < wanted) lastBefore = match.index + match[0].length;
    else break;
  }
  if (lastBefore >= 0) return lastBefore;
  // No smaller cell: the new one goes right after the row's opening tag.
  const openEnd = row[0].indexOf(">") + 1;
  return row.index + openEnd;
}

/** The `<row>` element for a row that does not exist yet, inserted in row order. */
function insertionOffsetForRow(xml: string, rowNumber: number): number {
  const rowPattern = /<row r="([0-9]+)"(?:\s[^>]*)?(?:\/>|>[\s\S]*?<\/row>)/g;
  let offset = -1;
  for (;;) {
    const match = rowPattern.exec(xml);
    if (!match || match.index === undefined) break;
    if (Number(match[1]) > rowNumber) return match.index;
    offset = match.index + match[0].length;
  }
  if (offset >= 0) return offset;
  // No rows at all: append inside <sheetData>.
  const sheetData = /<sheetData\s*\/>|<sheetData\s*>/.exec(xml);
  if (!sheetData || sheetData.index === undefined) {
    throw new DocumentExtractError("This worksheet has no <sheetData> element to edit.");
  }
  if (sheetData[0].endsWith("/>")) return sheetData.index + sheetData[0].length - 2;
  return sheetData.index + sheetData[0].length;
}

/** Applies one edit to a worksheet part's XML. */
function editSheetXml(xml: string, edit: CellEdit): string {
  const { column, row } = parseAddress(edit.address);
  const address = `${column}${row}`;
  const replacement = cellXml(address, edit.value);

  const existing = findCell(xml, address);
  if (existing) {
    return xml.slice(0, existing.start) + replacement + xml.slice(existing.end);
  }

  const inRow = insertionOffsetInRow(xml, row, column);
  if (inRow !== null) {
    return xml.slice(0, inRow) + replacement + xml.slice(inRow);
  }

  const rowOffset = insertionOffsetForRow(xml, row);
  const rowXml = `<row r="${row}">${replacement}</row>`;
  return xml.slice(0, rowOffset) + rowXml + xml.slice(rowOffset);
}

/** Sheet name to the archive path of its worksheet part. */
function sheetPartPaths(archive: Record<string, Uint8Array>): Map<string, string> {
  const workbook = parsePart(archive, "xl/workbook.xml");
  if (workbook === null) {
    throw new DocumentExtractError(
      "This .xlsx file has no xl/workbook.xml, so it is not a workbook package.",
    );
  }
  const rels = relationshipTargets(readPart(archive, "xl/_rels/workbook.xml.rels"));
  const paths = new Map<string, string>();
  for (const sheet of asArray(dig(workbook, "workbook", "sheets", "sheet"))) {
    const name = attr(sheet, "name");
    const relId = attr(sheet, "r:id");
    if (name === undefined || relId === undefined) continue;
    const target = rels.get(relId);
    if (target === undefined) continue;
    paths.set(name, resolveTarget(target, "xl"));
  }
  return paths;
}

/**
 * Applies cell edits and returns the new workbook bytes.
 *
 * Every edit is applied to the part that owns its cell, and every other part is copied through
 * unchanged — that is the whole guarantee. A sheet name or address that does not exist is an
 * error rather than a silent no-op, because an edit that quietly did nothing is worse than one
 * that refused.
 */
export function applyCellEdits(data: Uint8Array, edits: readonly CellEdit[]): Uint8Array {
  if (edits.length === 0) return data;
  const archive = readArchive(data, ".xlsx");
  const paths = sheetPartPaths(archive);

  // Grouped by part so a sheet with several edits is rewritten once.
  const byPath = new Map<string, CellEdit[]>();
  for (const edit of edits) {
    const path = paths.get(edit.sheet);
    if (path === undefined) {
      const known = [...paths.keys()].join(", ") || "(none)";
      throw new DocumentExtractError(
        `This workbook has no sheet named "${edit.sheet}". Its sheets are: ${known}.`,
      );
    }
    const list = byPath.get(path) ?? [];
    list.push(edit);
    byPath.set(path, list);
  }

  const updated: Record<string, Uint8Array> = { ...archive };
  for (const [path, list] of byPath) {
    const original = readPart(archive, path);
    if (original === null) {
      throw new DocumentExtractError(`The worksheet part ${path} is missing from this workbook.`);
    }
    let xml = original;
    for (const edit of list) xml = editSheetXml(xml, edit);
    updated[path] = new TextEncoder().encode(xml);
  }

  return zipSync(updated);
}
