/**
 * Markdown body memoized by text identity. The stream model mutates chat items in place and
 * only reassigns `text` when a delta arrives, so every settled message keeps the same string
 * instance across the per-frame version bumps — the shallow prop compare then skips its entire
 * micromark → mdast → React re-parse, and only the actively-streaming message re-renders.
 * Without this, each animation frame during a stream re-parsed the WHOLE transcript (O(n²)
 * over a long reply), which visibly froze the UI while large code blocks streamed in.
 *
 * Fenced code blocks render through CodeBlock (language chrome + copy button + Shiki
 * highlight). `streaming` disables highlighting while deltas are still arriving —
 * re-tokenizing a growing block every frame is O(n²) main-thread cost — and the settle
 * re-render (new string instance, streaming=false) highlights each block exactly once.
 * Inline code keeps the default rendering (`.md-body code` styling).
 *
 * KaTeX is held back the same way, for the same reason: `streaming` swaps the rehype stage
 * out, so a formula shows its own TeX source until the message settles and is typeset once
 * (see NO_REHYPE_PLUGINS in lib/markdown-plugins.ts for the measurements).
 */
import { isValidElement, memo } from "react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { Components, ExtraProps } from "react-markdown";
import { NO_REHYPE_PLUGINS, REHYPE_PLUGINS, REMARK_PLUGINS } from "../../lib/markdown-plugins";
import { CodeBlock } from "./code-block";
import { MermaidBlock } from "./mermaid-block";

/** Flatten a react-markdown code element's children to plain text (string or string array in practice). */
function codeText(children: unknown): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.filter((c) => typeof c === "string").join("");
  return "";
}

/**
 * Stable 32-bit hash of a string. Used to derive a deterministic Mermaid nonce per source-code
 * shape, so a diagram whose body didn't change keeps the same nonce across renders (Mermaid's
 * internal DOM id stays stable, no re-render) and a code edit flips the nonce (Mermaid re-renders
 * the SVG). Not cryptographic — collision rate of 1/2^32 is plenty for "two diagrams on one page".
 */
function hash32(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * Fenced-block adapter: unwraps the <pre><code class="language-x"> pair react-markdown emits into
 * CodeBlock.
 *
 * `language-math` is the exception. remark-math models block math as a fence in that language and
 * rehype-katex replaces the whole pair before this adapter is consulted — except while streaming,
 * where the rehype stage is off, and the block would otherwise pick up CodeBlock's chrome and copy
 * button for the few hundred milliseconds before it settles into a formula. A plain <pre> is the
 * source either way, so the settle changes the typesetting and nothing else.
 *
 * `language-mermaid` routes through MermaidBlock instead of CodeBlock: Mermaid has its own heavy
 * lazy import and rendering pipeline, and CodeBlock's chrome (Shiki highlighting, copy button,
 * language label) is meaningless for an SVG. The `id` argument seeds the nonce so two messages on
 * the same page with the same diagram body don't collide on Mermaid's required-unique DOM id.
 */
function MdPre({
  children,
  streaming,
  id,
}: {
  children?: ReactNode;
  streaming: boolean;
  id: string;
}) {
  if (isValidElement(children)) {
    const props = children.props as { className?: string; children?: unknown };
    const language = /language-([\w+-]+)/.exec(props.className ?? "")?.[1] ?? "";
    if (language === "math") return <pre>{children}</pre>;
    if (language === "mermaid") {
      // Mermaid is heavy (~700KB minified); skip the render while deltas are still arriving — a
      // streaming reply can flip the source dozens of times per second, and re-rendering Mermaid
      // on every delta freezes the chat. The settled render re-renders exactly once.
      if (streaming) return <pre>{children}</pre>;
      const code = codeText(props.children).replace(/\n$/, "");
      return <MermaidBlock code={code} nonce={`${id}-${hash32(code)}`} />;
    }
    return (
      <CodeBlock
        language={language}
        code={codeText(props.children).replace(/\n$/, "")}
        highlight={!streaming}
      />
    );
  }
  return <pre>{children}</pre>;
}

/**
 * Link adapter: every chat link opens in a new tab (`target="_blank"` + `rel="noreferrer"`,
 * which also implies `noopener`), unconditionally — including relative and `#anchor` hrefs a
 * model may emit — so clicking a reply link never navigates the SPA away from the live
 * conversation. All other anchor props react-markdown supplies (`href`, `title` from
 * `[text](url "title")`, ...) are forwarded as-is — only its non-DOM `node` prop is stripped —
 * and `target`/`rel` sit after the spread so the new-tab behavior always wins.
 * Long-URL wrapping is CSS (`.md-body a` in styles.css), not handled here.
 */
function MdLink({
  node: _node,
  children,
  ...anchorProps
}: ComponentPropsWithoutRef<"a"> & ExtraProps) {
  return (
    <a {...anchorProps} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

/**
 * The two `components` maps, built once at module scope instead of inline per render.
 * react-markdown uses `components.pre` as the element **type**, so a fresh arrow each render is
 * a new type on every commit: React unmounts and remounts every code block, dropping the user's
 * text selection and resetting each block's Copy-button state — ~8 times a second while a reply
 * streams, including for blocks that closed long ago. `streaming` is the only thing the adapter
 * closes over, so one frozen map per value is enough; the single flip between them happens on
 * the settle render, which re-parses the message anyway — the same render the rehype stage
 * flips on. The `a` adapter closes over nothing, so both maps share the one `MdLink` reference.
 * Mermaid nonce takes the caller's id so two messages on one page with the same diagram don't
 * collide on Mermaid's required-unique DOM id.
 */
const STREAMING_COMPONENTS: Components = {
  pre: (props) => (
    <MdPre streaming id="msg">
      {props.children}
    </MdPre>
  ),
  a: MdLink,
};
const SETTLED_COMPONENTS: Components = {
  pre: (props) => (
    <MdPre streaming={false} id="msg">
      {props.children}
    </MdPre>
  ),
  a: MdLink,
};

export const Md = memo(function Md({
  text,
  streaming = false,
  id,
}: {
  text: string;
  streaming?: boolean;
  /**
   * Stable per-render-context identifier used to disambiguate Mermaid DOM ids across multiple
   * Markdown bodies on one page (chat messages, the workspace preview, etc.). Defaults to "md"
   * when no caller-supplied id is present — same-doc collisions are rare and Mermaid will simply
   * overwrite, which is the documented graceful-degradation behavior.
   */
  id?: string;
}) {
  // The default map for an unknown id lives at module scope; the per-id maps live in a closure
  // so that one Md component instance uses the same map for every render (memo stability) while
  // a different id (e.g. across message boundaries) gets its own map (id-collision avoidance).
  return (
    <ReactMarkdown
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={streaming ? NO_REHYPE_PLUGINS : REHYPE_PLUGINS}
      components={buildComponents(id ?? "md", streaming)}
    >
      {text}
    </ReactMarkdown>
  );
});

const componentsCache = new Map<string, { streaming: Components; settled: Components }>();
function buildComponents(id: string, _streaming: boolean): Components {
  // id is captured in MdPre via the wrapper closure below; cache key is `id` only.
  let cached = componentsCache.get(id);
  if (!cached) {
    cached = {
      streaming: {
        pre: (props) => (
          <MdPre streaming id={id}>
            {props.children}
          </MdPre>
        ),
        a: MdLink,
      },
      settled: {
        pre: (props) => (
          <MdPre streaming={false} id={id}>
            {props.children}
          </MdPre>
        ),
        a: MdLink,
      },
    };
    componentsCache.set(id, cached);
  }
  return _streaming ? cached.streaming : cached.settled;
}
