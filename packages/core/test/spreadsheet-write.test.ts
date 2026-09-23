/**
 * Surgical cell editing, and the guarantee that makes it worth the trouble.
 *
 * The claim being tested is not "the cell changed" — any implementation manages that. It is that
 * *nothing else did*. A workbook holds charts, pivot tables, conditional formatting, validation and
 * comments, none of which a cell model can represent, so a parse-and-reserialize implementation
 * deletes them the moment a user edits one number. The test that catches that is a part-by-part
 * comparison against the original: every zip entry byte-identical except the one worksheet part
 * that owned the edited cell.
 *
 * That comparison is stronger than any assertion about specific features, because it holds for
 * features nobody thought to put in a fixture. The fixture here has none of them; the guarantee
 * still covers them.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { applyCellEdits, parseAddress } from "../src/documents/spreadsheet-write.js";
import { xlsxSheets } from "../src/documents/spreadsheet.js";
import { DocumentExtractError } from "../src/documents/types.js";

const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

const readFixture = () => readFile(path.join(fixtureDir, "sample.xlsx"));

/** Sheet name -> rows of rendered cell text, as the reader sees the workbook. */
async function readBack(data: Uint8Array) {
  const sheets = await xlsxSheets(data);
  return new Map(sheets.map((sheet) => [sheet.name, sheet.rows]));
}

describe("parseAddress", () => {
  it.each([
    ["A1", "A", 1],
    ["B7", "B", 7],
    ["AA10", "AA", 10],
    ["b2", "B", 2],
  ])("reads %s as column %s row %i", (address, column, row) => {
    expect(parseAddress(address)).toEqual({ column, row });
  });

  it.each(["", "7B", "A0", "A", "$A$1", "A1:B2"])("rejects %s", (address) => {
    expect(() => parseAddress(address)).toThrow(DocumentExtractError);
  });
});

