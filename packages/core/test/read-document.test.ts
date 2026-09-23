/**
 * Behavior tests for read_document: the tool contract around the extraction.
 *
 * The extraction itself is covered by documents.test.ts against real files; what is tested here is
 * everything the tool adds — workspace-relative path resolution, the extension check, the size
 * cap, the output budget, and the way failures are reported. Directly drives BuiltinTool.execute
 * and captures the generator's return value, following file-tools.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copyFile, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MAX_DOCUMENT_BYTES,
  READ_DOCUMENT_NAME,
  createReadDocumentTool,
} from "../src/environment/tools/read-document.js";
import { READ_FILE_NAME, createReadFileTool } from "../src/environment/tools/read-file.js";
import type { BuiltinTool, ToolResult } from "../src/environment/tools/types.js";
import type { OmniMessage } from "../src/omnimessage/index.js";
import type { ToolDefinitionConfig } from "../src/interfaces/index.js";

const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

function def(maxOutputLength?: number): ToolDefinitionConfig {
  return {
    name: READ_DOCUMENT_NAME,
    description: "test",
    permission: "r",
    ...(maxOutputLength === undefined ? {} : { maxOutputLength }),
  };
}

/** Runs one tool execution: concatenates text deltas and captures the generator's return value. */
async function run(tool: BuiltinTool, args: Record<string, unknown>, workspaceDir: string) {
  const gen = tool.execute(args, { workspaceDir, toolCallId: "c1" });
  const messages: OmniMessage[] = [];
  let result: ToolResult | void;
  for (;;) {
    const res = await gen.next();
    if (res.done) {
      result = res.value;
      break;
    }
    messages.push(res.value);
  }
  const text = messages.map((m) => (m.payload as { output?: string }).output ?? "").join("");
  return { result, text };
}

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), "linsight-readdoc-"));
  // A real document in the workspace, so path resolution is exercised against a file that parses.
  await copyFile(path.join(fixtureDir, "sample.xlsx"), path.join(tmp, "sheet.xlsx"));
  await mkdir(path.join(tmp, "nested"), { recursive: true });
  await copyFile(path.join(fixtureDir, "sample.odt"), path.join(tmp, "nested", "notes.odt"));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("read_document", () => {
  it("reads a document by workspace-relative path", async () => {
    const { text, result } = await run(
      createReadDocumentTool(def()),
      { file_path: "sheet.xlsx" },
      tmp,
    );
    expect(text).toContain('sheet "Summary"');
    expect(result).toBeUndefined();
  });

  it("reads a document in a subdirectory", async () => {
    const { text } = await run(
      createReadDocumentTool(def()),
      { file_path: "nested/notes.odt" },
      tmp,
    );
    expect(text).toContain("Quarterly Report");
  });

  it("reads a document by absolute path", async () => {
    const { text } = await run(
      createReadDocumentTool(def()),
      { file_path: path.join(tmp, "sheet.xlsx") },
      tmp,
    );
    expect(text).toContain('sheet "Summary"');
  });

  it("reports a missing argument", async () => {
    const { text, result } = await run(createReadDocumentTool(def()), {}, tmp);
    expect(text).toContain("Missing required argument");
    expect(result?.stopReason).toBe("fatal");
  });

  it("reports a file that does not exist, with a hint", async () => {
    const { text, result } = await run(
      createReadDocumentTool(def()),
      { file_path: "nope.docx" },
      tmp,
    );
    expect(text).toContain("File not found");
    expect(result?.stopReason).toBe("fatal");
  });

  // The extension check is the tool's own: it turns "you asked the wrong tool" into a message that
  // names the right one, instead of an extraction failure.
  it("turns away a file that is not a supported document", async () => {
    await writeFile(path.join(tmp, "notes.md"), "# hello\n");
    const { text, result } = await run(
      createReadDocumentTool(def()),
      { file_path: "notes.md" },
      tmp,
    );
    expect(text).toContain("is not a document");
    expect(text).toContain("read_file");
    expect(result?.stopReason).toBe("fatal");
  });

  it("turns away a directory", async () => {
    const { text, result } = await run(createReadDocumentTool(def()), { file_path: "nested" }, tmp);
    expect(text).toContain("is a directory");
    expect(result?.stopReason).toBe("fatal");
  });

  it("rejects an invalid offset", async () => {
    const { text, result } = await run(
      createReadDocumentTool(def()),
      { file_path: "sheet.xlsx", offset: "not a number" },
      tmp,
    );
    expect(text).toContain('Invalid "offset"');
    expect(result?.stopReason).toBe("fatal");
  });

  it("serves a window of sections", async () => {
    const { text } = await run(
      createReadDocumentTool(def()),
      { file_path: "sheet.xlsx", offset: 2, limit: 1 },
      tmp,
    );
    expect(text).toContain('sheet "Detail"');
    expect(text).not.toContain('sheet "Summary"');
  });

  // The size cap exists because a document has to be read whole to be parsed; the alternative is an
  // allocation the process may not survive.
  it("refuses a document over the size cap", async () => {
    const big = path.join(tmp, "big.pdf");
    await writeFile(big, Buffer.alloc(MAX_DOCUMENT_BYTES + 1));
    const { text, result } = await run(
      createReadDocumentTool(def()),
      { file_path: "big.pdf" },
      tmp,
    );
    expect(text).toContain("over the");
    expect(text).toContain("limit");
    expect(result?.stopReason).toBe("fatal");
  });

  // The budget is self-applied so the trailing continuation note survives Environment's front-keep
  // truncation, which is the whole reason the tool does not simply return everything.
  it("trims to its own output budget and says how much was withheld", async () => {
    const { text } = await run(createReadDocumentTool(def(600)), { file_path: "sheet.xlsx" }, tmp);
    expect(text.length).toBeLessThan(900);
    expect(text).toContain("output limit reached");
  });

  // Each format fails with its own message — mammoth's for a docx, the archive reader's for a
  // pptx/odt — and both are explanatory rather than a raw throw.
  it("reports an unreadable document as an explanatory failure, not a throw", async () => {
    await writeFile(path.join(tmp, "broken.docx"), "not a zip at all");
    const { text, result } = await run(
      createReadDocumentTool(def()),
      { file_path: "broken.docx" },
      tmp,
    );
    expect(text).toContain("could not be read");
    expect(result?.stopReason).toBe("fatal");
  });

  it("reports a corrupt zip-based document with the archive message", async () => {
    await writeFile(path.join(tmp, "broken.pptx"), "not a zip at all");
    const { text, result } = await run(
      createReadDocumentTool(def()),
      { file_path: "broken.pptx" },
      tmp,
    );
    expect(text).toContain("could not be opened as a zip archive");
    expect(result?.stopReason).toBe("fatal");
  });
});

describe("read_file pointing at a document", () => {
  // A .docx is a zip, so read_file's binary check is what a model hits first. Naming read_document
  // there is the difference between the model reading the file and going to install a converter.
  it("names read_document instead of only saying the file is binary", async () => {
    const { text, result } = await run(
      createReadFileTool({ name: READ_FILE_NAME, description: "test", permission: "r" }),
      { file_path: "sheet.xlsx" },
      tmp,
    );
    expect(text).toContain("read_document");
    expect(result?.stopReason).toBe("fatal");
  });
});
