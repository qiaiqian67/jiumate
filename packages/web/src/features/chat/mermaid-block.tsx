/**
 * Renders a Mermaid diagram fenced in a Markdown block. Mermaid is heavy (~700KB minified, ~200KB
 * gzipped), so it is lazy-imported only when a mermaid fence actually lands in the rendered tree;
 * chat and workspace file previews share this component, but neither pays the bundle cost until a
 * diagram shows up.
 *
 * `code` is the diagram source as written between ```mermaid fences. `nonce` keys the React mount
 * and the Mermaid id, so two diagrams with the same source on the same page never collide on the
 * internal DOM id Mermaid requires; also, a re-render (theme flip, dark mode switch) gets a fresh
 * container rather than fighting Mermaid's own SVG diff.
 *
 * `theme` selects the palette. Mermaid itself ships a `default` and a `dark` theme — passing
 * `theme: "dark"` for the dark UI avoids hand-rolling a separate stylesheet for `.dark` overrides.
 *
 * Errors during parse / render are surfaced as the original source in a dotted-underline block,
 * matching the way KaTeX failures degrade the formula pipeline (see markdown-plugins.ts KATEX_OPTIONS
 * `errorColor: "currentColor"` for the same intent).
 */
import { useEffect, useRef, useState } from "react";
import { useTheme } from "../../state/theme";

export function MermaidBlock({ code, nonce }: { code: string; nonce: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { dark } = useTheme();
  // Tracks the in-flight render id: if a new `code` arrives while a previous render is still
  // pending, only the latest result lands in the container — the stale render's SVG is dropped.
  const renderIdRef = useRef(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const id = `jiumate-mermaid-${nonce}`;
    const myRenderId = ++renderIdRef.current;
    let cancelled = false;
    setError(null);
    container.innerHTML = "";
    void (async () => {
      try {
        const mod = await import("mermaid");
        if (cancelled || renderIdRef.current !== myRenderId) return;
        // mermaid's package.json exposes the engine as the default export; some bundlers
        // unwrap a CommonJS interop and put the same object on both `.default` and the
        // namespace itself. Normalize here so both Vite's ESM dev build and a CJS-flavored
        // production build land on the same object.
        const mermaid = (mod as { default?: unknown }).default ?? mod;
        const api = mermaid as {
          initialize: (cfg: Record<string, unknown>) => void;
          render: (id: string, code: string) => Promise<{ svg: string }>;
        };
        api.initialize({
          startOnLoad: false,
          // Mermaid's two built-in themes; selecting "dark" here lets its SVG pick up the dark
          // text/grid palette without us maintaining a custom theme.
          theme: dark ? "dark" : "default",
          // Security: mermaid blocks can contain clickable nodes; we don't need this surface to
          // open links and mermaid's docs warn about click handlers in untrusted diagrams.
          securityLevel: "strict",
          // Keep the diagram compact — the file preview pane can be narrow, and the chat body
          // already constrains max width.
          flowchart: { htmlLabels: false },
        });
        const { svg } = await api.render(id, code);
        if (cancelled || renderIdRef.current !== myRenderId) return;
        container.innerHTML = svg;
      } catch (e: unknown) {
        if (cancelled || renderIdRef.current !== myRenderId) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, nonce, dark]);

  if (error) {
    // Degrade to the source: same intent as `.katex-error` for math (markdown-plugins.ts).
    return (
      <pre className="overflow-auto rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
        <code>{code}</code>
      </pre>
    );
  }
  return (
    // overflow-x-auto: a wide flowchart/gantt in a narrow pane (mobile, docked panel) needs
    // horizontal scroll rather than shrinking the diagram. min-height reserves space so the
    // container doesn't start at 0 before mermaid finishes rendering the SVG (a 0-height
    // container for a split second produces a visible jump as the SVG lands inside).
    <div
      ref={containerRef}
      className="mermaid-block my-3 min-h-[60px] overflow-x-auto text-center"
    />
  );
}
