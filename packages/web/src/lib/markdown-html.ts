/**
 * Renders a Markdown string to a self-contained HTML document for export.
 *
 * The export pipeline (server-side Pandoc for DOCX/EPUB/RTF/TXT, desktop-side
 * `webContents.printToPDF` for PDF) needs a complete HTML document with Mermaid
 * diagrams and KaTeX formulas already in their final form — there is no JS runtime on
 * the Pandoc side, and Chromium's `printToPDF` should not have to re-render async
 * Mermaid renders inside a hidden window.
 *
 * The flow:
 * 1. Pre-render every ```mermaid fence to an SVG string via `mermaid.render`. Failed
 *    diagrams degrade to a `<pre>` of the source (mirrors MermaidBlock's error path);
 *    the export still produces a usable document, and the user can fix the diagram in
 *    the source.
 * 2. Substitute the SVG into the Markdown source under a synthetic `mermaid-svg` info
 *    string, so the unified pipeline treats it as already-rendered HTML and skips the
 *    MermaidBlock React component (which is a runtime mount, not a server-render target).
 * 3. Run the same unified pipeline the chat surface uses (`REMARK_PLUGINS` /
 *    `REHYPE_PLUGINS`) through `renderToStaticMarkup`, with a custom `pre` adapter that
 *    unwraps only the `mermaid-svg` pair and falls back to a plain `<pre>` for any
 *    other language.
 * 4. Wrap the rendered body in a full document with a KaTeX stylesheet link and a
 *    print-friendly stylesheet. The result is a single string the caller can drop into
 *    a `<a download>` (HTML export) or POST to the server (PDF/DOCX/... export).
 */
import { createElement, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { REHYPE_PLUGINS, REMARK_PLUGINS } from "./markdown-plugins";

/** Mermaid block info string. We swap the source for one carrying this so the rehype pass
 *  treats the contents as already-rendered SVG and the runtime MermaidBlock component never
 *  tries to mount. */
const RENDERED_INFO = "mermaid-svg";

/** ` ```mermaid\n...\n``` ` with non-greedy body, multiline. */
const MERMAID_FENCE = /^[ \t]*```[ \t]*(?:mermaid)[ \t]*\n([\s\S]*?)\n[ \t]*```[ \t]*$/gm;

/** Extract every Mermaid body in source order, deduped. */
function collectMermaidSources(source: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of source.matchAll(MERMAID_FENCE)) {
    const body = match[1] ?? "";
    if (seen.has(body)) continue;
    seen.add(body);
    out.push(body);
  }
  return out;
}

