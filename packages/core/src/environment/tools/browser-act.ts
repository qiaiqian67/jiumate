/**
 * browser_act — act on the page in the agent browser: click, type, run script. A builtin tool
 * implementation.
 *
 * Everything here acts on the user's behalf in a signed-in browser, so it is `rw` and goes
 * through the approval flow: a click can submit an order, a typed line can commit a purchase, and
 * a script can read `document.cookie` and send it anywhere. The read-only half lives in
 * `browser_read` as `r`, so a model that only wants to look at a page never has to be approved
 * for the write-shaped things it cannot do from there.
 *
 * `exec` runs script in the page's own origin and nowhere else: it is the sharpest tool here, and
 * the port refuses a script that would cross origins rather than relying on the caller to have
 * meant well.
 *
 * Docs: /docs/tools § "Built-in tools".
 */
import { partialToolCallOutput } from "../../omnimessage/index.js";
import type { OmniMessage } from "../../omnimessage/index.js";
import type {
  BrowserExecResult,
  BrowserPort,
  ToolDefinitionConfig,
} from "../../interfaces/index.js";
import type { BuiltinTool, ToolExecutionContext, ToolResult } from "./types.js";

/** Tool name constant. */
export const BROWSER_ACT_NAME = "browser_act";

/**
 * Renders what an act produced, as the model reads it: what was clicked, what the script
 * returned, and the things that would otherwise be invisible — a page that navigated underneath
 * the script, a popup that opened, a toast that is already gone.
 */
export function renderBrowserExecResult(result: BrowserExecResult): string {
  const lines: string[] = [];
  lines.push(`${result.status} on tab ${result.tabId}.`);

  if (result.clicked !== undefined) {
    const what = result.clicked.text ?? result.clicked.tag ?? "element";
    lines.push(`Clicked ${what} at (${result.clicked.x}, ${result.clicked.y}).`);
  }
  if (result.value !== undefined) {
    lines.push(`Returned: ${JSON.stringify(result.value)}`);
  }
  if (result.diff !== undefined) {
    lines.push(`Changed ${result.diff.changed} element(s).`);
    if (result.diff.topChange !== undefined) {
      lines.push(`Largest change: ${result.diff.topChange}`);
    }
  }
  if (result.reloaded === true) lines.push("The page navigated or reloaded during the call.");
  if (result.newTabs !== undefined && result.newTabs.length > 0) {
    lines.push("New tabs opened:");
    for (const tab of result.newTabs) lines.push(`- ${tab.id} ${tab.url}`);
  }
  if (result.transients !== undefined && result.transients.length > 0) {
    lines.push("Text that appeared during the call (may be gone now):");
    for (const text of result.transients) lines.push(`- ${text}`);
  }
  if (result.dialogs !== undefined && result.dialogs.length > 0) {
    lines.push("Dialogs answered:");
    for (const dialog of result.dialogs) {
      lines.push(
        `- ${dialog.type}: "${dialog.message}" ${dialog.accepted ? "accepted" : "dismissed"}`,
      );
    }
  }
  if (result.error !== undefined) lines.push(`Error: ${result.error}`);
  if (result.suggestion !== undefined) lines.push(result.suggestion);
  return lines.join("\n");
}

/**
 * browser_act builtin tool: `action` selects what to do; `selector` / `text` / `script` carry
 * its argument. `definition` is replaced by Environment at construction time with the same-named
 * entry from ToolConfig.
 */
export function createBrowserActTool(
  definition: ToolDefinitionConfig,
  port?: BrowserPort,
): BuiltinTool {
  return {
    name: definition.name,
    definition,
    async *execute(
      args: Record<string, unknown>,
      ctx: ToolExecutionContext,
    ): AsyncGenerator<OmniMessage, ToolResult | void> {
      const delta = (output: string): OmniMessage =>
        partialToolCallOutput({ eventType: "delta", output, toolCallId: ctx.toolCallId });

      if (port === undefined) {
        yield delta(
          "This host has no browser surface, so there is no page to act on. The agent browser belongs to the desktop app; use it from there.",
        );
        return { stopReason: "fatal" };
      }

      const action = typeof args["action"] === "string" ? args["action"] : "";

      if (
        action === "click" &&
        (typeof args["selector"] !== "string" || args["selector"].trim() === "")
      ) {
        yield delta(`Missing required argument "selector" for ${definition.name} action="click".`);
        return { stopReason: "fatal" };
      }
      if (action === "type" && (typeof args["text"] !== "string" || args["text"] === "")) {
        yield delta(`Missing required argument "text" for ${definition.name} action="type".`);
        return { stopReason: "fatal" };
      }
      if (
        action === "exec" &&
        (typeof args["script"] !== "string" || args["script"].trim() === "")
      ) {
        yield delta(`Missing required argument "script" for ${definition.name} action="exec".`);
        return { stopReason: "fatal" };
      }

      try {
        const result = await port.act({
          action: action as "click" | "type" | "exec",
          tabId: typeof args["tab_id"] === "number" ? args["tab_id"] : undefined,
          selector: typeof args["selector"] === "string" ? args["selector"].trim() : undefined,
          text: typeof args["text"] === "string" ? args["text"] : undefined,
          script: typeof args["script"] === "string" ? args["script"] : undefined,
          acceptDialogs: args["accept_dialogs"] === true,
        });
        yield delta(renderBrowserExecResult(result));
        return result.status === "failed" ? { stopReason: "fatal" } : undefined;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        yield delta(message);
        return { stopReason: "fatal" };
      }
    },
  };
}
