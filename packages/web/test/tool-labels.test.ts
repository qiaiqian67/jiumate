/**
 * toolLabel unit tests: the one place a tool id becomes a display name.
 *
 * The load-bearing test is the first one. The Chinese names are a lookup table keyed by tool id,
 * and a lookup table keyed by a string is exactly the kind of thing that rots silently: rename
 * `read_file` in core, or add an eleventh built-in tool, and every surface quietly goes back to
 * showing a raw id with nothing failing. So the keys are pinned to core's own registry —
 * `BUILTIN_TOOL_FACTORIES` — rather than to a copy of the list written out here.
 */
import { afterEach, describe, expect, it } from "vitest";
import { BUILTIN_TOOL_FACTORIES } from "@prismshadow/jiumate-core";
import { toolLabel, toolLabelHidesId } from "../src/lib/tool-labels";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

afterEach(() => setActiveStrings(zh));

describe("toolLabel", () => {
  it("names every built-in tool core registers, and nothing else", () => {
    const builtin = Object.keys(BUILTIN_TOOL_FACTORIES).sort();
    expect(builtin.length).toBeGreaterThan(0);

    // Both directions matter: a missing key is a tool that shows an id, and an extra key is a
    // typo (or a tool that was removed) — a name that can never be reached.
    expect(Object.keys(zh.toolNames).sort()).toEqual(builtin);
  });

  it("renders the Chinese name for a built-in tool", () => {
    expect(toolLabel("read_file")).toBe("读取文件内容");
    expect(toolLabel("exec_command")).toBe("执行系统命令");
    expect(toolLabel("pet")).toBe("与虚拟宠物互动");
  });

  it("falls back to the id, never to a guess", () => {
    // An MCP tool: named by its server, unknowable here.
    expect(toolLabel("mcp__github__create_issue")).toBe("mcp__github__create_issue");
    // A tool added after this table was written.
    expect(toolLabel("glob_file")).toBe("glob_file");
    // The card renders its own placeholder for a name that has not streamed in yet.
    expect(toolLabel("")).toBe("");
  });

  it("reads the active dictionary at call time, not at import time", () => {
    // The English dictionary deliberately carries no names: the ids are already English, and
    // they are also what a Trace and the model's own calls say.
    setActiveStrings(en);
    expect(toolLabel("read_file")).toBe("read_file");
    setActiveStrings(zh);
    expect(toolLabel("read_file")).toBe("读取文件内容");
  });

  it("reports whether the id is worth showing beside the label", () => {
    // Mapped: the id is a secondary detail. Unmapped: showing it again would print it twice.
    expect(toolLabelHidesId("read_file")).toBe(true);
    expect(toolLabelHidesId("mcp__github__create_issue")).toBe(false);
  });
});