describe("applyCellEdits", () => {
  // The load-bearing test. Everything else here is detail around it.
  it("changes only the worksheet part that owns the edited cell", async () => {
    const original = await readFixture();
    const edited = applyCellEdits(original, [{ sheet: "Summary", address: "B2", value: 9999 }]);

    const before = unzipSync(original);
    const after = unzipSync(edited);

    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());

    const changed = Object.keys(before).filter((name) => {
      const a = before[name]!;
      const b = after[name]!;
      return a.length !== b.length || a.some((byte, i) => byte !== b[i]);
    });
    expect(changed).toEqual(["xl/worksheets/sheet1.xml"]);
  });

  it("leaves the other sheets untouched", async () => {
    const original = await readFixture();
    const edited = applyCellEdits(original, [{ sheet: "Summary", address: "B2", value: 1 }]);

    const before = await readBack(original);
    const after = await readBack(edited);
    expect(after.get("Detail")).toEqual(before.get("Detail"));
  });

  it("sets a number, and the reader sees it", async () => {
    const edited = applyCellEdits(await readFixture(), [
      { sheet: "Summary", address: "B2", value: 9999 },
    ]);
    const sheets = await readBack(edited);
    expect(sheets.get("Summary")![1]).toEqual(["APAC", "9999", "0.24"]);
  });

  it("sets a string through an inline string, without touching sharedStrings", async () => {
    const original = await readFixture();
    const edited = applyCellEdits(original, [
      { sheet: "Summary", address: "A2", value: "Asia-Pacific" },
    ]);
    const sheets = await readBack(edited);
    expect(sheets.get("Summary")![1]![0]).toBe("Asia-Pacific");

    // The point of inline strings: the shared table is not a second part to keep consistent.
    const before = unzipSync(original);
    const after = unzipSync(edited);
    const shared = Object.keys(before).find((name) => name.includes("sharedStrings"));
    if (shared) {
      expect(after[shared]).toEqual(before[shared]);
    }
  });

  it("escapes a string that would otherwise break the XML", async () => {
    const edited = applyCellEdits(await readFixture(), [
      { sheet: "Summary", address: "A2", value: 'a & b < c > d " e' },
    ]);
    const sheets = await readBack(edited);
    expect(sheets.get("Summary")![1]![0]).toBe('a & b < c > d " e');
  });

  it("clears a cell when the value is null", async () => {
    const edited = applyCellEdits(await readFixture(), [
      { sheet: "Summary", address: "B2", value: null },
    ]);
    const sheets = await readBack(edited);
    expect(sheets.get("Summary")![1]![1]).toBe("");
  });

  // A cell that does not exist has to be inserted in row order, or Excel rejects the part.
  it("creates a cell in a row that already exists, in column order", async () => {
    const edited = applyCellEdits(await readFixture(), [
      { sheet: "Summary", address: "D1", value: "Note" },
      { sheet: "Summary", address: "B6", value: "new" },
    ]);
    const sheets = await readBack(edited);
    const rows = sheets.get("Summary")!;
    expect(rows[0]![3]).toBe("Note");
    expect(rows[5]![1]).toBe("new");

    // Ordering, checked against the raw part: cells must ascend by column within a row.
    const xml = new TextDecoder().decode(unzipSync(edited)["xl/worksheets/sheet1.xml"]!);
    for (const rowMatch of xml.matchAll(/<row r="([0-9]+)"[^>]*>([\s\S]*?)<\/row>/g)) {
      const columns = [...rowMatch[2]!.matchAll(/<c r="([A-Za-z]+)[0-9]+"/g)].map((m) => m[1]!);
      const indexes = columns.map((letters) => {
        let n = 0;
        for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
        return n;
      });
      expect(indexes, `row ${rowMatch[1]} is out of column order`).toEqual(
        [...indexes].sort((a, b) => a - b),
      );
    }
  });

  it("creates a row that does not exist yet, in row order", async () => {
    const edited = applyCellEdits(await readFixture(), [
      { sheet: "Summary", address: "A7", value: "Added" },
      { sheet: "Summary", address: "A2", value: "Changed" },
    ]);
    const sheets = await readBack(edited);
    expect(sheets.get("Summary")![6]![0]).toBe("Added");
    expect(sheets.get("Summary")![1]![0]).toBe("Changed");

    const xml = new TextDecoder().decode(unzipSync(edited)["xl/worksheets/sheet1.xml"]!);
    const rowNumbers = [...xml.matchAll(/<row r="([0-9]+)"/g)].map((m) => Number(m[1]));
    expect(rowNumbers).toEqual([...rowNumbers].sort((a, b) => a - b));
  });

  it("applies several edits to one sheet in one pass", async () => {
    const edited = applyCellEdits(await readFixture(), [
      { sheet: "Summary", address: "B2", value: 1 },
      { sheet: "Summary", address: "B3", value: 2 },
      { sheet: "Summary", address: "B4", value: 3 },
    ]);
    const rows = (await readBack(edited)).get("Summary")!;
    expect(rows.slice(1, 4).map((row) => row[1])).toEqual(["1", "2", "3"]);
  });

  it("edits two sheets, touching one part each", async () => {
    const original = await readFixture();
    const edited = applyCellEdits(original, [
      { sheet: "Summary", address: "B2", value: 1 },
      { sheet: "Detail", address: "C2", value: "FALSE" },
    ]);
    const before = unzipSync(original);
    const after = unzipSync(edited);
    const changed = Object.keys(before).filter((name) => {
      const a = before[name]!;
      const b = after[name]!;
      return a.length !== b.length || a.some((byte, i) => byte !== b[i]);
    });
    expect(changed.sort()).toEqual(["xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"]);
  });

  it("returns the same bytes when there is nothing to change", async () => {
    const original = await readFixture();
    expect(applyCellEdits(original, [])).toBe(original);
  });

  // An edit that silently did nothing is worse than one that refused.
  it("refuses a sheet that does not exist, and names the ones that do", async () => {
    const original = await readFixture();
    expect(() => applyCellEdits(original, [{ sheet: "Nope", address: "A1", value: 1 }])).toThrow(
      /no sheet named "Nope".*Summary, Detail/s,
    );
  });

  it("refuses a file that is not a workbook", async () => {
    const notAWorkbook = new TextEncoder().encode("this is not a zip");
    expect(() => applyCellEdits(notAWorkbook, [{ sheet: "A", address: "A1", value: 1 }])).toThrow(
      DocumentExtractError,
    );
  });
});
