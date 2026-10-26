/**
 * The agent's own verbs: the ones that are not clicking, typing or running script.
 *
 * Each of these exists because a model asked to do the obvious thing could not: a page that
 * needed a scroll, a form that only accepted a trusted Enter, a dropdown, a file input, a
 * hover-only menu. Without them the model fell back on `exec`, which is the expensive way
 * to do what a browser does natively.
 */
import { describe, expect, it } from "vitest";
import {
  BROWSER_ACT_NAME,
  BROWSER_READ_NAME,
  BUILTIN_TOOL_FACTORIES,
} from "@jiumate/core";
import { defaultSystemConfig } from "@jiumate/core";
import type { ToolDefinitionConfig } from "@jiumate/core/interfaces";
import { BrowserService } from "../../src/browser/service.js";
import { FakeLink, evaluated, expressionOf, tab } from "./fake-link.js";

/**
 * The tool definition the registry hands the agent.
 *
 * The browser tools are not in the DEFAULT toolset — they are opt-in, because a host
 * without a browser has nothing for them to read — so the definition is built the way the
 * registry builds one.
 */
function definitionFor(name: string): ToolDefinitionConfig {
  const builtin = defaultSystemConfig().tools?.builtin ?? [];
  const entry = builtin.find((tool) => tool.name === name);
  if (entry !== undefined) return entry;
  return {
    name,
    description: "",
    permission: name === BROWSER_ACT_NAME ? "rw" : "r",
  };
}

/** A service over a fake far side, with the waiting taken out of it. */
function service(link: FakeLink): BrowserService {
  return new BrowserService({
    link,
    sleep: async () => undefined,
    now: () => 1_700_000_000_000,
    timing: {
      settleMs: 0,
      reloadWaitMs: 0,
      loadWaitMs: 0,
      popupClaimMs: 0,
      clickGapMs: 0,
      helperTimeoutMs: 1000,
      scanTimeoutMs: 1000,
      screenshotTimeoutMs: 1000,
    },
  });
}

/** The tool, built the way the runtime builds it: through the registry's factory. */
function actTool(link: FakeLink, svc?: BrowserService) {
  const factory = BUILTIN_TOOL_FACTORIES[BROWSER_ACT_NAME];
  if (factory === undefined) throw new Error("browser_act is not in the registry");
  return factory(definitionFor(BROWSER_ACT_NAME), { browser: svc ?? service(link) });
}

/** The reading tool, built the same way. */
function readTool(link: FakeLink, svc?: BrowserService) {
  const factory = BUILTIN_TOOL_FACTORIES[BROWSER_READ_NAME];
  if (factory === undefined) throw new Error("browser_read is not in the registry");
  return factory(definitionFor(BROWSER_READ_NAME), { browser: svc ?? service(link) });
}