/** Render one diagram. Returns the SVG markup; on failure returns a `<pre>` fallback. */
async function renderMermaidToSvg(code: string, idHint: string, dark: boolean): Promise<string> {
  const mod = await import("mermaid");
  const mermaid = (mod as { default?: unknown }).default ?? mod;
  const api = mermaid as {
    initialize: (cfg: Record<string, unknown>) => void;
    render: (id: string, code: string) => Promise<{ svg: string }>;
  };
  api.initialize({
    startOnLoad: false,
    theme: dark ? "dark" : "default",
    securityLevel: "strict",
    flowchart: { htmlLabels: false },
  });
  try {
    const { svg } = await api.render(`export-${idHint}`, code);
    return svg;
  } catch (e) {
    // Surface the failure as a code block the user can read. Mirrors the in-app
    // MermaidBlock error path; a bad diagram never aborts the whole export.
    const reason = e instanceof Error ? e.message : String(e);
    return `<pre class="mermaid-error">${escapeHtml(code)}\n\n<!-- ${escapeHtml(reason)} --></pre>`;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Pull a body out of a React code element's children (string or string[] in practice). */
function codeText(children: unknown): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.filter((c) => typeof c === "string").join("");
  return "";
}

/** Pre adapter for the static render. Only the `mermaid-svg` info string is special; every
 *  other language falls through to a plain `<pre><code>`, which Pandoc and `printToPDF` both
 *  render as a monospace block. */
function StaticPre({ children }: { children?: unknown }) {
  if (isValidElement(children)) {
    const props = children.props as { className?: string; children?: unknown };
    const cls = Array.isArray(props.className)
      ? props.className.join(" ")
      : (props.className ?? "");
    const language = /language-([\w+-]+)/.exec(cls)?.[1] ?? "";
    if (language === RENDERED_INFO) {
      return createElement("div", {
        className: "mermaid-block my-3 overflow-x-auto text-center",
        dangerouslySetInnerHTML: { __html: codeText(props.children) },
      });
    }
    return createElement("pre", {}, children as never);
  }
  return createElement("pre", {}, children as never);
}

export interface SerializeOptions {
  title?: string;
  /** Used to pick the Mermaid theme (default palette vs. dark) so the rendered SVG
   *  matches what the user is looking at in the Files panel. */
  theme?: "light" | "dark";
  /** Override the KaTeX stylesheet href. Defaults to the official jsDelivr CDN; tests
   *  pin a no-op (`""`) so the result is portable and offline. */
  katexStylesheet?: string;
}

export interface SerializedMarkdown {
  /** The full HTML document, ready to save as `.html` or POST to the export endpoint. */
  html: string;
  /** True iff at least one Mermaid block was rendered (or attempted). */
  hasMermaid: boolean;
}

/**
 * Convert Markdown to a self-contained HTML document. Mermaid fences are pre-rendered to
 * SVG inline; KaTeX styles are linked from a CDN; GFM tables, task lists, strikethrough,
 * and MathJax/KaTeX syntax all flow through the shared unified pipeline the chat surface
 * uses (`REMARK_PLUGINS` / `REHYPE_PLUGINS` from `lib/markdown-plugins`).
 */
export async function serializeMarkdownToHtml(
  source: string,
  options: SerializeOptions = {},
): Promise<SerializedMarkdown> {
  const mermaidBodies = collectMermaidSources(source);
  const hasMermaid = mermaidBodies.length > 0;
  let replaced = source;

  if (hasMermaid) {
    // Render in parallel — mermaid.render is async, and the order of the output (an SVG
    // string per body) is preserved by the call index. A `Map<body, svg>` lookup means a
    // body that appears multiple times in the document only renders once but every
    // occurrence gets the same SVG.
    const svgs = await Promise.all(
      mermaidBodies.map((code, i) => renderMermaidToSvg(code, String(i), options.theme === "dark")),
    );
    const svgByBody = new Map<string, string>();
    for (let i = 0; i < mermaidBodies.length; i += 1) {
      svgByBody.set(mermaidBodies[i]!, svgs[i] ?? "");
    }
    const open = "```" + RENDERED_INFO + "\n";
    const close = "\n```";
    replaced = source.replace(MERMAID_FENCE, (match, body: string) => {
      const svg = svgByBody.get(body) ?? "";
      // Reconstruct: the regex captured only the inner body, not the leading fence info
      // string, so we re-emit with our info string. The original whitespace/closing fence
      // are reconstructed from the match boundary.
      return open + svg + close;
    });
  }

  const body = renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      {
        remarkPlugins: REMARK_PLUGINS,
        rehypePlugins: REHYPE_PLUGINS,
        components: { pre: StaticPre },
      },
      replaced,
    ),
  );

  const title = options.title ?? "Document";
  const katexHref =
    options.katexStylesheet ?? "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css";
  const katexLink =
    katexHref.length > 0 ? `<link rel="stylesheet" href="${escapeHtml(katexHref)}" />` : "";

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
${katexLink}
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; line-height: 1.6; max-width: 860px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
  h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin-top: 1.5em; }
  h1 { font-size: 1.8rem; border-bottom: 1px solid #e5e7eb; padding-bottom: 0.3em; }
  h2 { font-size: 1.4rem; border-bottom: 1px solid #f3f4f6; padding-bottom: 0.2em; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.9em; background: #f3f4f6; padding: 0.1em 0.3em; border-radius: 3px; }
  pre { background: #f9fafb; padding: 1em; border-radius: 6px; overflow-x: auto; }
  pre code { background: transparent; padding: 0; }
  table { border-collapse: collapse; margin: 1em 0; }
  th, td { border: 1px solid #e5e7eb; padding: 0.4em 0.8em; }
  th { background: #f9fafb; }
  blockquote { border-left: 4px solid #d1d5db; padding-left: 1em; color: #4b5563; margin: 1em 0; }
  img { max-width: 100%; height: auto; }
  .task-list-item { list-style: none; margin-left: -1.4em; }
  .task-list-item input { margin-right: 0.4em; }
  .mermaid-block svg { display: block; max-width: 100%; height: auto; }
  .mermaid-error { color: #b91c1c; background: #fef2f2; border: 1px solid #fecaca; }
  @media print { body { max-width: none; margin: 0; } }
</style>
</head>
<body>
${body}
</body>
</html>`;

  return { html, hasMermaid };
}
