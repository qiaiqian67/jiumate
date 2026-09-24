/**
 * Rich-text editor for a .docx.
 *
 * Editing a Word document used to mean editing its Markdown: the editor was CodeMirror holding the
 * document's text as source, and saving rebuilt the .docx from that Markdown. The user saw `##`
 * where Word shows a heading, and `**` where it shows bold — the document they opened, shown as
 * something else. This is the same content as formatted text: headings look like headings, bold
 * looks bold, tables are tables. What it emits is HTML, which is exactly what the save route hands
 * to Pandoc, so the text the user typed is the text that gets written.
 *
 * The styling of the saved document does not come from here. Pandoc takes each paragraph's
 * formatting from named styles, and those come from the document being edited — see the save
 * route's reference document. This editor decides *what* the document says, not what it looks like.
 *
 * Loaded through `React.lazy` at the call site. TipTap brings ProseMirror and a set of extensions,
 * and a session that never opens a .docx should not pay for them.
 *
 * Props are read once, at mount: TipTap seeds its document from `value` and owns it afterwards, so
 * the parent reseeds by remounting (it keys this component on the preview's nonce, the same way the
 * Markdown editor is remounted).
 */
import { useEffect, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { S } from "../../lib/strings";

export interface DocxEditorProps {
  /** The document's content as HTML — what the preview converted it to. */
  value: string;
  /**
   * Every edit, as HTML.
   *
   * The editor's own Save sends the current document, so this is not how saving works — it exists
   * because the toolbar's Save and Save-as sit outside this component and have to save the same
   * bytes. Without it they would save the content the editor was seeded with, quietly discarding
   * whatever the user had typed since.
   */
  onChange: (html: string) => void;
  onSave: (html: string) => void;
  onCancel: () => void;
  saving: boolean;
}

/**
 * Replaces every `<img>` with the words the banner promises.
 *
 * TipTap has no image node here, so an `<img>` would be dropped without a trace — the text would
 * simply be missing from the saved document. The extraction already cannot carry images through
 * this round trip, so saying so in the text is the honest version of losing them.
 */
function replaceImages(html: string): string {
  return html.replace(/<img\b[^>]*>/gi, "[image omitted]");
}

export default function DocxEditor({ value, onChange, onSave, onCancel, saving }: DocxEditorProps) {
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const onCancelRef = useRef(onCancel);
  const savingRef = useRef(saving);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  onCancelRef.current = onCancel;
  savingRef.current = saving;

  const editor = useEditor({
    extensions: [
      StarterKit,
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: replaceImages(value),
    // Through a ref so the callback identity never rebuilds the editor — TipTap would treat a new
    // `onUpdate` as a new configuration and re-create the view, losing the cursor mid-keystroke.
    onUpdate: ({ editor: current }) => onChangeRef.current(current.getHTML()),
    editorProps: {
      attributes: {
        class:
          "docx-body min-h-[40vh] max-w-none px-1 py-2 text-base leading-relaxed text-gray-800 outline-none dark:text-gray-100",
      },
    },
  });

  // The keydown listener is installed once, so it reads the editor through a ref rather than
  // closing over the first render's `editor` (which is null until TipTap mounts).
  const editorRef = useRef(editor);
  editorRef.current = editor;

  // Cmd/Ctrl-S and Escape, the same pair the Markdown editor binds. On the container rather than
  // on `document` so a save typed into some other panel's editor is not this editor's save.
  const containerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (!savingRef.current) onSaveRef.current(editorRef.current?.getHTML() ?? "");
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onCancelRef.current();
      }
    };
    node.addEventListener("keydown", onKeyDown);
    return () => node.removeEventListener("keydown", onKeyDown);
  }, []);

  if (!editor) {
    return (
      <p className="px-1 py-2 text-sm text-gray-500 dark:text-gray-400">
        {S.files.docxToolbar.loading}
      </p>
    );
  }

  const chain = () => editor.chain().focus();

  return (
    <div ref={containerRef} className="flex flex-col">
      <div className="mb-2 flex flex-wrap items-center gap-0.5 rounded-md border border-gray-200 bg-gray-50 p-1 dark:border-gray-800 dark:bg-gray-900">
        <ToolButton
          label={S.files.docxToolbar.bold}
          active={editor.isActive("bold")}
          onClick={() => chain().toggleBold().run()}
        >
          <span className="font-bold">B</span>
        </ToolButton>
        <ToolButton
          label={S.files.docxToolbar.italic}
          active={editor.isActive("italic")}
          onClick={() => chain().toggleItalic().run()}
        >
          <span className="italic">I</span>
        </ToolButton>
        <ToolButton
          label={S.files.docxToolbar.underline}
          active={editor.isActive("underline")}
          onClick={() => chain().toggleUnderline().run()}
        >
          <span className="underline">U</span>
        </ToolButton>
        <ToolButton
          label={S.files.docxToolbar.strike}
          active={editor.isActive("strike")}
          onClick={() => chain().toggleStrike().run()}
        >
          <span className="line-through">S</span>
        </ToolButton>
        <Divider />
        {([1, 2, 3] as const).map((level) => (
          <ToolButton
            key={level}
            label={
              level === 1
                ? S.files.docxToolbar.heading1
                : level === 2
                  ? S.files.docxToolbar.heading2
                  : S.files.docxToolbar.heading3
            }
            active={editor.isActive("heading", { level })}
            onClick={() => chain().toggleHeading({ level }).run()}
          >
            H{level}
          </ToolButton>
        ))}
        <ToolButton
          label={S.files.docxToolbar.paragraph}
          active={editor.isActive("paragraph")}
          onClick={() => chain().setParagraph().run()}
        >
          ¶
        </ToolButton>
        <Divider />
        <ToolButton
          label={S.files.docxToolbar.bulletList}
          active={editor.isActive("bulletList")}
          onClick={() => chain().toggleBulletList().run()}
        >
          •≡
        </ToolButton>
        <ToolButton
          label={S.files.docxToolbar.orderedList}
          active={editor.isActive("orderedList")}
          onClick={() => chain().toggleOrderedList().run()}
        >
          1≡
        </ToolButton>
        <Divider />
        <ToolButton
          label={S.files.docxToolbar.insertTable}
          active={editor.isActive("table")}
          onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
        >
          ⊞
        </ToolButton>
        <ToolButton
          label={S.files.docxToolbar.insertLink}
          active={editor.isActive("link")}
          onClick={() => {
            // `window.prompt` rather than a popover: a link is one field, and the rest of this
            // toolbar has no popovers to put it in. Empty input clears the link, which is the only
            // way to undo one without selecting the text and retyping it.
            const previous = editor.getAttributes("link").href as string | undefined;
            const href = window.prompt(S.files.docxToolbar.insertLink, previous ?? "https://");
            if (href === null) return;
            if (href === "") chain().unsetLink().run();
            else chain().setLink({ href }).run();
          }}
        >
          ⛓
        </ToolButton>
        {editor.isActive("table") && (
          <>
            <Divider />
            <ToolButton
              label={S.files.docxToolbar.addRow}
              active={false}
              onClick={() => chain().addRowAfter().run()}
            >
              +行
            </ToolButton>
            <ToolButton
              label={S.files.docxToolbar.addColumn}
              active={false}
              onClick={() => chain().addColumnAfter().run()}
            >
              +列
            </ToolButton>
            <ToolButton
              label={S.files.docxToolbar.deleteTable}
              active={false}
              onClick={() => chain().deleteTable().run()}
            >
              删表
            </ToolButton>
          </>
        )}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}

function Divider() {
  return <span className="mx-1 h-4 w-px shrink-0 bg-gray-300 dark:bg-gray-700" />;
}

function ToolButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded px-1.5 text-xs font-medium transition-colors duration-150 ${
        active
          ? "bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-white"
          : "text-gray-600 hover:bg-gray-200 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}
