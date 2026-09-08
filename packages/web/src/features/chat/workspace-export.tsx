/**
 * Workspace file export menu — a Dropdown over the file browser toolbar that converts the
 * currently-previewed file to one of seven formats and downloads it:
 *
 *   - Markdown / HTML — client-side: serializeMarkdownToHtml() → Blob → `<a download>`.
 *     Available regardless of server capabilities (Pandoc / desktop shell status).
 *   - PDF — server-side, dispatched through the desktop shell's hidden BrowserWindow
 *     + `printToPDF`. 503 in CLI/server mode; the capabilities flag is what disables it.
 *   - DOCX / EPUB / RTF / TXT — server-side, Pandoc. 503 when Pandoc is missing.
 *
 * Each menu item is `disabled` with a tooltip when its backing service is absent; the export
 * pipeline otherwise fails gracefully (a server-side error becomes a generic toast). While
 * a request is in flight the entire dropdown is disabled and the trigger label flips to
 * `exportPreparing(format)`.
 */
import { useCallback, useEffect, useState } from "react";
import { Dropdown } from "../../components/ui/dropdown";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { S } from "../../lib/strings";
import { ApiError } from "../../api/client";
import { apiErrorText } from "../../lib/api-error";
import * as api from "../../api/endpoints";
import type { ServerExportFormat } from "../../api/endpoints";
import { serializeMarkdownToHtml } from "../../lib/markdown-html";

/** Capability flags returned by GET /api/version/capabilities. */
export interface Capabilities {
  pandoc: { available: boolean };
  pdf: { available: boolean; reason: string | null };
}

/** A single menu item's resolved shape. */
export type ExportFormatSpec =
  | { kind: "md"; label: string; unavailableReason: string | null }
  | { kind: "html"; label: string; unavailableReason: string | null }
  | {
      kind: "server";
      serverFormat: ServerExportFormat;
      label: string;
      unavailableReason: string | null;
    };

/** Build the seven menu items, applying capability-based disabled states. */
export function buildExportFormats(capabilities: Capabilities | null): ExportFormatSpec[] {
  const pandocUnavailable = capabilities !== null && !capabilities.pandoc.available;
  const pdfUnavailable = capabilities !== null && !capabilities.pdf.available;
  const pdfReason = pdfUnavailable ? (capabilities?.pdf.reason ?? null) : null;
  const pandocReason = pandocUnavailable ? "Pandoc is not installed." : null;
  return [
    { kind: "md", label: S.files.exportMd, unavailableReason: null },
    { kind: "html", label: S.files.exportHtml, unavailableReason: null },
    {
      kind: "server",
      serverFormat: "pdf",
      label: S.files.exportPdf,
      unavailableReason: pdfReason,
    },
    {
      kind: "server",
      serverFormat: "docx",
      label: S.files.exportDocx,
      unavailableReason: pandocReason,
    },
    {
      kind: "server",
      serverFormat: "epub",
      label: S.files.exportEpub,
      unavailableReason: pandocReason,
    },
    {
      kind: "server",
      serverFormat: "rtf",
      label: S.files.exportRtf,
      unavailableReason: pandocReason,
    },
    {
      kind: "server",
      serverFormat: "txt",
      label: S.files.exportTxt,
      unavailableReason: pandocReason,
    },
  ];
}

/** Trigger a browser download from a Blob with a chosen filename. Browser-only. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  // Anchor needs to be in the DOM for Firefox to honour the click; we add it, click, then
  // remove it on the next tick so the navigation has already started.
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}

/** Swap the file extension (`foo.md` → `foo.pdf`). */
export function swapExt(name: string, newExt: string): string {
  // Strip the trailing extension only; preserves any dots inside the stem (`Q3.report.md` → `Q3.report.pdf`).
  const i = name.lastIndexOf(".");
  const stem = i > 0 ? name.slice(0, i) : name;
  return `${stem}.${newExt}`;
}

/**
 * Dispatch one export — used by the click handler, and by the test. Performs the conversion
 * and calls `onDownload` with the resulting Blob + filename (the test hooks this to assert
 * the contract without a DOM).
 */
