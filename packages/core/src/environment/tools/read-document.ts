/**
 * read_document — document text extraction, a builtin tool implementation (BuiltinTool).
 *
 * This tool exists because its absence was expensive. Without it a model handed a .docx has no
 * way to read it: read_file rejects the binary, and the shell is the only remaining door — so it
 * improvises, reaching for `pip install` or a conda environment to get a converter, downloading
 * tooling mid-task to answer a question the harness should have answered itself. The fix is not a
 * better prompt telling it to stop; it is shipping the capability.
 *
 * It reads .docx, .pdf, .xlsx, .pptx, .odt, .ods and .odp, and returns Markdown. The conversion
 * lives in `../../documents/index.js` — this file is only the tool contract around it: argument
 * validation, path resolution, the size guard, and the output budget.
 *
 * Robustness properties, mirroring read_file where the concerns are the same:
 * - **Bounded input**: a document has to be read whole to be parsed, so unlike read_file this
 *   cannot stream. A byte cap turns a pathological file into a clear refusal instead of an
 *   allocation the process may not survive.
 * - **Self-budgeted output**: the rendered window is trimmed below the tool's own maxOutputLength
 *   so the trailing continuation note survives Environment's front-keep truncation.
 * - **Lossy extraction says so**: every format's warnings are appended. A model that cannot tell
 *   a scan from an empty page, or a value from a formula, will confidently report the wrong thing.
 *
 * Docs: /docs/tools § "File tools".
 */
import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { partialToolCallOutput } from "../../omnimessage/index.js";
import type { OmniMessage } from "../../omnimessage/index.js";
import type { ToolDefinitionConfig } from "../../interfaces/index.js";
import {
  DocumentExtractError,
  documentFormatOf,
  extractDocument,
  renderExtraction,
} from "../../documents/index.js";
import { missingPathHint } from "./path-hint.js";
import type { BuiltinTool, ToolExecutionContext, ToolResult } from "./types.js";

/** Tool name constant (used only within this tool module, never exposed to Environment). */
export const READ_DOCUMENT_NAME = "read_document";

/** Refuse documents larger than this. Parsing needs the whole file in memory. */
export const MAX_DOCUMENT_BYTES = 64 * 1024 * 1024;

/** Output-budget headroom reserved for the trailing notes, so they survive self-budget trimming. */
const NOTE_RESERVE = 512;

/** Fallback output budget when the definition carries no maxOutputLength. */
const DEFAULT_OUTPUT_BUDGET = 64000;

/** The extensions this tool accepts, for the message that turns away everything else. */
const SUPPORTED = ".docx, .pdf, .xlsx, .pptx, .odt, .ods, .odp";

/** Coerces a count argument; numbers and numeric strings are accepted, anything else rejected. */
function coerceCount(
  value: unknown,
  fallback: number,
): { ok: true; value: number } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, value: fallback };
  if (typeof value === "number" && Number.isFinite(value)) {
    return { ok: true, value: Math.floor(value) };
  }
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value.trim());
    if (Number.isFinite(n)) return { ok: true, value: Math.floor(n) };
  }
  return { ok: false };
}

/**
 * read_document builtin tool: resolves the path against the Workspace, extracts the document's
 * text, and streams it as Markdown.
 */
