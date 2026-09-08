/**
 * GitHub-Flavored Markdown coverage through the shared pipeline (lib/markdown-plugins.ts),
 * rendered through react-dom/server static markup.
 *
 * These are the GFM constructs that real agent output lands on: tables, task lists, strikethrough,
 * autolinks, footnotes. remark-gfm 4.0 ships them; the test pins the rendered shape so a quiet
 * upgrade — or someone dropping remark-gfm from REMARK_PLUGINS to slim a dep — fails visibly here
 * rather than as a confused report in a user's Workspace.
 *
 * Inline code, fenced code, mermaid, and math have their own tests; what is locked here is what
 * remark-gfm alone is responsible for.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { REHYPE_PLUGINS, REMARK_PLUGINS } from "../src/lib/markdown-plugins";

const render = (markdown: string) =>
  renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      { remarkPlugins: REMARK_PLUGINS, rehypePlugins: REHYPE_PLUGINS },
      markdown,
    ),
  );

/** Strip tags, leave the text a reader sees. */
const text = (html: string) => html.replace(/<[^>]*>/g, "");

describe("remark-gfm coverage through the shared pipeline", () => {
  it("renders a GFM table with header, alignment, and rows", () => {
    const html = render("| col | num |\n| :--- | ---: |\n| alpha | 1 |\n| beta | 2 |\n");
    expect(html).toContain("<table>");
    expect(html).toContain("<th");
    // remark-gfm emits alignment as inline style, not the deprecated align attribute.
    expect(html).toContain('style="text-align:left"');
    expect(html).toContain('style="text-align:right"');
    expect(html).toMatch(/<td[^>]*>alpha<\/td>/);
    expect(html).toMatch(/<td[^>]*>2<\/td>/);
  });

  it("renders task lists as <input type=checkbox> with checked state", () => {
    const html = render("- [x] done\n- [ ] todo\n");
    // GFM emits disabled checkboxes; the source `x` decides checked.
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*checked/);
    expect(html).toMatch(/<input[^>]*type="checkbox"(?![^>]*checked)/);
    expect(text(html)).toContain("done");
    expect(text(html)).toContain("todo");
  });

  it("renders strikethrough as <del>", () => {
    const html = render("~~struck~~ and not.");
    expect(html).toContain("<del>struck</del>");
    expect(text(html)).toContain("not.");
  });

  it("autolinks a bare https URL into an <a> tag", () => {
    const html = render("See https://example.com/path?q=1 for details.");
    expect(html).toContain('href="https://example.com/path?q=1"');
    expect(html).toContain(">https://example.com/path?q=1</a>");
  });

  it("renders a footnote reference and definition", () => {
    const html = render("A claim[^1].\n\n[^1]: The footnote body.");
    // remark-gfm emits the reference as a link to the definition (id is prefixed with
    // `user-content-` to avoid colliding with the page's own anchors when the rendered
    // fragment is dropped into the host document), and the definition as a list item inside
    // a `<section data-footnotes>` block at the bottom of the document.
    expect(html).toMatch(/<a[^>]*href="#user-content-fn-1"/);
    expect(html).toContain("The footnote body.");
  });
});
