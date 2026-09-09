/**
 * markdown-html.ts tests. Run the same way the chat-message tests do, through the static
 * markup renderer, with the KaTeX stylesheet pinned to a no-op so the produced HTML is
 * portable and offline.
 *
 * What is locked here:
 * - The result is a full HTML document (`<!doctype html>`, `<head>`, `<body>`).
 * - GFM tables, task lists, strikethrough all flow through (regression on the shared
 *   pipeline; complements markdown-gfm.test.ts).
 * - A ```mermaid fence becomes a `<div class="mermaid-block">` with raw SVG inside (and
 *   `hasMermaid: true`).
 * - A bad Mermaid body degrades to a `<pre class="mermaid-error">` instead of throwing.
 * - The custom `pre` adapter does not interfere with non-mermaid code blocks.
 */
import { describe, expect, it, vi } from "vitest";
import { serializeMarkdownToHtml } from "../src/lib/markdown-html";

// Mermaid's async dynamic import is real in a Node test environment too. It calls
// `document.createElement` (no JSDOM here), so we stub `mermaid.render`. The stub
// throws when the body contains the FAIL_TOKEN substring, so the bad-syntax test can
// exercise the error-fallback branch without needing a separate mock reset.
// This file exercises the export pipeline, not the mermaid library.
// Pin the stylesheet to "" so the output does not embed a CDN URL (offline / portable).
vi.mock("mermaid", () => ({
  default: {
    initialize: () => {},
    render: async (_id: string, code: string) => {
      if (code.includes("not valid mermaid")) {
        throw new Error("Syntax error: unrecognized token at line 1");
      }
      return { svg: `<svg data-mock><text>${code.split("\n")[0]}</text></svg>` };
    },
  },
}));

const OPTS = { katexStylesheet: "" };

describe("serializeMarkdownToHtml", () => {
  it("emits a full HTML document with the right structure", async () => {
    const { html } = await serializeMarkdownToHtml("# Title\n\nBody.", OPTS);
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("<title>Document</title>");
    expect(html).toContain("<body>");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<p>Body.</p>");
  });

  it("respects a custom title", async () => {
    const { html } = await serializeMarkdownToHtml("hi", { ...OPTS, title: "Q3 report" });
    expect(html).toContain("<title>Q3 report</title>");
  });

  it("renders GFM tables, task lists, and strikethrough through the shared pipeline", async () => {
    const { html } = await serializeMarkdownToHtml(
      "| a | b |\n| - | - |\n| 1 | 2 |\n\n- [x] done\n- [ ] todo\n\n~~old~~ new",
      OPTS,
    );
    expect(html).toContain("<table>");
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*checked/);
    expect(html).toContain("<del>old</del>");
  });

  it("returns hasMermaid: false when the source has no diagrams", async () => {
    const { hasMermaid } = await serializeMarkdownToHtml("plain text", OPTS);
    expect(hasMermaid).toBe(false);
  });

  it("pre-renders mermaid fences to inline SVG and flags hasMermaid", async () => {
    const source = "Before\n\n```mermaid\ngraph TD\n  A --> B\n```\n\nAfter";
    const { html, hasMermaid } = await serializeMarkdownToHtml(source, OPTS);
    expect(hasMermaid).toBe(true);
    // The SVG element appears; the surrounding fence code never reaches the output.
    expect(html).toMatch(/<svg[\s>]/);
    expect(html).toContain("mermaid-block");
    // The plain text on either side is still there.
    expect(html).toContain("<p>Before</p>");
    expect(html).toContain("<p>After</p>");
  });

  it("degrades a bad mermaid body to a code block instead of throwing", async () => {
    const source = "```mermaid\nthis is not valid mermaid !!\n```";
    const { html, hasMermaid } = await serializeMarkdownToHtml(source, OPTS);
    expect(hasMermaid).toBe(true);
    expect(html).toContain("mermaid-error");
    // Original source appears inside the error block.
    expect(html).toContain("this is not valid mermaid");
  });

  it("leaves non-mermaid code blocks as a plain <pre> with the language", async () => {
    const { html } = await serializeMarkdownToHtml("```ts\nconst x: number = 1;\n```", OPTS);
    expect(html).toContain("<pre>");
    expect(html).toContain("language-ts");
    expect(html).toContain("const x: number = 1;");
  });
});