export function createReadDocumentTool(definition: ToolDefinitionConfig): BuiltinTool {
  return {
    name: definition.name,
    definition,
    async *execute(
      args: Record<string, unknown>,
      ctx: ToolExecutionContext,
    ): AsyncGenerator<OmniMessage, ToolResult | void> {
      const { toolCallId, signal } = ctx;
      const delta = (output: string): OmniMessage =>
        partialToolCallOutput({ eventType: "delta", output, toolCallId });

      const filePath = args["file_path"];
      if (typeof filePath !== "string" || filePath.length === 0) {
        yield delta(`Missing required argument "file_path" for ${definition.name}.`);
        return { stopReason: "fatal" };
      }

      const offsetArg = coerceCount(args["offset"], 1);
      if (!offsetArg.ok) {
        yield delta(`Invalid "offset": expected a number (got ${JSON.stringify(args["offset"])}).`);
        return { stopReason: "fatal" };
      }
      const limitArg = coerceCount(args["limit"], 0);
      if (!limitArg.ok || limitArg.value < 0) {
        yield delta(
          `Invalid "limit": expected a positive number (got ${JSON.stringify(args["limit"])}).`,
        );
        return { stopReason: "fatal" };
      }

      const resolved = path.resolve(ctx.workspaceDir, filePath);

      // The filesystem is consulted before the extension, so that a directory or a missing path is
      // reported as what it is. Checking the extension first would answer "not a document" to
      // `read_document({file_path: "reports"})`, which is true and useless.
      let size: number;
      try {
        const st = await stat(resolved);
        if (st.isDirectory()) {
          yield delta(
            `Cannot read "${filePath}": it is a directory. Pass the path of a document inside it.`,
          );
          return { stopReason: "fatal" };
        }
        size = st.size;
      } catch (err) {
        if (signal?.aborted) return { stopReason: "aborted" };
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || code === "ENOTDIR") {
          const hint = await missingPathHint(resolved);
          yield delta(
            `File not found: "${filePath}". Absolute paths are supported; relative paths resolve against the workspace.${hint}`,
          );
        } else {
          const message = err instanceof Error ? err.message : String(err);
          yield delta(`Failed to read "${filePath}": ${message}`);
        }
        return { stopReason: "fatal" };
      }
      if (signal?.aborted) return { stopReason: "aborted" };

      const format = documentFormatOf(resolved);
      if (format === null) {
        yield delta(
          `"${filePath}" is not a document ${definition.name} can read. It handles ${SUPPORTED}. ` +
            `For a text file use read_file; for an image use read_image; for anything else, shell commands.`,
        );
        return { stopReason: "fatal" };
      }

      if (size > MAX_DOCUMENT_BYTES) {
        const mb = Math.round(MAX_DOCUMENT_BYTES / (1024 * 1024));
        yield delta(
          `"${filePath}" is ${Math.round(size / (1024 * 1024))} MB, over the ${mb} MB limit for ${definition.name}. ` +
            `Parsing a document needs it in memory whole, so this one is refused rather than risked. Use shell commands to inspect it in pieces.`,
        );
        return { stopReason: "fatal" };
      }

      let bytes: Uint8Array;
      try {
        bytes = await readFile(resolved);
      } catch (err) {
        if (signal?.aborted) return { stopReason: "aborted" };
        const message = err instanceof Error ? err.message : String(err);
        yield delta(`Failed to read "${filePath}": ${message}`);
        return { stopReason: "fatal" };
      }
      if (signal?.aborted) return { stopReason: "aborted" };

      let rendered: string;
      try {
        const result = await extractDocument(bytes, format);
        const offset = Math.max(1, offsetArg.value);
        // 0 means "no explicit limit": renderExtraction then takes every remaining unit, which is
        // what a caller who did not ask for a window wants.
        const limit = limitArg.value > 0 ? limitArg.value : Number.MAX_SAFE_INTEGER;
        rendered = renderExtraction(result, { offset, limit });
      } catch (err) {
        if (signal?.aborted) return { stopReason: "aborted" };
        // DocumentExtractError carries a message written for this exact audience; anything else
        // is unexpected and is reported with its own text rather than swallowed.
        const message =
          err instanceof DocumentExtractError
            ? err.message
            : `Unexpected failure extracting "${filePath}": ${err instanceof Error ? err.message : String(err)}`;
        yield delta(message);
        return { stopReason: "fatal" };
      }
      if (signal?.aborted) return { stopReason: "aborted" };

      const budget =
        definition.maxOutputLength !== undefined && definition.maxOutputLength > 0
          ? definition.maxOutputLength
          : DEFAULT_OUTPUT_BUDGET;
      const contentBudget = Math.max(1, budget - NOTE_RESERVE);
      if (rendered.length > contentBudget) {
        const kept = rendered.slice(0, contentBudget);
        const cutAt = kept.lastIndexOf("\n");
        const head = cutAt > contentBudget / 2 ? kept.slice(0, cutAt) : kept;
        yield delta(
          `${head}\n\n[output limit reached — ${rendered.length - head.length} more characters were not shown; ` +
            `call again with offset/limit to read the remaining sections, or use shell commands to search the file]`,
        );
        return;
      }

      yield delta(rendered);
      return;
    },
  };
}
