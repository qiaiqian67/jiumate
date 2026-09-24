/**
 * A .docx rendered as the document it is.
 *
 * The preview used to show mammoth's HTML: a semantic rendering of the text — headings, lists,
 * tables — styled by this app. It was never the document. Fonts, colours, table borders, margins and
 * page size were all the app's, so the preview, the export and the file on disk were three
 * renderings of the same text that agreed on none of them. That is the difference the user noticed
 * between what they previewed and what they exported.
 *
 * `docx-preview` reads the real file — its styles, numbering and section properties — and lays it
 * out as a page. What appears is what Word would show, and it is the same file Export hands over, so
 * the two cannot drift apart.
 *
 * Loaded on demand. docx-preview is a few hundred kilobytes and only a session that opens a .docx
 * needs any of it, so the parent pulls this in through `React.lazy`.
 *
 * The page is white in both themes on purpose. A document is white; tinting it to match the app
 * would be a fourth rendering that agrees with nothing.
 */
import { useEffect, useRef, useState } from "react";
import { workspaceFileUrl } from "../../api/endpoints";
import { S } from "../../lib/strings";

export interface DocxRendererProps {
  sessionId: string;
  /** Workspace-relative path of the .docx to render. */
  path: string;
}

export default function DocxRenderer({ sessionId, path }: DocxRendererProps) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        // The bytes and the renderer in parallel: neither depends on the other, and the fetch is
        // the slower of the two on a document worth previewing.
        const [docxPreview, response] = await Promise.all([
          import("docx-preview"),
          fetch(workspaceFileUrl(sessionId, path)),
        ]);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        // The effect can be torn down while the fetch is in flight (the user navigated away, or
        // saved and the preview refreshed); rendering into a detached node would leak a page.
        if (cancelled) return;
        body.replaceChildren();
        await docxPreview.renderAsync(blob, body, undefined, {
          className: "docx",
          inWrapper: true,
          breakPages: true,
          ignoreLastRenderedPageBreak: true,
          renderHeaders: true,
          renderFooters: true,
          useBase64URL: true,
        });
        if (!cancelled) setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, path]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {error !== null && (
        <p className="mb-2 shrink-0 text-sm text-red-600 dark:text-red-400">
          {S.files.docxPreviewFailed(error)}
        </p>
      )}
      {loading && error === null && (
        <p className="shrink-0 text-sm text-gray-500 dark:text-gray-400">
          {S.files.docxPreviewLoading}
        </p>
      )}
      {/* Always mounted: docx-preview renders into this node, so it has to exist before the
          document arrives. */}
      <div
        ref={bodyRef}
        className="docx-host min-h-[60vh] flex-1 overflow-auto rounded-md border border-gray-200 bg-white p-2 dark:border-gray-800"
      />
    </div>
  );
}
