/**
 * Renders the converted form of a workspace document.
 *
 * Three views, because the three payloads are genuinely different things to draw: a converted
 * .docx is a page of HTML, a workbook is a grid, a deck is a stack of slides. The server decides
 * which by looking at the file; this decides how to lay it out.
 *
 * The HTML view is a sandboxed frame with no `allow-scripts`, which is the whole of its security
 * story. The markup comes from a document a user supplied, so it is untrusted in the sense that
 * matters — but it is *static* markup: mammoth emits no script, and a preview has no reason to run
 * any. Dropping script execution means a hostile .docx cannot reach this origin, and it costs
 * nothing, because nothing here needs to execute. The frame is also where the document's own
 * images live: mammoth inlines them as data URIs, so they render without the frame making a single
 * network request.
 *
 * The `markdown` payload is deliberately absent. ODF text is extracted well and laid out poorly,
 * so it is shown through the app's existing Markdown renderer instead — the caller maps it onto
 * the `md` preview it already has, and this component never sees it.
 */
import { Suspense, lazy, useState } from "react";
import type { DocumentPreview, SheetGrid } from "@jadelau/core/documents";
import { S } from "../../lib/strings";

/**
 * The real-.docx surface, on demand. The engine is a layout and shaping pipeline rather than a form
 * control, and the HTML fallback below covers every case that cannot use it.
 */
const DocxSurface = lazy(() => import("./docx-surface"));

/**
 * Base typography for converted document HTML.
 *
 * mammoth emits semantic tags with no styling, so without this a converted report renders as one
 * undifferentiated block of browser-default text. Deliberately modest and self-contained: the
 * goal is that a document looks like a document, not that it looks like this app.
 */
const DOCUMENT_CSS = `
  :root { color-scheme: light dark; }
  body {
    margin: 0;
    padding: 24px 28px;
    font: 15px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    color: #111827;
    background: #ffffff;
    overflow-wrap: anywhere;
  }
  h1, h2, h3, h4, h5, h6 { line-height: 1.3; margin: 1.4em 0 0.6em; font-weight: 600; }
  h1 { font-size: 1.7em; margin-top: 0; }
  h2 { font-size: 1.35em; }
  h3 { font-size: 1.15em; }
  p { margin: 0.75em 0; }
  ul, ol { margin: 0.75em 0; padding-left: 1.6em; }
  li { margin: 0.25em 0; }
  table { border-collapse: collapse; margin: 1em 0; max-width: 100%; display: block; overflow-x: auto; }
  th, td { border: 1px solid #d1d5db; padding: 6px 10px; text-align: left; vertical-align: top; }
  th { background: #f3f4f6; font-weight: 600; }
  img { max-width: 100%; height: auto; }
  a { color: #2563eb; }
  blockquote { margin: 1em 0; padding-left: 1em; border-left: 3px solid #d1d5db; color: #4b5563; }
  pre { background: #f3f4f6; padding: 10px 12px; border-radius: 6px; overflow-x: auto; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.92em; }
  @media (prefers-color-scheme: dark) {
    body { color: #e5e7eb; background: #111827; }
    th, td { border-color: #374151; }
    th { background: #1f2937; }
    blockquote { border-color: #374151; color: #9ca3af; }
    pre { background: #1f2937; }
    a { color: #60a5fa; }
  }
`;