/** Runs a tool the way the runtime does, and collects what it produced. */
async function run(
  tool: ReturnType<typeof actTool>,
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

describe("waiting for the page", () => {
  it("waits for an element to appear, and says how long it took", async () => {
    const link = new FakeLink();
    link.show(tab(1));
    link.cdp = (_tabId, method, params) => {
      if (method !== "Runtime.evaluate") return {};
      const expression = expressionOf(params);
      if (expression.includes("startStrMonitor")) return evaluated(true);
      if (expression.includes("stopStrMonitor")) return evaluated({ transients: [], changed: 0 });
      return evaluated({ ok: true, waited: 1200, what: "visible" });
    };
    const tool = actTool(link);
    const result = await run(tool, { action: "wait", selector: "#result", for: "visible" });
    expect(result.stopReason).toBeUndefined();
    expect(result.text).toContain("1200");
  });

  it("says so when the wait times out, rather than leaving the model to wonder", async () => {
    // A wait that quietly returned would leave the model scanning in a loop.
    const link = new FakeLink();
    link.show(tab(1));
    link.cdp = (_tabId, method, params) => {
      if (method !== "Runtime.evaluate") return {};
      const expression = expressionOf(params);
      if (expression.includes("startStrMonitor")) return evaluated(true);
      if (expression.includes("stopStrMonitor")) return evaluated({ transients: [], changed: 0 });
      return evaluated({ ok: false, waited: 10000, reason: "No element matches #result" });
    };
    const tool = actTool(link);
    const result = await run(tool, { action: "wait", selector: "#result" });
    expect(result.stopReason).toBe("fatal");
    expect(result.text).toContain("#result");
  });

  it("waits for the page to settle, which is what a model should read", async () => {
    const link = new FakeLink();
    link.show(tab(1));
    link.cdp = (_tabId, method, params) => {
      if (method !== "Runtime.evaluate") return {};
      const expression = expressionOf(params);
      if (expression.includes("startStrMonitor")) return evaluated(true);
      if (expression.includes("stopStrMonitor")) return evaluated({ transients: [], changed: 0 });
      return evaluated({ ok: true, waited: 900, what: "stable", settledFor: 600 });
    };
    const tool = actTool(link);
    const result = await run(tool, { action: "wait", for: "stable" });
    expect(result.stopReason).toBeUndefined();
    expect(result.text).toContain("stable");
  });
});

describe("the file input", () => {
  it("puts files into it", async () => {
    const link = new FakeLink();
    link.show(tab(1));
    // CDP addresses a node by id, so the document and the node are asked for by the
    // browser's DOM agent — the page cannot hand an id over.
    link.cdp = (_tabId, method) => {
      if (method === "DOM.getDocument") return { root: { nodeId: 1 } };
      if (method === "DOM.querySelector") return { nodeId: 2 };
      if (method === "Runtime.evaluate") return {};
      return {};
    };
    const tool = actTool(link);
    const result = await run(tool, {
      action: "upload",
      selector: "input[type=file]",
      files: ["/tmp/report.pdf"],
    });
    expect(result.stopReason).toBeUndefined();
    // The result says how many files went in — the model needs to know it worked, and
    // that it was the file input it meant.
    expect(result.text).toContain('"files":1');
    expect(result.text).toContain("input[type=file]");
  });

  it("says so when the page has no such file input", async () => {
    const link = new FakeLink();
    link.show(tab(1));
    link.cdp = (_tabId, method) => {
      if (method === "DOM.getDocument") return { root: { nodeId: 1 } };
      if (method === "DOM.querySelector") return { nodeId: 0 };
      if (method === "Runtime.evaluate") return {};
      return {};
    };
    const tool = actTool(link);
    const result = await run(tool, {
      action: "upload",
      selector: "#missing",
      files: ["/tmp/report.pdf"],
    });
    expect(result.stopReason).toBe("fatal");
    expect(result.text).toContain("#missing");
  });

  it("says what is missing rather than failing obscurely", async () => {
    const link = new FakeLink();
    link.show(tab(1));
    const tool = actTool(link);
    const result = await run(tool, { action: "upload", selector: "input[type=file]" });
    expect(result.stopReason).toBe("fatal");
    expect(result.text).toContain("files");
  });
});

describe("hovering", () => {
  it("moves the mouse over an element, with no click", async () => {
    const link = new FakeLink();
    link.show(tab(1));
    link.cdp = (_tabId, method, params) => {
      if (method === "Input.dispatchMouseEvent") {
        const p = params as { type?: string; x?: number; y?: number };
        expect(p.type).toBe("mouseMoved");
        expect(typeof p.x).toBe("number");
        return {};
      }
      if (method !== "Runtime.evaluate") return {};
      const expression = expressionOf(params);
      if (expression.includes("startStrMonitor")) return evaluated(true);
      if (expression.includes("stopStrMonitor")) return evaluated({ transients: [], changed: 0 });
      return evaluated({ x: 10, y: 20, tag: "button", text: "Menu" });
    };
    const tool = actTool(link);
    const result = await run(tool, { action: "hover", selector: "#menu" });
    expect(result.stopReason).toBeUndefined();
    expect(result.text).toContain("Menu");
  });
});

describe("what the model is told", () => {
  it("names the tab the user is looking at, when it is not the active one", async () => {
    // The agent drives the ACTIVE tab; the user may be watching another. A model that does
    // not know this reads a page the user has moved on from.
    const link = new FakeLink();
    link.show(tab(1));
    link.show(tab(2));
    const svc = service(link);
    svc.setOnScreen(2);
    const tool = readTool(link, svc);
    const result = await run(tool, { action: "status" });
    expect(result.text).toContain("user is looking at tab 2");
  });
});
