/**
 * The `browser_read` / `browser_act` tools: they own no state, so every case here is about what
 * they do with the port their host injected — including the host that has none, and the split
 * that keeps reading a page out of the approval flow that acting on one needs.
 */
import { describe, expect, it } from "vitest";
import {
  BROWSER_READ_NAME,
  createBrowserReadTool,
  renderBrowserStatus,
} from "../src/environment/tools/browser-read.js";
import {
  BROWSER_ACT_NAME,
  createBrowserActTool,
  renderBrowserExecResult,
} from "../src/environment/tools/browser-act.js";
import { BUILTIN_TOOL_FACTORIES } from "../src/environment/tools/registry.js";
import { defaultSystemConfig } from "../src/state/default-config.js";
import type {
  BrowserExecResult,
  BrowserPort,
  BrowserStatus,
  ToolDefinitionConfig,
} from "../src/interfaces/index.js";

/** The default toolset, read the way a fresh Agent gets it rather than from the builder. */
function defaultBuiltinTools(): ToolDefinitionConfig[] {
  return defaultSystemConfig().tools?.builtin ?? [];
}

function definitionFor(name: string): ToolDefinitionConfig {
  const entry = defaultBuiltinTools().find((tool) => tool.name === name);
  if (entry === undefined) throw new Error(`${name} is not in the default toolset`);
  return entry;
}

const STATUS: BrowserStatus = {
  available: true,
  backend: "builtin",
  backends: [
    { backend: "builtin", available: true },
    { backend: "chrome", available: false, reason: "not_desktop" },
  ],
  tabs: [
    {
      id: 7,
      url: "https://example.com/",
      title: "Example",
      loading: false,
      canGoBack: false,
      canGoForward: false,
    },
  ],
  activeTabId: 7,
};

/** Drives a tool and collects the text it streamed, the images it returned and its stop reason. */
async function run(
  tool: ReturnType<typeof createBrowserReadTool>,
  args: Record<string, unknown>,
): Promise<{ text: string; images: string[]; stopReason: string | undefined }> {
  const chunks: string[] = [];
  const generator = tool.execute(args, { workspaceDir: "/tmp", toolCallId: "call-1" });
  for (;;) {
    const next = await generator.next();
    if (next.done) {
      return {
        text: chunks.join(""),
        images: next.value?.images ?? [],
        stopReason: next.value?.stopReason,
      };
    }
    const payload = next.value.payload as { output?: string };
    if (typeof payload.output === "string") chunks.push(payload.output);
  }
}

function readTool(port?: BrowserPort) {
  return createBrowserReadTool(definitionFor(BROWSER_READ_NAME), port);
}

function stubPort(overrides: Partial<BrowserPort> = {}): BrowserPort {
  return {
    status: async () => STATUS,
    open: async () => STATUS,
    close: async () => STATUS,
    scan: async () => ({ tab: STATUS.tabs[0]!, content: "<main>Hello</main>" }),
    act: async () => ({ status: "success", tabId: 7 }),
    screenshot: async () => ({ mime: "image/png", data: "AAAB" }),
    ...overrides,
  };
}

describe("browser tools in the registry", () => {
  it("are assembled from the registry like every other builtin tool", () => {
    expect(BUILTIN_TOOL_FACTORIES[BROWSER_READ_NAME]).toBeTypeOf("function");
    expect(BUILTIN_TOOL_FACTORIES[BROWSER_ACT_NAME]).toBeTypeOf("function");
  });

  it("split reading a page from acting on it, so only acting needs approval", () => {
    const tools = defaultBuiltinTools();
    const read = tools.find((tool) => tool.name === BROWSER_READ_NAME);
    const act = tools.find((tool) => tool.name === BROWSER_ACT_NAME);
    expect(read?.permission).toBe("r");
    expect(act?.permission).toBe("rw");
  });
});

describe("renderBrowserStatus", () => {
  it("names the backend and stars the active tab", () => {
    const text = renderBrowserStatus(STATUS);
    expect(text).toContain("Agent browser: available, backend builtin.");
    expect(text).toContain("*7 Example | https://example.com/");
  });

  it("lists the backends and their reasons when the browser cannot be driven", () => {
    const text = renderBrowserStatus({
      ...STATUS,
      available: false,
      reason: "no_window",
      tabs: [],
      activeTabId: null,
    });
    expect(text).toContain("Agent browser: unavailable (no_window).");
    expect(text).toContain("builtin: available");
    expect(text).toContain("chrome: unavailable (not_desktop)");
  });

  it("says what to do when no tab is open, rather than showing an empty list", () => {
    expect(renderBrowserStatus({ ...STATUS, tabs: [], activeTabId: null })).toContain(
      '(none open — open one with action="open")',
    );
  });
});

