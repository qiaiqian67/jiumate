/**
 * The 优化提示词 button (features/chat/enhance-prompt-button.tsx).
 *
 * What is worth asserting here is the **safety** of the two ways it touches a user's text, both
 * of which fail silently if wrong — nothing in the UI looks broken when they do:
 *
 * 1. **A stale result must not land.** The button is used on a draft the user is still editing,
 *    so a slow rewrite arriving after they typed would overwrite the newer words. The guard is
 *    a snapshot compare, and it is easy to weaken to "close enough".
 * 2. **A failure must leave the box untouched.** An empty draft does nothing, a failed call
 *    only toasts, and only a `ok` result replaces the text. A rewrite arriving empty would
 *    delete what they typed.
 *
 * Rendered against a stubbed endpoint rather than the real client, so nothing here depends on
 * a configured model or a network.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const button = readFileSync(`${SRC}/features/chat/enhance-prompt-button.tsx`, "utf8");

describe("EnhancePromptButton", () => {
  it("never sends on the user's behalf — it hands the result back for review", () => {
    // The whole value of the button is that the user confirms the rewrite. If this component
    // ever grew a send call, the feature would silently start answering with text nobody read.
    expect(button).not.toMatch(/\bonSend\b/);
    expect(button).not.toMatch(/sendMessage|submitPrompt|createSession/);
    expect(button).toMatch(/onEnhanced\(res\.prompt\)/);
  });

  it("drops a result whose draft the user has since changed", () => {
    // Without this guard a slow rewrite overwrites newer words and nothing looks wrong.
    expect(button).toMatch(/draftAtRequest/);
    expect(button).toMatch(/if \(text !== draftAtRequest\.current\) return;/);
  });

  it("leaves the draft alone on every failure path", () => {
    // `onEnhanced(` with a paren is a *call*; the prop declaration is `onEnhanced:`. So exactly
    // one match means exactly one call site, and it sits inside the `res.ok` branch — the
    // catch and the no_model branch have no way to reach it.
    const calls = button.match(/onEnhanced\(/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(button).toMatch(/if \(res\.ok\) \{\s*onEnhanced\(res\.prompt\);\s*return;/);
    expect(button).toMatch(/catch \{[\s\S]*?toastError/);
  });

  it("does not ask the server at all for an empty draft", () => {
    expect(button).toMatch(/disabled=\{disabled \|\| busy \|\| !hasDraft\}/);
    expect(button).toMatch(/if \(busy \|\| !hasDraft\) return;/);
  });

  it("surfaces no_model as the actionable message rather than a retry", () => {
    expect(button).toMatch(/res\.code === "no_model"/);
  });
});
