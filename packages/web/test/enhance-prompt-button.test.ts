/**
 * The 优化提示词 button and its 还原 (`features/chat/enhance-prompt-button.tsx`).
 *
 * What is worth asserting here is the **safety** of everything it does to a user's text,
 * because each of these fails *silently* — nothing in the UI looks broken when they do:
 *
 * 1. **It must read the live draft, at click time.** The reported bug: after one rewrite, the
 *    user cleared the box and typed something different, and the button optimized the *old*
 *    prompt. The cause was the draft arriving as a prop fed from a ref the parent updates
 *    without re-rendering, so the handler closed over a snapshot. Asserted structurally: the
 *    draft comes from a getter, and the component subscribes to changes instead.
 * 2. **The in-flight guard must actually fire.** It compared a captured `text` against a copy
 *    of that same `text`, so it was always equal and never dropped anything — a slow rewrite
 *    would still land on top of newer words. Both sides have to come from the live draft.
 * 3. **还原 must never destroy a later edit.** It is offered only while the box still holds
 *    the rewrite untouched, which is why the stored value is a *pair* and not just the
 *    original text.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const button = readFileSync(`${SRC}/features/chat/enhance-prompt-button.tsx`, "utf8");
const chatInput = readFileSync(`${SRC}/features/chat/chat-input.tsx`, "utf8");
const draftView = readFileSync(`${SRC}/features/chat/draft-view.tsx`, "utf8");

describe("EnhancePromptButton", () => {
  it("reads the live draft through a subscription, not a prop snapshot", () => {
    // The bug's whole cause: a `text` prop sourced from the parent's ref mirror.
    expect(button).not.toMatch(/\btext=\{textRef\.current\}/);
    expect(button).toMatch(/useSyncExternalStore\(subscribeText, readText, readText\)/);
    expect(draftView).toMatch(/readText=\{readComposerText\}/);
    expect(draftView).toMatch(/subscribeText=\{subscribeComposerText\}/);
  });

  it("reads the draft at click time and compares the live value against it", () => {
    // Both sides of the guard must come from readText(); a captured value makes the check
    // `x !== x` and it silently stops dropping anything.
    expect(button).toMatch(/const draft = readText\(\)\.trim\(\);/);
    const guards = button.match(
      /if \(readText\(\)\.trim\(\) !== draftAtRequest\.current\) return;/g,
    );
    expect(guards).toHaveLength(2); // the ok path and the catch
  });

  it("offers 还原 only while the text still is the rewrite", () => {
    // Restoring after the user edits would throw away their words for a version they have
    // already moved past — irreversible, so the control withdraws instead.
    expect(button).toMatch(
      /const canRestore = restorePoint !== null && text === restorePoint\.rewritten && !busy && !disabled;/,
    );
    expect(button).toMatch(/\{canRestore && \(/);
  });

  it("keeps the rewrite alongside the original, because the guard needs both", () => {
    // Storing only the original makes the "is it still untouched?" check impossible.
    expect(button).toMatch(/useState<\{ original: string; rewritten: string \} \| null>/);
    expect(button).toMatch(/setRestore\(\{ original: draft, rewritten: res\.prompt \}\)/);
  });

  it("offers no 还原 when the model echoed the draft back unchanged", () => {
    // Otherwise it is a dead control: "restoring" identical text does nothing.
    expect(button).toMatch(/if \(res\.prompt !== draft\) setRestore\(/);
  });

  it("never sends on the user's behalf", () => {
    expect(button).not.toMatch(/\bonSend\b/);
    expect(button).not.toMatch(/sendMessage|submitPrompt|createSession/);
  });

  it("replaces the text only on success, leaving the draft alone otherwise", () => {
    // `onEnhanced(` with a paren is a *call*; the prop declaration is `onEnhanced:`. Two calls
    // = the rewrite and the undo, both guarded by `ok` / `canRestore`.
    expect(button.match(/onEnhanced\(/g) ?? []).toHaveLength(2);
    expect(button).toMatch(/if \(res\.ok\) \{\s*onEnhanced\(res\.prompt\);/);
    expect(button).toMatch(/catch \{[\s\S]*?toastError/);
  });

  it("does not call the server at all for an empty draft", () => {
    expect(button).toMatch(/disabled=\{disabled \|\| busy \|\| !hasDraft\}/);
    expect(button).toMatch(/if \(busy \|\| !draft\) return;/);
  });

  it("surfaces no_model as the actionable message rather than a retry", () => {
    expect(button).toMatch(/res\.code === "no_model"/);
  });
});

describe("ComposerControl live text accessors", () => {
  it("exposes a read and a subscription on the same imperative handle", () => {
    // Two separate useImperativeHandle calls would make the second replace the first and
    // silently drop fillExample — which is what the inspiration cards call.
    const handles = chatInput.match(/useImperativeHandle\(\s*controlRef/g) ?? [];
    expect(handles).toHaveLength(1);
    expect(chatInput).toMatch(/\(\) => \(\{ fillExample, setPrompt, getText, subscribeText \}\)/);
  });

  it("reads from the live mirror rather than the render-time state", () => {
    expect(chatInput).toMatch(/const getText = useCallback\(\(\) => textRef\.current, \[\]\)/);
  });
});