function Warnings({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
      <ul className="list-disc space-y-0.5 pl-4">
        {warnings.map((warning, index) => (
          <li key={index}>{warning}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A converted document as a page.
 *
 * `sandbox=""` with no allowances: no scripts, no forms, no top-level navigation, and an opaque
 * origin. That is stricter than the workspace HTML preview needs to be, and it can afford to be,
 * because this content is a rendering of a document rather than a page the agent wrote to run.
 */
function HtmlDocumentView({ html }: { html: string }) {
  const doc = `<!doctype html><html><head><meta charset="utf-8"><style>${DOCUMENT_CSS}</style></head><body>${html}</body></html>`;
  return (
    <iframe
      srcDoc={doc}
      title="Document preview"
      sandbox=""
      className="h-full min-h-[60vh] w-full rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
    />
  );
}

/** One pending cell change, keyed by sheet and address. */
export interface CellEditDraft {
  sheet: string;
  address: string;
  value: string;
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

/**
 * A workbook as a grid, one tab per sheet, editable in place.
 *
 * Row numbers and column letters are rendered because a spreadsheet is addressed, not just read:
 * the first thing anyone does with a previewed sheet is point at a cell, and "B7" is a more useful
 * thing to be able to say than "the one in the second column" — and it is the address an edit is
 * sent under.
 *
 * Editing holds a **draft**, not a new workbook. A changed cell is recorded as `{sheet, address,
 * value}` and the cell keeps showing the draft value until save; nothing re-serializes the file,
 * because the browser never parsed one. That is what makes the save lossless: the server receives a
 * handful of coordinates and applies them to the bytes on disk, so charts and pivot tables the
 * browser could not represent are never asked to survive a round trip through it.
 */
function SheetGridView({
  sheets,
  onSaveCells,
}: {
  sheets: SheetGrid[];
  onSaveCells?: (edits: CellEditDraft[]) => Promise<void>;
}) {
  const [active, setActive] = useState(0);
  const [editing, setEditing] = useState<{ sheet: string; address: string } | null>(null);
  const [drafts, setDrafts] = useState<Map<string, string>>(new Map());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sheet = sheets[Math.min(active, sheets.length - 1)];
  if (!sheet) return <p className="text-sm text-gray-500">This workbook has no sheets.</p>;

  const keyOf = (sheetName: string, address: string): string => `${sheetName}\u0000${address}`;
  const valueAt = (sheetName: string, address: string, original: string): string =>
    drafts.get(keyOf(sheetName, address)) ?? original;

  const commit = (sheetName: string, address: string, next: string, original: string): void => {
    setDrafts((previous) => {
      const updated = new Map(previous);
      // A value typed back to what was there is not an edit; dropping it keeps the save honest
      // about what actually changed.
      if (next === original) updated.delete(keyOf(sheetName, address));
      else updated.set(keyOf(sheetName, address), next);
      return updated;
    });
    setEditing(null);
  };

  const save = async (): Promise<void> => {
    if (!onSaveCells || drafts.size === 0) return;
    setSaving(true);
    setError(null);
    try {
      const edits: CellEditDraft[] = [];
      for (const [key, value] of drafts) {
        const [sheetName, address] = key.split("\u0000") as [string, string];
        // A blank cell clears it; anything else is a string. Numbers typed into a numeric column
        // are left as text on purpose — guessing would silently reformat identifiers like "007".
        edits.push({ sheet: sheetName, address, value });
      }
      await onSaveCells(edits);
      setDrafts(new Map());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const width = sheet.rows.reduce((max, row) => Math.max(max, row.length), 0);
  const dirty = drafts.size;

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1">
        {sheets.length > 1 &&
          sheets.map((entry, index) => (
            <button
              key={entry.name}
              type="button"
              onClick={() => setActive(index)}
              className={
                index === active
                  ? "rounded-md bg-gray-900 px-2.5 py-1 text-xs font-medium text-white dark:bg-gray-100 dark:text-gray-900"
                  : "rounded-md border border-gray-200 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-100 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800"
              }
            >
              {entry.name}
            </button>
          ))}
        {dirty > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-gray-500">
              {dirty} cell{dirty === 1 ? "" : "s"} changed
            </span>
            <button
              type="button"
              onClick={() => setDrafts(new Map())}
              disabled={saving}
              className="rounded-md border border-gray-200 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              Discard
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        )}
      </div>
      {error !== null && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}
      <div className="min-h-[40vh] flex-1 overflow-auto rounded-md border border-gray-200 dark:border-gray-800">
        {width === 0 ? (
          <p className="p-3 text-sm text-gray-500">Sheet “{sheet.name}” is empty.</p>
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-gray-100 dark:bg-gray-800">
              <tr>
                <th className="w-10 border border-gray-200 px-2 py-1 text-gray-500 dark:border-gray-700" />
                {Array.from({ length: width }, (_, i) => (
                  <th
                    key={i}
                    className="border border-gray-200 px-2 py-1 text-left font-medium text-gray-500 dark:border-gray-700"
                  >
                    {columnLetter(i)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sheet.rows.map((row, rowIndex) => (
                <tr key={rowIndex} className={rowIndex === 0 ? "font-medium" : undefined}>
                  <th className="border border-gray-200 bg-gray-50 px-2 py-1 text-right text-gray-500 dark:border-gray-700 dark:bg-gray-800">
                    {rowIndex + 1}
                  </th>
                  {Array.from({ length: width }, (_, colIndex) => {
                    const address = `${columnLetter(colIndex)}${rowIndex + 1}`;
                    const original = row[colIndex] ?? "";
                    const value = valueAt(sheet.name, address, original);
                    const isEditing = editing?.sheet === sheet.name && editing.address === address;
                    const isDirty = drafts.has(keyOf(sheet.name, address));
                    // A formula cell shows its result, not the formula, so editing it would
                    // replace `=SUM(B2:B4)` with whatever number is on screen. That is a silent
                    // change to what the sheet computes — worse than the chart-dropping this
                    // whole path exists to avoid, because a chart is visibly gone and a formula
                    // is not. So the cell is not editable and says why.
                    const isFormula = sheet.formulaCells.includes(address);
                    if (isEditing) {
                      return (
                        <td
                          key={colIndex}
                          className="border border-blue-400 p-0 dark:border-blue-600"
                        >
                          <input
                            autoFocus
                            defaultValue={value}
                            onBlur={(event) =>
                              commit(sheet.name, address, event.target.value, original)
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                commit(sheet.name, address, event.currentTarget.value, original);
                              } else if (event.key === "Escape") {
                                setEditing(null);
                              }
                            }}
                            className="w-full min-w-[6rem] bg-white px-2 py-1 text-xs outline-none dark:bg-gray-900"
                          />
                        </td>
                      );
                    }
                    return (
                      <td
                        key={colIndex}
                        onClick={() => {
                          if (onSaveCells && !isFormula) setEditing({ sheet: sheet.name, address });
                        }}
                        className={
                          "max-w-[28rem] truncate border border-gray-200 px-2 py-1 dark:border-gray-700" +
                          (onSaveCells && !isFormula
                            ? " cursor-cell hover:bg-blue-50 dark:hover:bg-blue-950"
                            : "") +
                          (isFormula ? " bg-gray-50 text-gray-500 dark:bg-gray-800" : "") +
                          (isDirty ? " bg-amber-50 font-medium dark:bg-amber-950" : "")
                        }
                        title={
                          isFormula
                            ? `${address} — a formula (${value}). Editing it here would replace the formula with this number, so edit the workbook instead.`
                            : onSaveCells
                              ? `${address} — click to edit`
                              : value
                        }
                      >
                        {value}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/**
 * A deck as a stack of slides.
 *
 * Laid out as slides rather than as a text dump, because a deck is read one slide at a time and
 * the whole point of previewing one is to see the shape of it. The text is what the extractor
 * could recover — layout, images and charts are not drawn — so each card is honestly a text slide,
 * and the warnings above say so.
 */
function SlidesView({
  slides,
}: {
  slides: { title: string | null; lines: string[]; notes: string | null }[];
}) {
  if (slides.length === 0) {
    return <p className="text-sm text-gray-500">No slides were found in this presentation.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {slides.map((slide, index) => (
        <section
          key={index}
          className="rounded-md border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900"
        >
          <header className="mb-2 flex items-baseline gap-2">
            <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-gray-800">
              {index + 1}
            </span>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {slide.title ?? <span className="text-gray-400">(untitled)</span>}
            </h3>
          </header>
          {slide.lines.length > 0 ? (
            <ul className="list-disc space-y-0.5 pl-5 text-sm text-gray-700 dark:text-gray-300">
              {slide.lines.map((line, lineIndex) => (
                <li key={lineIndex}>{line}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-400">(no text on this slide)</p>
          )}
          {slide.notes !== null && (
            <p className="mt-2 border-t border-gray-100 pt-2 text-xs text-gray-500 dark:border-gray-800">
              <span className="font-medium">Notes:</span> {slide.notes}
            </p>
          )}
        </section>
      ))}
    </div>
  );
}

/**
 * Renders a converted document. Returns null for the `markdown` payload — see the file header.
 *
 * `onSaveCells` is what makes a workbook editable, and its absence is what makes the same component
 * read-only. That is deliberate: the preview is shown in a docked panel and a drawer that never
 * mount at once, and only one of them owns the file's ETag. A grid that saved without an ETag would
 * skip the conflict check, so the callback carries both the write and the freshness check with it.
 *
 * `sessionId` and `path` are what let a .docx be shown as the document it is rather than as the
 * extractor's HTML — see `DocxRenderer`. Both are absent for the read-only drawer, which falls back
 * to the HTML rendering rather than a page it cannot fetch.
 */
export function DocumentPreviewView({
  payload,
  sessionId,
  path,
  onSaveCells,
}: {
  payload: DocumentPreview;
  sessionId?: string;
  path?: string;
  onSaveCells?: (edits: CellEditDraft[]) => Promise<void>;
}) {
  if (payload.kind === "markdown") return null;
  // The `html` payload is the .docx case (ODF extracts to Markdown, see the file header), so a
  // .docx with both a session and a path is shown as itself — the same surface the editor uses, in
  // its read-only mode. Anything else keeps the extractor's rendering, which is a worse preview of a
  // Word document but the only one available without the bytes.
  const showRealDocx =
    payload.kind === "html" &&
    sessionId !== undefined &&
    path !== undefined &&
    path.toLowerCase().endsWith(".docx");
  return (
    <div className="flex h-full flex-col">
      <Warnings warnings={payload.warnings} />
      {showRealDocx ? (
        <Suspense
          fallback={
            <p className="text-sm text-gray-500 dark:text-gray-400">{S.files.docxPreviewLoading}</p>
          }
        >
          <DocxSurface sessionId={sessionId} path={path} mode="view" />
        </Suspense>
      ) : payload.kind === "html" ? (
        <HtmlDocumentView html={payload.html} />
      ) : payload.kind === "grid" ? (
        <SheetGridView sheets={payload.sheets} onSaveCells={onSaveCells} />
      ) : (
        <SlidesView slides={payload.slides} />
      )}
    </div>
  );
}
