/**
 * Locks the integration contract between WorkspaceBrowser and the ExportMenu:
 *
 *  - The menu is only rendered for `md` and `html` preview kinds, never for `text`,
 *    `image`, `pdf`, or `unsupported`. (Plain `text` has no markdown semantics, and the
 *    other three have nothing to convert.)
 *  - The four props (`sessionId`, `filePath`, `fileName`, `markdown`) are bound to the
 *    matching preview fields, so renaming a field on `Preview` breaks here, not at runtime.
 *  - The menu sits next to the existing raw-download link (so the two coexist; a regression
 *    that hides the menu behind the raw link would lose the export affordance entirely).
 *
 * DOM rendering is covered by `e2e/workspace-export.spec.mjs` (real Electron + real Pandoc);
 * this file locks the structural contract that lives entirely in the source.
 */
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(here, "../src/features/chat/workspace-browser.tsx");

async function loadSource(): Promise<string> {
  return readFile(SOURCE, "utf8");
}

describe("ExportMenu integration in workspace-browser", () => {
  it("imports ExportMenu from the workspace-export module", async () => {
    const src = await loadSource();
    // Single named import — the workspace-export module exports the component as a named
    // export (no default), so a default-import regression surfaces here.
    expect(src).toMatch(/import\s*\{\s*ExportMenu\s*\}\s*from\s*["']\.\/workspace-export["']/);
  });

  it("gates the menu to md + html previews, no other kinds", async () => {
    const src = await loadSource();
    // The predicate must mention both kinds explicitly — a future kind added (e.g. "epub"
    // previews) requires a conscious decision to expose the menu for it. Order between
    // `html` and `md` is not load-bearing; allow either.
    const gateMatch =
      /preview\.kind === "(?:md|html)"\s*\|\|\s*preview\.kind === "(?:md|html)"\)\s*&&/.exec(src);
    expect(gateMatch, "expected the export-menu predicate to cover md and html").not.toBeNull();
    // The gate may not be one of these accidental category errors (text/image/pdf combined
    // with html) immediately followed by `<ExportMenu`:
    expect(src).not.toMatch(/preview\.kind === "text"[^\n]*\n[^\n]*<ExportMenu/);
    expect(src).not.toMatch(/preview\.kind === "image"[^\n]*\n[^\n]*<ExportMenu/);
    expect(src).not.toMatch(/preview\.kind === "pdf"[^\n]*\n[^\n]*<ExportMenu/);
  });

  it("withholds the menu from a .docx, which is already the Word document", async () => {
    const src = await loadSource();
    // A .docx being edited is presented as an `md` preview, so the kind gate alone would offer it
    // "Export to Word (.docx)" — re-rendering the file the panel is already showing as itself. The
    // exception is the second half of the predicate and has to stay visible: dropping it silently
    // gives every Word document a menu that includes exporting it to its own format.
    expect(src).toMatch(/preview\.docxSource === undefined\s*&&/);
  });

  it("binds every prop the ExportMenu expects", async () => {
    const src = await loadSource();
    // Each prop must appear inside an <ExportMenu ... /> block. The simplest lock: grep the
    // exact prop names in the component tag's attribute list. Capturing the `<ExportMenu .../>`
    // block keeps us from accidentally matching `markdown` or `filePath` elsewhere on the page.
    const block = /<ExportMenu[\s\S]*?\/>/.exec(src);
    expect(block, "<ExportMenu /> not found in workspace-browser.tsx").not.toBeNull();
    const tag = block![0];
    expect(tag).toContain("sessionId={session.sessionId}");
    expect(tag).toContain("filePath={preview.path}");
    expect(tag).toContain("fileName={preview.name}");
    expect(tag).toContain('markdown={preview.content ?? ""}');
  });

  it("sits alongside the raw-download link, not in place of it", async () => {
    // The ExportMenu block must appear in the same flex toolbar as the existing download
    // <a>. A regression that demotes the menu (e.g. moves it to the bottom of the panel)
    // loses the affordance and breaks the user flow.
    const src = await loadSource();
    const menuIdx = src.indexOf("<ExportMenu");
    const downloadIdx = src.indexOf("api.workspaceFileUrl(session.sessionId, preview.path, true)");
    expect(menuIdx).toBeGreaterThan(-1);
    expect(downloadIdx).toBeGreaterThan(menuIdx);
    // The toolbar's flex-wrap container should still wrap both — the toolbar opener should
    // appear before the menu and the closing </div> after the download link.
    const toolbarStart = src.lastIndexOf("flex-wrap", menuIdx);
    const toolbarEnd = src.indexOf("</div>", downloadIdx);
    expect(toolbarStart).toBeGreaterThan(-1);
    expect(toolbarEnd).toBeGreaterThan(toolbarStart);
  });
});

describe("workspace-export module surface", () => {
  it("exports ExportMenu as a callable component", async () => {
    // The named-export contract: import side succeeds, value is a function (React component).
    // Default-import is intentionally absent (the barrel discipline here is named-only).
    const mod = await import("../src/features/chat/workspace-export");
    expect(typeof mod.ExportMenu).toBe("function");
    expect((mod as Record<string, unknown>).default).toBeUndefined();
  });
});
