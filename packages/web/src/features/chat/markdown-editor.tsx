/**
 * Markdown editor for in-place editing of Workspace .md files. Lazy-loads CodeMirror 6
 * (markdown lang + basicSetup + history + line numbers) so the chunk never enters the initial
 * bundle; the rest of the UI keeps using react-markdown for the read-only preview. Keys:
 * Cmd/Ctrl-S → save, Esc → cancel. The component owns the EditorView and destroys it on
 * unmount; props that drive the editor (value, theme, save/cancel handlers) are snapshotted
 * on mount and the parent only swaps them by remounting (WorkspaceBrowser toggles `richView`
 * which unmounts this component).
 */
import { useEffect, useRef, useState } from "react";
import type { Extension } from "@codemirror/state";
import { useTheme } from "../../state/theme";

export interface MarkdownEditorProps {
  value: string;
  onChange: (next: string) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}

export function MarkdownEditor({ value, onChange, onSave, onCancel, saving }: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { dark } = useTheme();
  // Refs capture the latest callbacks so the keymap (set once on mount) always sees the
  // current onSave / onCancel / saving without rebuilding the EditorView.
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const onCancelRef = useRef(onCancel);
  const savingRef = useRef(saving);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  onCancelRef.current = onCancel;
  savingRef.current = saving;

  useEffect(() => {
    let view: { destroy(): void } | null = null;
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;
    (async () => {
      try {
        const [{ EditorView, keymap }, { EditorState }, { markdown }, { history }] =
          await Promise.all([
            import("@codemirror/view"),
            import("@codemirror/state"),
            import("@codemirror/lang-markdown"),
            import("@codemirror/commands"),
          ]);
        if (cancelled || !container) return;
        const exts: Extension[] = [
          history(),
          markdown(),
          keymap.of([
            {
              key: "Mod-s",
              preventDefault: true,
              run: () => {
                onSaveRef.current();
                return true;
              },
            },
            {
              key: "Escape",
              run: () => {
                if (!savingRef.current) {
                  onCancelRef.current();
                  return true;
                }
                return false;
              },
            },
          ]),
          EditorView.theme(
            {
              "&": {
                fontSize: "13px",
                height: "100%",
              },
              ".cm-scroller": {
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
                lineHeight: "1.55",
              },
              ".cm-content": {
                padding: "12px 8px",
                caretColor: dark ? "#f3f4f6" : "#111827",
              },
              ".cm-gutters": {
                backgroundColor: "transparent",
                border: "none",
                color: dark ? "#4b5563" : "#9ca3af",
              },
              "&.cm-focused": {
                outline: "none",
              },
              ".cm-line": {
                paddingLeft: "4px",
              },
            },
            { dark },
          ),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString());
          }),
        ];
        const state = EditorState.create({ doc: value, extensions: exts });
        const v = new EditorView({ state, parent: container });
        view = v;
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load editor");
      }
    })();
    return () => {
      cancelled = true;
      view?.destroy();
    };
    // value is snapshotted on mount; the parent re-mounts this component when value flips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
        {error}
      </div>
    );
  }
  return <div ref={containerRef} className="h-full min-h-[200px] overflow-auto" />;
}