export async function performExport(
  fmt: ExportFormatSpec,
  ctx: { sessionId: string; filePath: string; fileName: string; markdown: string },
  onDownload: (blob: Blob, filename: string) => void,
): Promise<void> {
  if (fmt.kind === "md") {
    onDownload(
      new Blob([ctx.markdown], { type: "text/markdown;charset=utf-8" }),
      swapExt(ctx.fileName, "md"),
    );
    return;
  }
  if (fmt.kind === "html") {
    const { html } = await serializeMarkdownToHtml(ctx.markdown);
    onDownload(
      new Blob([html], { type: "text/html;charset=utf-8" }),
      swapExt(ctx.fileName, "html"),
    );
    return;
  }
  const { html } = await serializeMarkdownToHtml(ctx.markdown);
  const blob = await api.exportWorkspaceFile(ctx.sessionId, ctx.filePath, fmt.serverFormat, html);
  onDownload(blob, swapExt(ctx.fileName, fmt.serverFormat));
}

export function ExportMenu({
  sessionId,
  filePath,
  fileName,
  markdown,
}: {
  sessionId: string;
  /** Relative path under the workspace — what the server resolves the file by. */
  filePath: string;
  /** Original filename; used to derive the downloaded file's name (same stem, new extension). */
  fileName: string;
  /** The Markdown source — required for the client-side MD/HTML paths, and for all server
   *  formats too (the client serializes to HTML before sending). Empty string is allowed
   *  for non-MD files; in that case the menu hides itself entirely. */
  markdown: string;
}) {
  const [open, setOpen] = useState(false);
  const [busyFormat, setBusyFormat] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);

  // Capabilities are loaded on first open, not on mount — a session that never opens the
  // menu pays no request, and the dropdown still feels instant once the user clicks it.
  useEffect(() => {
    if (!open || capabilities !== null) return;
    let cancelled = false;
    void api
      .getServerCapabilities()
      .then((c) => {
        if (!cancelled) setCapabilities(c);
      })
      .catch(() => {
        // Fail-soft: an empty capabilities object disables PDF and Pandoc formats; the
        // user still gets MD/HTML. We surface a console error for diagnosis.
        // eslint-disable-next-line no-console
        console.error("[export] failed to load server capabilities");
        if (!cancelled) {
          setCapabilities({
            pandoc: { available: false },
            pdf: { available: false, reason: null },
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, capabilities]);

  const handle = useCallback(
    async (fmt: ExportFormatSpec) => {
      // Disabled items are visual only — the click handler should never run for them.
      if (fmt.unavailableReason !== null) return;
      const label = fmt.label;
      setBusyFormat(label);
      try {
        await performExport(fmt, { sessionId, filePath, fileName, markdown }, downloadBlob);
        toastSuccess(label);
      } catch (e) {
        const msg = e instanceof ApiError ? apiErrorText(e) : S.common.unknownError;
        toastError(msg);
      } finally {
        setBusyFormat(null);
        setOpen(false);
      }
    },
    [markdown, fileName, sessionId, filePath],
  );

  const formats = buildExportFormats(capabilities);
  const busy = busyFormat !== null;

  return (
    <Dropdown
      open={open}
      setOpen={setOpen}
      menuClass="w-44"
      button={
        <button
          type="button"
          disabled={busy}
          title={busy && busyFormat !== null ? S.files.exportPreparing(busyFormat) : S.files.export}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-transparent bg-transparent px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-60 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100"
        >
          {busy && busyFormat !== null ? S.files.exportPreparing(busyFormat) : S.files.export}
        </button>
      }
    >
      <ul role="menu" className="text-sm">
        {formats.map((f) => {
          const disabled = f.unavailableReason !== null || busy;
          const title =
            f.unavailableReason !== null
              ? S.files.exportUnavailableReason(f.unavailableReason)
              : undefined;
          return (
            <li key={f.label} role="none">
              <button
                type="button"
                role="menuitem"
                disabled={disabled}
                title={title}
                onClick={() => void handle(f)}
                className="flex w-full items-center px-3 py-1.5 text-left text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-400 dark:text-gray-200 dark:hover:bg-gray-800 dark:disabled:text-gray-500"
              >
                {f.label}
              </button>
            </li>
          );
        })}
      </ul>
    </Dropdown>
  );
}
