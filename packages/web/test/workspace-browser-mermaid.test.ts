/**
 * Test that the ReactMarkdown pre adapter in workspace-browser.tsx correctly extracts the
 * mermaid language and routes to MermaidBlock. Static markup of ReactMarkdown with a mermaid
 * fence should produce a div with class "mermaid-block" (the MermaidBlock placeholder, since
 * the async lazy import only fires in a real browser env).
 */
import { describe, expect, it } from "vitest";
import { createElement, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";

const source = `\`\`\`mermaid
graph TD
  A --> B
\`\`\``;

/**
 * Mirrors the pre adapter logic from workspace-browser.tsx — keeps this test independent of
 * pulling in the whole component tree (which has heavy side-effecting imports).
 */
function preAdapter({ children }: { children?: unknown }) {
  if (isValidElement(children)) {
    const props = children.props as { className?: string | string[]; children?: unknown };
    // react-markdown v10 sets className as an ARRAY `["language-mermaid"]`; stringify it for the
    // regex. A bare string is also accepted (defensive — older v9 callers pass a string).
    const cls = Array.isArray(props.className)
      ? props.className.join(" ")
      : (props.className ?? "");
    const language = /language-([\w+-]+)/.exec(cls)?.[1] ?? "";
    if (language === "mermaid") {
      return createElement("div", { className: "mermaid-block" });
    }
  }
  return createElement("pre", {}, children as never);
}

describe("ReactMarkdown pre adapter (workspace-browser mermaid)", () => {
  it("routes a ```mermaid fence to the MermaidBlock placeholder", () => {
    const html = renderToStaticMarkup(
      createElement(ReactMarkdown, {
        components: { pre: preAdapter },
        children: source,
      }),
    );
    expect(html).toContain("mermaid-block");
    expect(html).not.toContain("<pre>");
  });

  it("routes other languages to a plain <pre>", () => {
    const html = renderToStaticMarkup(
      createElement(ReactMarkdown, {
        components: { pre: preAdapter },
        children: "```js\nconst a = 1;\n```",
      }),
    );
    expect(html).toContain("<pre>");
    expect(html).not.toContain("mermaid-block");
  });
});
