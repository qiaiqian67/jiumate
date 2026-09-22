/**
 * The two identifiers the server records beside every error row, turned into something a person
 * reads: `source` and `code`.
 *
 * Both are vocabularies this codebase owns — `source` is a dozen literals at the record sites,
 * `code` a couple of dozen — and both are shown in a monospace column where a reader scans for
 * "which part broke". They get labels for the same reason the built-in tools do: the identifier
 * is the contract (it is what the server logs, what a Trace carries, and what you grep for), so
 * the label is display only and a value with no label falls back to the identifier itself.
 *
 * The **message** is not here on purpose. It is raw `err.message` text from Node, fetch and the
 * model providers — third-party wording this app has no business rewriting, and the one string
 * in the row a reader can search for. See the `logs` block in strings.ts.
 *
 * Nothing is pinned by a test against the server's vocabulary, and that is a known limit rather
 * than an oversight: neither list is exported as a constant anywhere (they are inline literals
 * at the record sites), so there is no anchor to pin to — unlike `toolNames`, which test/tool-
 * labels.test.ts pins to core's `BUILTIN_TOOL_FACTORIES`. The fallback is what makes that safe:
 * an unlabelled value reads as itself.
 */
import { S } from "./strings";

/** The display label for one `source`, or the raw source when it has none. */
export function errorSourceLabel(source: string): string {
  return S.logs.sources[source] ?? source;
}

/**
 * The display label for one `code`, or the raw code when it has none.
 *
 * A code containing a colon is labelled **by its prefix** with the rest appended verbatim. That
 * is the one dynamic family: the environment records a failed tool call as
 * `tool_<stop_reason>:<tool name>`, so `tool_failed:exec_command` reads `工具失败：exec_command` —
 * the reason localized, the tool name kept, since the name is the whole point of the row.
 */
export function errorCodeLabel(code: string): string {
  const colon = code.indexOf(":");
  if (colon === -1) return S.logs.codes[code] ?? code;
  const prefix = code.slice(0, colon);
  const label = S.logs.codes[prefix];
  return label === undefined ? code : `${label}：${code.slice(colon + 1)}`;
}

/**
 * The row's leading column: the labelled source in brackets, then the labelled code —
 * `[环境] 工具失败：exec_command`. One string because the two are read as one phrase: the
 * bracket answers "where" and the code "what", and splitting them across cells would put the
 * monospace column between them.
 */
export function errorSourceCodeLabel(source: string, code: string): string {
  return `[${errorSourceLabel(source)}] ${errorCodeLabel(code)}`;
}
