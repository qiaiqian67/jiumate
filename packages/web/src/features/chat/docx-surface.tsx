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
 * **Composed rather than packaged**, because the packaged frame is a title bar, a menu, rulers and
 * a page-furniture row stacked above the document, and this surface lives in a side panel a few
 * hundred pixels tall. Every one of those rows came out of the editor's height: the title bar repeats
 * the file name the panel already shows, the menu's File rows duplicate the panel's own Save and
 * Export, and the font and page-number readouts are diagnostics rather than writing surface. What
 * stays is the toolbar — the one piece the panel cannot supply — and the viewport, which is the
 * engine's sole scroll container.
 *
 * The engine parses and serializes OOXML in the browser. Nothing about the document leaves the
 * machine: no upload, no conversion service, and no third party is asked for a font — the packaged
 * set is served from this bundle.
 *
 * Loaded through `React.lazy` at the call site. The engine is a layout and text-shaping pipeline,
 * not a form control, and a session that never opens a .docx should not pay for it.
 */
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import {
  DocxEditor,
  LocaleProvider,
  useChromeTranslate,
  useDocxSource,
  type DocxEditorRef,
} from "@docx-editor.dev/react";
import { packagedFonts } from "@docx-editor.dev/fonts";
import zhCN from "@docx-editor.dev/i18n/zh-CN";
import "@docx-editor.dev/core/styles/editor.css";
import { workspaceFileUrl } from "../../api/endpoints";
import { useLocale } from "../../state/locale";
import { useTheme } from "../../state/theme";
import { S } from "../../lib/strings";

export interface DocxSurfaceHandle {
  /**
   * The current document, serialized. `null` before mount or with no document.
   *
   * Exposed because the panel's own Save and Save-as live outside this component: the engine's own
   * control would download a file, and what these bytes need is to go back to the workspace.
   */
  save(): Promise<ArrayBuffer | null>;
}

export interface DocxSurfaceProps {
  sessionId: string;
  /** Workspace-relative path of the .docx. */
  path: string;
  /** Read-only rendering or the same rendering with editing on. */
  mode: "view" | "edit";
  /**
   * The saved bytes, straight from the engine. Omitted in read-only mode, where there is nothing to
   * save and no control to save with.
   */
  onSave?: (bytes: ArrayBuffer) => void;
  /**
   * The save handle, handed over once on mount and `null` again on unmount.
   *
   * A callback rather than a ref, because this component is reached through `React.lazy` and a ref
   * placed on a lazy component does not arrive: the panel's Save would find `null` and return
   * without a word, which is exactly what it did. A prop travels through `lazy` like any other.
   */
  onHandle?: (handle: DocxSurfaceHandle | null) => void;
}

/**
 * The toolbar, and nothing else.
 *
 * It needs `t` rather than reading the catalog itself: a composed toolbar with no resolver renders
 * raw translation keys, which the packaged editor avoids by wiring the two together for you. Reading
 * the resolver here, inside the provider, is what puts the labels back.
 */
function Toolbar({ onSave }: { onSave: () => void }) {
  const t = useChromeTranslate();
  return <DocxEditor.Toolbar t={t} onSave={onSave} />;
}

export default function DocxSurface({ sessionId, path, mode, onSave, onHandle }: DocxSurfaceProps) {
  const editorRef = useRef<DocxEditorRef | null>(null);
  const { locale } = useLocale();
  const { dark } = useTheme();
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

  // The panel's Save and Save-as live outside this component, so they call through here. Registered
  // through a prop rather than a ref: see `onHandle`. Laid out rather than deferred, so the handle
  // exists before the first paint — an effect would leave one frame where Save reads `null`.
  useLayoutEffect(() => {
    if (onHandle === undefined) return;
    onHandle({
      save: async () => (await editorRef.current?.save()) ?? null,
    });
    return () => onHandle(null);
  }, [onHandle]);

  // A font that could not be loaded is not fatal: the glyphs still paint in their true faces and
  // only the measured line breaks are approximate. Reported rather than shown — the packaged
  // editor's font notice is one of the rows this layout does without.
  const handleFontError = useCallback((fontError: { message?: string }) => {
    console.warn("[docx] font could not be loaded:", fontError.message ?? fontError);
  }, []);

  return (
    // The editor fills whichever element holds it, so that element needs a height — here the panel's
    // remaining space. `min-h-0` is what lets a flex child shrink below its content, which is what
    // keeps the document's own scrollbar inside the viewport instead of growing the panel and
    // handing the whole page a scrollbar.
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {error !== null && (
        <p className="shrink-0 px-1 pb-1 text-sm text-red-600 dark:text-red-400">
          {S.files.docxPreviewFailed(error.message)}
        </p>
      )}
      <LocaleProvider i18n={isChinese ? zhCN : undefined}>
        <DocxEditor.Root
          document={document}
          mode={mode}
          // 'auto' fits the page to the container. This is the fix for the cropped page: the panel
          // is 320–720px and a Letter sheet is wider than all of it, so the engine scales the sheet
          // down instead of overflowing it.
          zoomMode="auto"
          locale={locale}
          fonts={fonts}
          onFontError={handleFontError}
        >
          {/* Read-only gets no toolbar: there is nothing to format, and in a panel this short the
              row is worth more as document. */}
          {mode === "edit" && <Toolbar onSave={() => void handleSave()} />}
          {/* `dark` is the chrome theme here. The packaged editor takes a `colorMode` prop, but a
              composed `Root` has none — the class on the viewport is what carries it, and the
              document canvas keeps the document's own colours either way. */}
          <DocxEditor.Viewport className={`min-h-0 flex-1${dark ? " dark" : ""}`}>
            <DocxEditor.Content />
          </DocxEditor.Viewport>
        </DocxEditor.Root>
      </LocaleProvider>
    </div>
  );
}
