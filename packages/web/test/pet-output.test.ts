/**
 * Unit tests for the two pure helpers a bubble's text depends on: `pet-output.ts`
 * (what crosses the BroadcastChannel) and `pet-typewriter.ts` (how it is revealed).
 * No DOM, no channel.
 */
import { describe, expect, it } from "vitest";
import {
  PET_OUTPUT_LIMIT,
  latestAssistantText,
  latestBubbleOutput,
  petPlainText,
  truncatePetOutput,
} from "../src/features/pet/pet-output";
import { advanceTypewriterOutput, seedTypewriterOutput } from "../src/features/pet/pet-typewriter";
import type { ChatItem } from "../src/lib/omni/stream-model";

/** Minimal assistant item; the scan only reads `kind` and `text`. */
function assistant(text: string, id = 1): ChatItem {
  return { kind: "assistant_text", id, text, streaming: false };
}

describe("truncatePetOutput", () => {
  it("collapses newlines and runs of spaces into single spaces", () => {
    expect(truncatePetOutput("a\n\n  b\t c")).toBe("a b c");
  });

  it("leaves text at or under the limit untouched", () => {
    const exact = "x".repeat(PET_OUTPUT_LIMIT);
    expect(truncatePetOutput(exact)).toBe(exact);
    expect(truncatePetOutput("short")).toBe("short");
  });

  it("cuts to the limit and marks the cut with an ellipsis", () => {
    const out = truncatePetOutput("y".repeat(PET_OUTPUT_LIMIT + 50));
    expect(out).toHaveLength(PET_OUTPUT_LIMIT);
    expect(out.endsWith("…")).toBe(true);
  });

  it("honours an explicit limit and never leaves a trailing space before the ellipsis", () => {
    expect(truncatePetOutput("hello world", 7)).toBe("hello…");
    expect(truncatePetOutput("ab   cd", 4)).toBe("ab…");
  });
});

describe("petPlainText", () => {
  it("drops fenced code fences but keeps their contents", () => {
    expect(petPlainText("before\n```ts\nconst a = 1;\n```\nafter")).toBe(
      "before const a = 1; after",
    );
  });

  it("unwraps inline code, links and images to their text", () => {
    expect(petPlainText("see `npm i` and [docs](https://x.dev) ![alt](a.png)")).toBe(
      "see npm i and docs alt",
    );
  });

  it("strips heading, quote and list markers", () => {
    expect(petPlainText("## Title\n> quoted\n- one\n1. two")).toBe("Title quoted one two");
  });

  it("drops emphasis and inline HTML", () => {
    expect(petPlainText("**bold** _em_ ~~strike~~ <br>")).toBe("bold em strike");
  });
});

describe("latestAssistantText / latestBubbleOutput", () => {
  it("returns the newest assistant segment", () => {
    expect(latestAssistantText([assistant("first", 1), assistant("second", 2)])).toBe("second");
  });

  it("skips whitespace-only segments (a streaming placeholder)", () => {
    expect(latestAssistantText([assistant("real", 1), assistant("   ", 2)])).toBe("real");
  });

  it("ignores non-assistant items and returns empty when there is nothing to show", () => {
    const other = { kind: "thinking", id: 9, thinking: "hmm" } as unknown as ChatItem;
    expect(latestAssistantText([other])).toBe("");
    expect(latestAssistantText([])).toBe("");
  });

  it("flattens markdown on the way out", () => {
    expect(latestBubbleOutput([assistant("## Done\n\n- `a`\n- **b**")])).toBe("Done a b");
  });
});

describe("typewriter", () => {
  it("seeds one character short so the first paint is not a wall of text", () => {
    expect(seedTypewriterOutput("hello")).toBe("hell");
    expect(seedTypewriterOutput("a")).toBe("");
    expect(seedTypewriterOutput("")).toBe("");
  });

  it("catches up in steps proportional to how far behind it is", () => {
    // 8 behind → 1 per tick; far behind → the gap/8 step.
    expect(advanceTypewriterOutput("hell", "hello")).toBe("hello");
    expect(advanceTypewriterOutput("", "abcdefghijklmnop")).toBe("ab");
  });

  it("jumps straight to output that replaces the previous one mid-stream", () => {
    expect(advanceTypewriterOutput("old text", "new text")).toBe("new text");
  });

  it("is a no-op once caught up", () => {
    expect(advanceTypewriterOutput("done", "done")).toBe("done");
  });
});
