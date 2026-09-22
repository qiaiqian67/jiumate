/**
 * The two error identifiers, turned into labels — and the fallback that makes the labels safe.
 *
 * `source` and `code` are the server's own vocabularies, recorded inline at a dozen-odd call
 * sites with no exported constant anywhere, so unlike the tool-name table there is no registry to
 * pin these against. The fallback is what carries that: an unlabelled value reads as itself, so a
 * source or code added after this table was written degrades to a readable identifier rather than
 * a blank. These tests pin that contract, plus the one dynamic family.
 */
import { afterEach, describe, expect, it } from "vitest";
import { errorCodeLabel, errorSourceCodeLabel, errorSourceLabel } from "../src/lib/error-labels";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

afterEach(() => setActiveStrings(zh));

describe("errorSourceLabel", () => {
  it("labels a source we know", () => {
    expect(errorSourceLabel("environment")).toBe("环境");
    expect(errorSourceLabel("llm")).toBe("模型");
    expect(errorSourceLabel("http")).toBe("HTTP");
  });

  it("falls back to the raw source, never to a guess", () => {
    // A source added to the server after this table was written.
    expect(errorSourceLabel("brand_new_source")).toBe("brand_new_source");
  });

  it("is the raw source in English, where the identifier already reads as its own label", () => {
    setActiveStrings(en);
    expect(errorSourceLabel("environment")).toBe("environment");
  });
});

describe("errorCodeLabel", () => {
  it("labels a code we know", () => {
    expect(errorCodeLabel("session_run_failed")).toBe("会话运行失败");
    expect(errorCodeLabel("uncaught_exception")).toBe("未捕获异常");
  });

  it("falls back to the raw code", () => {
    expect(errorCodeLabel("some_future_code")).toBe("some_future_code");
  });

  it("labels the dynamic tool family by its prefix and keeps the tool name", () => {
    // The environment records a failed tool call as `tool_<stop_reason>:<tool name>`. The reason
    // is localized; the name is the whole point of the row, so it stays verbatim.
    expect(errorCodeLabel("tool_failed:exec_command")).toBe("工具失败：exec_command");
    expect(errorCodeLabel("tool_fatal:read_file")).toBe("工具致命错误：read_file");
    // An unknown reason keeps the whole code rather than half-labelling it.
    expect(errorCodeLabel("tool_weird:pet")).toBe("tool_weird:pet");
  });

  it("keeps a colon-bearing code whole when its prefix is unknown", () => {
    expect(errorCodeLabel("future_thing:detail")).toBe("future_thing:detail");
  });

  it("is the raw code in English", () => {
    setActiveStrings(en);
    expect(errorCodeLabel("session_run_failed")).toBe("session_run_failed");
    // No annotation either: the en label IS the code, so there is nothing to append.
    expect(errorCodeLabel("tool_failed:exec_command")).toBe("tool_failed:exec_command");
  });
});

describe("errorSourceCodeLabel", () => {
  it("reads as one phrase: where, then what", () => {
    expect(errorSourceCodeLabel("environment", "tool_failed:exec_command")).toBe(
      "[环境] 工具失败：exec_command",
    );
  });

  it("mixes a labelled source with an unlabelled code without dropping either", () => {
    expect(errorSourceCodeLabel("llm", "future_code")).toBe("[模型] future_code");
  });
});
