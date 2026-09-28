/**
 * A .docx, shown as the document it is — one surface for reading and editing.
 *
 * These used to be two different things. The preview converted the file to HTML with mammoth and
 * styled it with the app's own CSS; the editor held the same document as Markdown in CodeMirror.
 * Neither was the document the user had opened, and they did not resemble each other either, so
 * switching between them felt like opening a different file. Every complaint that came out of that
 * — the cropped page, the editor that looked like a plain text box, the two views disagreeing —
 * traces back to the same cause: the page was not the page.
 *
 * `mode` is now the whole difference. `view` is a read-only rendering, `edit` is the same rendering
 * with editing enabled, and the engine keeps its place across the switch rather than remounting.
 *
 * The engine parses and serializes OOXML in the browser. Nothing about the document leaves the
 * machine: no upload, no conversion service, and no third party is asked for a font — the packaged
 * set is served from this bundle.
 *
 * Loaded through `React.lazy` at the call site. The engine is a layout and shaping pipeline, not a
 * form control, and a session that never opens a .docx should not pay for it.
 */
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import {
  DocxEditor,
  useDocxSource,
  type DocxEditorRef,
} from "@docx-editor.dev/react";
import { packagedFonts } from "@docx-editor.dev/fonts";
import zhCN from "@docx-editor.dev/i18n/zh-CN";
import "@docx-editor.dev/core/styles/editor.css";
import { workspaceFileUrl } from "../../api/endpoints";
import { useLocale } from "../../state/locale";
import { S } from "../../lib/strings";

export interface DocxSurfaceProps {
  sessionId: string;
  /** Workspace-relative path of the .docx. */
  path: string;
  /** Read-only rendering or the same rendering with editing on. */
  mode: "view" | "edit";
  /**
   * The saved bytes, straight from the engine. The parent decides where they go.
   *
   * Omitted in `view` mode, which has nothing to save — and omitting it is also what keeps the
   * engine's own download away: the chrome's save control only appears when a host supplies one.
   */
  onSave?: (bytes: ArrayBuffer) => void;
}

export interface DocxSurfaceHandle {
  /**
   * The current document, serialized. `null` before mount or with no document.
   *
   * Exposed because the panel's own Save and Save-as live outside this component: the engine's own
   * control would download a file, and what these bytes need is to go back to the workspace.
   */
  save(): Promise<ArrayBuffer | null>;
}

export default forwardRef<DocxSurfaceHandle, DocxSurfaceProps>(function DocxSurface(
  { sessionId, path, mode, onSave },
  ref,
) {
  const editorRef = useRef<DocxEditorRef | null>(null);
  const { locale } = useLocale();
  // `lang` is a preference ("system" is a valid value) and `locale` is what it resolved to, so the
  // resolved tag is the one that can answer "is this a Chinese reader".
  const isChinese = locale.toLowerCase().startsWith("zh");

  // Bytes, a stable font resolver, and the loading/error state, in one call. The href is the same
  // same-origin, cookie-authenticated URL the download link uses, so a .docx needs no new endpoint.
  const { document, fonts, error } = useDocxSource(workspaceFileUrl(sessionId, path), {
    fonts: packagedFonts(),
  });

  const handleSave = useCallback(async () => {
    if (onSave === undefined) return;
    const bytes = await editorRef.current?.save();
    // `null` means no document is mounted — there is nothing to write, and saving an empty file over
    // a real one is the failure this guards.
    if (bytes !== null && bytes !== undefined) onSave(bytes);
  }, [onSave]);

  // Hands the panel the same bytes the engine's own control would have downloaded.
  useImperativeHandle(
    ref,
    () => ({
      save: async () => (await editorRef.current?.save()) ?? null,
    }),
    [],
  );

  // A font that could not be loaded is not fatal: the glyphs still paint in their true faces and
  // only the measured line breaks are approximate. It is reported rather than shown, so a
  // substitute face does not put an error across a document the user can still read.
  const handleFontError = useCallback((fontError: { message?: string }) => {
    console.warn("[docx] font could not be loaded:", fontError.message ?? fontError);
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {error !== null && (
        <p className="mb-2 shrink-0 text-sm text-red-600 dark:text-red-400">
          {S.files.docxPreviewFailed(error.message)}
        </p>
      )}
      {/* The editor fills its parent and needs a non-zero height, which is what `flex-1` inside a
          `min-h-0` column gives it once the error line is out of the way. */}
      <div className="min-h-0 flex-1">
        <DocxEditor
          ref={editorRef}
          document={document}
          mode={mode}
          // Read-only gets the document alone: the panel already owns its toolbar, and a second
          // title bar beside the file's name is noise. Editing needs the formatting controls, so it
          // keeps the chrome — but not the menu, whose File rows the app already answers.
          chrome={mode === "edit"}
          menu={false}
          title={path.split("/").pop() ?? ""}
          // 'auto' fits the page to the container. This is the fix for the cropped page: the panel
          // is 320–720px and a Letter sheet is wider than all of it, so the engine scales the sheet
          // down instead of overflowing it.
          zoomMode="auto"
          // The reader's language, and the region its dates come from. Falls back to English keys
          // for anything the catalogue leaves out, so a partial translation is never a broken UI.
          i18n={isChinese ? zhCN : undefined}
          locale={locale}
          colorMode="system"
          fonts={fonts}
          onSave={onSave === undefined ? undefined : () => void handleSave()}
          onFontError={handleFontError}
        />
      </div>
    </div>
  );
});
