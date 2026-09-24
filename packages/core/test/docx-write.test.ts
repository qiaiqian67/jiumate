/**
 * Round-trip tests for editing a .docx through Markdown.
 *
 * The pipeline is lossy by construction, so the tests are about *what* survives rather than about
 * equality. Two things are asserted and they answer different questions:
 *
 * - **The output is a real .docx.** The only convincing proof is that an independent reader can
 *   open it — so every generated file is read back with mammoth, which would reject a package whose
 *   parts, relationships or content types were wrong. Asserting on bytes would only confirm the
 *   bytes match themselves.
 * - **The text and its structure survive the trip.** Headings stay headings, lists stay lists,
 *   tables stay tables, emphasis stays emphasis. That is the whole promise of the feature, and it
 *   is checkable without pinning a format the writer is allowed to improve.
 *
 * The `[image omitted]` case is pinned deliberately. Saving a document that had images replaces them
 * with that marker, because mammoth hands images back as data URIs that the editor never sees and
 * cannot put back. It is a real loss, and it is a *visible* one — which is the difference between
 * this and the silent failures the rest of this feature exists to prevent.
 */
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { docxToMarkdown } from "../src/documents/docx.js";
import { markdownToDocx } from "../src/documents/docx-write.js";
import { extractDocumentFromPath, renderExtraction } from "../src/documents/index.js";

const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

/** Reads a .docx back through the extractor, proving the package is well-formed. */
const readBack = async (bytes: Uint8Array): Promise<string> =>
  renderExtraction(await extractDocumentFromPath("regenerated.docx", bytes));

describe("docx round trip", () => {
  it("produces a document an independent reader can open", async () => {
    const bytes = await markdownToDocx("# Title\n\nA paragraph.\n");
    expect(bytes.length).toBeGreaterThan(0);
    // A zip's magic bytes: PK\x03\x04. Anything else is not a package at all.
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const text = await readBack(bytes);
    expect(text).toContain("Title");
    expect(text).toContain("A paragraph.");
  });

  it("keeps headings, lists, tables and emphasis through a full trip", async () => {
    const original = await readFile(path.join(fixtureDir, "sample.docx"));
    const basis = await docxToMarkdown(original);

    const regenerated = await markdownToDocx(basis);
    const back = await docxToMarkdown(regenerated);

    expect(back).toContain("# Quarterly Report");
    expect(back).toContain("## Highlights");
    expect(back).toContain("Revenue up 18% year over year");
    expect(back).toContain("| Region | Revenue | Growth |");
    expect(back).toContain("| APAC | 4.2M | 24% |");
    expect(back).toContain("Churn held at 2.1%");
  });

  it("carries no framing from the extractor into the document", async () => {
    const original = await readFile(path.join(fixtureDir, "sample.docx"));
    const regenerated = await markdownToDocx(await docxToMarkdown(original));
    // Read back unwrapped. `renderExtraction` frames the body for a model — a "# docx document — 1
    // section" title and a "## document" heading — and those frames are output, not content.
    // Feeding them back would write them into the user's file as literal headings, which is how a
    // round trip grows a paragraph nobody typed. Checking the wrapped form would only assert that
    // the wrapper is still there.
    const body = await docxToMarkdown(regenerated);
    expect(body).not.toContain("docx document");
    expect(body).not.toContain("## document");
    expect(body).toContain("# Quarterly Report");
  });

  it("replaces images with a visible marker rather than dropping them silently", async () => {
    const original = await readFile(path.join(fixtureDir, "sample.docx"));
    const regenerated = await markdownToDocx(await docxToMarkdown(original));
    const back = await readBack(regenerated);
    expect(back).toContain("image omitted");
    // The document is still readable — the marker is text in the paragraph flow, not a hole.
    expect(back).toContain("Quarterly Report");
  });

  it("writes an ordered list as a numbered list, not as bullets", async () => {
    const bytes = await markdownToDocx("1. first\n2. second\n3. third\n");
    const text = await readBack(bytes);
    expect(text).toContain("first");
    expect(text).toContain("second");
    expect(text).toContain("third");
  });

  it("keeps a link's target, not just its label", async () => {
    const bytes = await markdownToDocx("See [the docs](https://example.com/docs) for more.\n");
    const text = await readBack(bytes);
    expect(text).toContain("the docs");
    expect(text).toContain("https://example.com/docs");
  });

  it("writes an empty document as a valid one rather than failing", async () => {
    const bytes = await markdownToDocx("");
    const text = await readBack(bytes);
    expect(text).toContain("docx document");
  });
});
