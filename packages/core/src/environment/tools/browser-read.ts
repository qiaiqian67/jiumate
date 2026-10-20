/**
 * browser_read — read the agent browser without changing anything. A builtin tool implementation.
 *
 * Split from `browser_act` on purpose: reading a page is what an agent does constantly and it
 * changes nothing, so it rides the approval flow as `r` while the writes (click, type, exec) go
 * through it as `rw`. One tool with one permission would make the frequent read carry the weight
 * of the rare write.
 *
 * The screenshot is the reason this is a tool rather than a shell command: it comes back through
 * `ToolResult.images`, so the model sees the page in the same turn that asked for it instead of
 * a file on disk it has to spend another call to read.
 *
 * The tool owns no state and touches no disk — it calls the `BrowserPort` its host injected, and
 * a host without a browser surface reports that rather than failing with an errno.
 *
 * Docs: /docs/tools § "Built-in tools".
 */
import { partialToolCallOutput } from "../../omnimessage/index.js";
import type { OmniMessage } from "../../omnimessage/index.js";
import type {
  BrowserBackendInfo,
  BrowserPort,
  BrowserStatus,
  BrowserTab,
  ToolDefinitionConfig,
} from "../../interfaces/index.js";
import type { BuiltinTool, ToolExecutionContext, ToolResult } from "./types.js";

/** Tool name constant. */
export const BROWSER_READ_NAME = "browser_read";

/** Renders a backend as one line, so the model can see which browser it is reading. */
function renderBackend(backend: BrowserBackendInfo): string {
  return backend.available
    ? `${backend.backend}: available`
    : `${backend.backend}: unavailable (${backend.reason ?? "unknown"})`;
}

/** Renders one tab as a list item; the active one is starred, the way `tabs` shows it. */
function renderTabLine(tab: BrowserTab, activeTabId: number | null): string {
  const mark = tab.id === activeTabId ? "*" : " ";
  const title = tab.title !== "" ? tab.title : "(untitled)";
  const crashed = tab.crashed !== undefined ? ` [crashed: ${tab.crashed}]` : "";
  return `${mark}${tab.id} ${title} | ${tab.url}${tab.loading ? " (loading)" : ""}${crashed}`;
}

/**
 * Renders a status as the tool's text output. The backend is named on every call because the
 * tool does not choose it: which browser an agent drives is the user's setting, and a model that
 * assumed it was reading the built-in one when it was reading Chrome would draw the wrong
 * conclusion from a page that looks the same either way.
 */
export function renderBrowserStatus(status: BrowserStatus): string {
  const lines: string[] = [];
  lines.push(
    status.available
      ? `Agent browser: available, backend ${status.backend}.`
      : `Agent browser: unavailable (${status.reason ?? "unknown"}).`,
  );
  if (!status.available) {
    lines.push(`Backends: ${status.backends.map(renderBackend).join("; ")}`);
    return lines.join("\n");
  }
  lines.push(`Tabs (${status.tabs.length}):`);
  if (status.tabs.length === 0) {
    lines.push('  (none open — open one with action="open")');
  } else {
    for (const tab of status.tabs) lines.push(`  ${renderTabLine(tab, status.activeTabId)}`);
  }
  return lines.join("\n");
}

/**
 * browser_read builtin tool: `action` selects what to read; `url` names the page for
 * `action: "open"`. `definition` is replaced by Environment at construction time with the
 * same-named entry from ToolConfig.
 */
export function createBrowserReadTool(
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
          "This host has no browser surface, so there is no page to read. The agent browser belongs to the desktop app; use it from there.",
        );
        return { stopReason: "fatal" };
      }

      const action = typeof args["action"] === "string" ? args["action"] : "";
      const tabId = typeof args["tab_id"] === "number" ? args["tab_id"] : undefined;

      try {
        switch (action) {
          case "status":
          case "tabs": {
            yield delta(renderBrowserStatus(await port.status()));
            return;
          }

          case "open": {
            const url = args["url"];
            if (typeof url !== "string" || url.trim() === "") {
              yield delta(`Missing required argument "url" for ${definition.name} action="open".`);
              return { stopReason: "fatal" };
            }
            yield delta(
              renderBrowserStatus(
                await port.open(url.trim(), {
                  newTab: args["new_tab"] === true,
                  tabId,
                }),
              ),
            );
            return;
          }

          case "close": {
            yield delta(renderBrowserStatus(await port.close(tabId)));
            return;
          }

          case "scan": {
            const result = await port.scan({ tabId, textOnly: args["text_only"] === true });
            const page = result.content;
            yield delta(
              `Tab ${result.tab.id} — ${result.tab.title} | ${result.tab.url}` +
                (result.truncated ? "\n(page truncated)" : "") +
                `\n---\n${page}`,
            );
            return;
          }

          case "screenshot": {
            const shot = await port.screenshot({ tabId });
            yield delta(`Screenshot of tab ${tabId ?? "the active tab"} — image follows.`);
            return { images: [`data:${shot.mime};base64,${shot.data}`] };
          }

          default:
            yield delta(
              `Unknown action ${JSON.stringify(action)}. Use "status", "tabs", "open" (with url), "close", "scan" or "screenshot".`,
            );
            return { stopReason: "fatal" };
        }
      } catch (err) {
        // The port's failures are user-facing ("no tab with that id", "the tab crashed"), not
        // crashes: they explain themselves and finish as a normal tool failure.
        const message = err instanceof Error ? err.message : String(err);
        yield delta(message);
        return { stopReason: "fatal" };
      }
    },
  };
}
