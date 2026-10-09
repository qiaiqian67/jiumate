/**
 * The 优化提示词 control and its 撤回 state (`features/chat/enhance-prompt-button.tsx`), plus
 * where it is mounted (`chat-input.tsx` / `draft-view.tsx`).
 *
 * What is worth asserting is **placement** and **safety**, because both fail invisibly:
 *
 * 1. **It must live in ChatInput, not on the draft page.** Rewriting a prompt is a property of a
 *    composer. Hosted in draft-view it existed on the new-chat box only, and the session
 *    composer — where a user hits the same incomprehensible-prompt wall mid-conversation, with a
 *    half-answer already built on their wording — had no way to fix it. Asserted from both
 *    sides: mounted inside ChatInput, and gone from draft-view.
 * 2. **It must read the live draft, at click time.** The reported bug: after one rewrite, the
 *    user cleared the box and typed something different, and it optimized the *previous* prompt.
 *    The cause was the draft arriving as a prop fed from a ref the parent updates without
 *    re-rendering, so the handler closed over a snapshot.
 * 3. **撤回 must never destroy a later edit.** Offered only while the box still holds the
 *    rewrite untouched — which is why the stored value is a *pair*, not just the original.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const control = readFileSync(`${SRC}/features/chat/enhance-prompt-button.tsx`, "utf8");
const chatInput = readFileSync(`${SRC}/features/chat/chat-input.tsx`, "utf8");
const draftView = readFileSync(`${SRC}/features/chat/draft-view.tsx`, "utf8");

describe("the control is mounted in the Claude Opus 5.5, so both pages get it", () => {
  it("lives inside ChatInput's toolbar", () => {
    expect(chatInput).toMatch(/<EnhancePromptControl[\s\S]*?\/>/);
    // Reached through the live handle, not props.
    expect(chatInput).toMatch(/readText=\{getText\}/);
    expect(chatInput).toMatch(/subscribeText=\{subscribeText\}/);
    expect(chatInput).toMatch(/onReplace=\{setPrompt\}/);
  });

  it("is no longer on the draft page, which would leave the session page without it", () => {
    expect(draftView).not.toMatch(/EnhancePrompt(Control|Button)/);
  });

  it("resolves the Project itself instead of making every host thread an id", () => {
    expect(control).toMatch(/useProject\(\)/);
    expect(control).toMatch(/if \(!projectId\) return null;/);
  });

  it("disables itself while the run is busy, where the box is inert", () => {
    expect(chatInput).toMatch(/disabled=\{running \|\| compacting \|\| busy\}/);
  });
});

describe("EnhancePromptControl", () => {
  it("reads the live draft through a subscription, not a prop snapshot", () => {
    expect(control).not.toMatch(/\btext=\{textRef\.current\}/);
    expect(control).toMatch(/useSyncExternalStore\(subscribeText, readText, readText\)/);
  });

  it("reads the draft at click time and compares the live value against it", () => {
    // Both sides of the guard must come from readText(); a captured value makes the check
    // `x !== x` and it silently stops dropping anything.
    expect(control).toMatch(/const draft = readText\(\)\.trim\(\);/);
    const guards = control.match(
      /if \(readText\(\)\.trim\(\) !== draftAtRequest\.current\) return;/g,
    );
    expect(guards).toHaveLength(2); // the ok path and the catch
  });

  it("becomes the undo control in place, rather than growing a second button", () => {
    // One control, two mutually exclusive states: there is nothing to undo until there has
    // been a rewrite, and nothing to rewrite once there is an undo.
    expect(control).toMatch(/const isUndo = canRestore;/);
    expect(control).toMatch(/d=\{isUndo \? RESTORE_ICON : ENHANCE_ICON\}/);
    expect(control).toMatch(/onClick=\{\(\) => \(isUndo \? restoreOriginal\(\) : void run\(\)\)\}/);
  });

  it("offers no undo when the model echoed the draft back unchanged", () => {
    // Otherwise it is a dead control: "restoring" identical text does nothing.
    expect(control).toMatch(/if \(res\.prompt !== draft\) setRestore\(/);
  });

  it("carries no visible text, and names itself for hover and for screen readers", () => {
    // Icon-only: a permanent label would spend toolbar width next to already-labelled pills.
    // The two are still distinguishable, which is the requirement — a title on hover, and an
    // aria-label for anyone not using a mouse.
    expect(control).toMatch(/title=\{hint\}/);
    expect(control).toMatch(/aria-label=\{label\}/);
    expect(control).toMatch(/const label = busy[\s\S]*?isUndo[\s\S]*?S\.chat\.enhancePrompt;/);
    expect(control).not.toMatch(/<span[^>]*>\s*\{(busy|isUndo)/);
  });

  it("offers undo only while the text still is the rewrite", () => {
    // Restoring after the user edits would throw away their words for a version they have
    // already moved past — irreversible, so the control withdraws instead.
    expect(control).toMatch(
      /const canRestore = restorePoint !== null && text === restorePoint\.rewritten && !busy && !disabled;/,
    );
  });

  it("keeps the rewrite alongside the original, because the guard needs both", () => {
    expect(control).toMatch(/useState<\{ original: string; rewritten: string \} \| null>/);
    expect(control).toMatch(/setRestore\(\{ original: draft, rewritten: res\.prompt \}\)/);
  });

  it("never sends on the user's behalf", () => {
    expect(control).not.toMatch(/\bonSend\b/);
    expect(control).not.toMatch(/sendMessage|submitPrompt|createSession/);
  });

  it("replaces the text only on success, leaving the draft alone otherwise", () => {
    // `onReplace(` with a paren is a *call*; the prop declaration is `onReplace:`. Two calls
    // = the rewrite and the undo, both guarded by `ok` / `canRestore`.
    expect(control.match(/onReplace\(/g) ?? []).toHaveLength(2);
    expect(control).toMatch(/if \(res\.ok\) \{\s*onReplace\(res\.prompt\);/);
    expect(control).toMatch(/catch \{[\s\S]*?toastError/);
  });

  it("does not call the server at all for an empty draft", () => {
    expect(control).toMatch(/disabled=\{disabled \|\| busy \|\| \(!isUndo && !hasDraft\)\}/);
    expect(control).toMatch(/if \(busy \|\| !draft\) return;/);
  });

  it("surfaces no_model as the actionable message rather than a retry", () => {
    expect(control).toMatch(/res\.code === "no_model"/);
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
