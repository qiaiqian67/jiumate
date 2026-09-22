/**
 * One place where a tool id becomes something a person reads.
 *
 * The id is the contract — the model calls it, `config.toolsBuiltin` keys on it, an approval
 * prompt authorizes it, a Trace records it — so this function only ever affects what is
 * *drawn*. Nothing here reaches a request, a config, or a manifest; a surface that shows the
 * label keeps the id reachable next to it, and one that acts on the tool keeps passing the id.
 *
 * Two properties the callers depend on:
 *
 * - **A miss falls back to the id**, never to a guess. That is what makes an MCP tool
 *   (`mcp__<server>__<tool>`) and any tool added after this table was written render as
 *   themselves instead of as a blank or a wrong name.
 * - **`S` is read at call time**, not captured: `S` is a live binding that the locale Provider
 *   swaps, so a module-level `const names = S.toolNames` would freeze whichever language was
 *   active at import. Call it during render.
 */
import { S } from "./strings";

/**
 * The display name for a tool id, or the id itself when there is none.
 *
 * `id` may be empty — a tool call whose name has not streamed in yet is rendered by the caller
 * with its own placeholder, so callers that need one should test for that first rather than
 * relying on this to return something.
 */
export function toolLabel(id: string): string {
  return S.toolNames[id] ?? id;
}

/**
 * Whether the id is worth showing beside the label.
 *
 * True only when they differ, so an unmapped tool (MCP, or one added later) is not printed
 * twice, and a mapped one can offer the id as the secondary detail it actually is.
 */
export function toolLabelHidesId(id: string): boolean {
  return toolLabel(id) !== id;
}