describe("browser_read", () => {
  it("reports that the host has no browser surface when no port was injected", async () => {
    const { text, stopReason } = await run(readTool(), { action: "status" });
    expect(text).toMatch(/no browser surface/);
    expect(stopReason).toBe("fatal");
  });

  it("requires url for action=open", async () => {
    const port = stubPort();
    const { text, stopReason } = await run(readTool(port), { action: "open" });
    expect(text).toMatch(/url/);
    expect(stopReason).toBe("fatal");
  });

  it("returns a screenshot as an image in the same turn, not a file to read", async () => {
    const port = stubPort();
    const { text, images } = await run(readTool(port), { action: "screenshot" });
    expect(text).toMatch(/Screenshot of tab/);
    expect(images).toEqual(["data:image/png;base64,AAAB"]);
  });

  it("passes text_only through to the port", async () => {
    const seen: boolean[] = [];
    const port = stubPort({
      scan: async (options) => {
        seen.push(options?.textOnly === true);
        return { tab: STATUS.tabs[0]!, content: "Hello" };
      },
    });
    await run(readTool(port), { action: "scan", text_only: true });
    expect(seen).toEqual([true]);
  });

  it("refuses an unknown action without touching the port", async () => {
    let called = false;
    const port = stubPort({
      status: async () => {
        called = true;
        return STATUS;
      },
    });
    const { text, stopReason } = await run(readTool(port), { action: "sell-everything" });
    expect(text).toMatch(/Unknown action/);
    expect(stopReason).toBe("fatal");
    expect(called).toBe(false);
  });

  it("surfaces a port failure as an explanatory tool failure, not a crash", async () => {
    const port = stubPort({
      scan: async () => {
        throw new Error("No tab is open.");
      },
    });
    const { text, stopReason } = await run(readTool(port), { action: "scan" });
    expect(text).toBe("No tab is open.");
    expect(stopReason).toBe("fatal");
  });
});

describe("renderBrowserExecResult", () => {
  it("reports what would otherwise be invisible: popups, toasts and a page that moved", () => {
    const result: BrowserExecResult = {
      status: "success",
      tabId: 7,
      value: { count: 3 },
      reloaded: true,
      newTabs: [{ id: 9, url: "https://example.com/next" }],
      transients: ["Added to cart"],
      diff: { changed: 12, topChange: "cart total: 41.00" },
      clicked: { x: 120, y: 48, tag: "button", text: "Buy" },
    };
    const text = renderBrowserExecResult(result);
    expect(text).toContain("Clicked Buy at (120, 48).");
    expect(text).toContain('Returned: {"count":3}');
    expect(text).toContain("Changed 12 element(s).");
    expect(text).toContain("Largest change: cart total: 41.00");
    expect(text).toContain("The page navigated or reloaded during the call.");
    expect(text).toContain("- 9 https://example.com/next");
    expect(text).toContain("- Added to cart");
  });

  it("names an error the page raised", () => {
    expect(
      renderBrowserExecResult({ status: "failed", tabId: 7, error: "x is not defined" }),
    ).toContain("Error: x is not defined");
  });
});

describe("browser_act", () => {
  it("reports that the host has no browser surface when no port was injected", async () => {
    const { text, stopReason } = await run(createBrowserActTool(definitionFor(BROWSER_ACT_NAME)), {
      action: "click",
      selector: "#buy",
    });
    expect(text).toMatch(/no browser surface/);
    expect(stopReason).toBe("fatal");
  });

  it("requires the argument each action needs, without calling the port", async () => {
    let called = false;
    const port = stubPort({
      act: async () => {
        called = true;
        return { status: "success", tabId: 7 };
      },
    });
    const tool = createBrowserActTool(definitionFor(BROWSER_ACT_NAME), port);

    expect((await run(tool, { action: "click" })).text).toMatch(/selector/);
    expect((await run(tool, { action: "type" })).text).toMatch(/text/);
    expect((await run(tool, { action: "exec" })).text).toMatch(/script/);
    expect(called).toBe(false);
  });

  it("hands the script to the port rather than running it itself", async () => {
    const seen: string[] = [];
    const port = stubPort({
      act: async (request) => {
        seen.push(request.script ?? "");
        return { status: "success", tabId: 7, value: { ok: true } };
      },
    });
    const tool = createBrowserActTool(definitionFor(BROWSER_ACT_NAME), port);
    const { text } = await run(tool, { action: "exec", script: "return document.title" });
    expect(seen).toEqual(["return document.title"]);
    expect(text).toContain('Returned: {"ok":true}');
  });

  it("defaults accept_dialogs to false and passes a true through", async () => {
    const seen: (boolean | undefined)[] = [];
    const port = stubPort({
      act: async (request) => {
        seen.push(request.acceptDialogs);
        return { status: "success", tabId: 7 };
      },
    });
    const tool = createBrowserActTool(definitionFor(BROWSER_ACT_NAME), port);
    await run(tool, { action: "click", selector: "#go" });
    await run(tool, { action: "click", selector: "#go", accept_dialogs: true });
    expect(seen).toEqual([false, true]);
  });

  it("ends as failed when the page's action failed", async () => {
    const port = stubPort({
      act: async () => ({ status: "failed", tabId: 7, error: "no such element" }),
    });
    const tool = createBrowserActTool(definitionFor(BROWSER_ACT_NAME), port);
    const { text, stopReason } = await run(tool, { action: "click", selector: "#gone" });
    expect(text).toContain("Error: no such element");
    expect(stopReason).toBe("fatal");
  });
});
