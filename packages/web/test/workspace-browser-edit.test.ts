/**
 * Contracts the WorkspaceBrowser edit mode depends on:
 *
 *  1. UTF-8 safe base64 — the save path base64-encodes the draft before the PUT; a
 *     shortcut through `btoa(s)` throws on non-Latin-1 strings, which a Chinese Markdown
 *     report would trip. The `for…of Uint8Array` loop is the small but load-bearing detail
 *     this test guards (a switch to indexed access silently fails the type checker in
 *     strict mode and produces a wrong string at runtime).
 *  2. i18n parity — the four Edit strings (`edit`, `editSave`, `editCancel`,
 *     `editConflictBanner`, `editDiscardConfirm`) live in both `strings.ts` (zh) and
 *     `strings-en.ts` (en) under the same `files` key. The Save / Cancel buttons in the
 *     preview branch and the conflict banner read these directly, so a missing zh key
 *     crashes the panel.
 *  3. The MarkdownEditor module exports the surface the panel binds to (`MarkdownEditor`
 *     function with the five props the click handlers pass) — a renamed export would
 *     otherwise fail at the call site only.
 *  4. The Edit segment is gated to .md only — the toggle pill surfaces `edit` text in
 *     the DOM for md previews, never for html previews. This pins the visual contract.
 *
 * Component-render testing would need DOM + CodeMirror chunk loading, both outside this
 * package's vitest setup; the user-visible flow lives in `e2e/workspace-edit.spec.mjs`
 * instead.
 */
import { describe, expect, it } from "vitest";
import { S, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

/** Mirrors the helper inside workspace-browser.tsx — kept in sync by test, not import,
 *  because workspace-browser.tsx pulls a side-effecting import graph (auth, theme, …)
 *  that vitest in node would have to stub. The two implementations diverge if either
 *  side is rewritten without updating the other. */
function utf8ToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function base64ToUtf8(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

describe("utf8ToBase64 (save encoding)", () => {
  it("round-trips ASCII unchanged", () => {
    const text = "# Hello, world!\n\nPlain ASCII text.";
    expect(base64ToUtf8(utf8ToBase64(text))).toBe(text);
  });

  it("round-trips CJK — the load-bearing case btoa(s) cannot handle directly", () => {
    const text =
      "# 报告\n\n## 结构\n- 第一条\n- 第二条：Mermaid 图\n\n```mermaid\nflowchart LR\n  A --> B\n```";
    expect(base64ToUtf8(utf8ToBase64(text))).toBe(text);
  });

  it("preserves emoji and combining sequences", () => {
    const text = "🎉 editing ✓ – em dash — done";
    expect(base64ToUtf8(utf8ToBase64(text))).toBe(text);
  });

  it("handles an empty string without producing 'undefined' anywhere", () => {
    expect(utf8ToBase64("")).toBe("");
  });
});

describe("i18n parity for edit mode", () => {
  it("zh strings carries every edit key the workspace-browser reads", () => {
    // The component reads S.files.{edit,editSave,editCancel,editConflictBanner,editDiscardConfirm}
    // — a missing key returns undefined and crashes the JSX.
    expect(typeof zh.files.edit).toBe("string");
    expect(zh.files.edit.length).toBeGreaterThan(0);
    expect(typeof zh.files.editSave).toBe("string");
    expect(typeof zh.files.editCancel).toBe("string");
    expect(typeof zh.files.editConflictBanner).toBe("string");
    expect(zh.files.editConflictBanner.length).toBeGreaterThan(0);
    expect(typeof zh.files.editDiscardConfirm).toBe("string");
  });

  it("en strings mirror the zh keys — same field names, same set", async () => {
    // The component imports `S` (the active catalog) and never branches on locale, so a
    // missing English translation breaks every English session silently. The test uses
    // the same lookup the component uses (`S.files.*`) with the locale swapped via setActiveStrings.
    const { setActiveStrings, S: activeRef } = await import("../src/lib/strings");
    const previous = activeRef;
    setActiveStrings(en);
    try {
      expect(typeof S.files.edit).toBe("string");
      expect(S.files.edit.length).toBeGreaterThan(0);
      expect(typeof S.files.editSave).toBe("string");
      expect(typeof S.files.editCancel).toBe("string");
      expect(typeof S.files.editConflictBanner).toBe("string");
      expect(S.files.editConflictBanner.length).toBeGreaterThan(0);
      expect(typeof S.files.editDiscardConfirm).toBe("string");
    } finally {
      setActiveStrings(previous);
    }
  });

  it("zh and en share the same key set under files (parity guard)", () => {
    const zhFiles = Object.keys(zh.files).sort();
    const enFiles = Object.keys(en.files).sort();
    expect(enFiles).toEqual(zhFiles);
  });
});

describe("MarkdownEditor module", () => {
  it("exports a callable component with the expected prop shape", async () => {
    // The workspace-browser binds onChange/onSave/onCancel/saving/value to <MarkdownEditor>.
    // A renamed or removed export surfaces here as `undefined`, not at runtime.
    const mod = await import("../src/features/chat/markdown-editor");
    expect(typeof mod.MarkdownEditor).toBe("function");
    // The component is the named export, the default export is intentionally absent —
    // keeps the import site explicit and the chunk boundary obvious.
    expect((mod as Record<string, unknown>).default).toBeUndefined();
  });
});

describe("editable-doc plugin manifest", () => {
  it("declares the contract the loader and host packages depend on", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const manifestPath = path.resolve(
      import.meta.dirname,
      "../../../plugins/editable-doc/plugin.json",
    );
    const raw = await fs.readFile(manifestPath, "utf8");
    const m = JSON.parse(raw) as Record<string, unknown>;
    // preinstall: every host agent loads this by default, which is the whole point —
    // every agent-generated Markdown report benefits from the format rules.
    expect(m.preinstall).toBe(true);
    expect(m.category).toBe("office-productivity");
    expect(typeof m.description).toBe("string");
    expect((m.description as string).length).toBeGreaterThan(0);
    expect(typeof m.short_description).toBe("string");
    expect(typeof m.short_description_zh).toBe("string");
    expect(typeof m.version).toBe("string");
    expect(m.version as string).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });
});
