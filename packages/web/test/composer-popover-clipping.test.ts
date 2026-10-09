/**
 * The composer card's clipping (features/chat/draft-view.tsx).
 *
 * A reported bug: the goal-mode pill and the `/` command menu were sliced off at the card's top
 * edge — only their bottom sliver was visible. The cause was the gray slab wrapping the
 * composer with `overflow-hidden`.
 *
 * The wrapper needed that overflow for one reason only: clipping the card's corners to the
 * slab's radius. But `overflow-hidden` clips **every** descendant that leaves the box, and this
 * composer opens four popovers upward, all `absolute bottom-full`:
 *
 *   - the goal-budget editor
 *   - the `/` command menu (which even carries `upwardMaxH`, a height budget measured from the
 *     room *above* the composer — so it was always designed to render upward, and was never
 *     meant to be clipped)
 *   - the skills picker
 *   - the "+" extension menu
 *
 * So this is a regression guard: if the clipping comes back, all four break again, and nothing
 * about the failure is obvious from the component that caused it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const draftView = readFileSync(`${SRC}/features/chat/draft-view.tsx`, "utf8");
const chatInput = readFileSync(`${SRC}/features/chat/chat-input.tsx`, "utf8");

describe("the composer card does not clip its popovers", () => {
  it("the gray slab no longer sets overflow-hidden", () => {
    // The wrapper is the clipper: `relative rounded-2xl bg-gray-100 …` is the slab, and the
    // whole bug was the `overflow-hidden` that used to sit on it.
    const slab =
      draftView.match(/<div className="([^"]*rounded-2xl bg-gray-100[^"]*)">/)?.[1] ?? "";
    expect(slab).not.toBe("");
    expect(slab).not.toMatch(/overflow-hidden/);
    // `relative` is what the `bottom-full` layers anchor to.
    expect(slab).toMatch(/\brelative\b/);
  });

  it("the card does not clip either — moving it inward would clip the same popovers", () => {
    // First attempt put `isolate overflow-hidden` on the card to keep the radius. That is the
    // same defect one level down: the popovers are *inside* the card, so it clips them just as
    // effectively. Asserted so the "obvious" fix cannot come back.
    expect(draftView).toMatch(/cardClassName=""/);
    expect(draftView).not.toMatch(/cardClassName="[^"]*overflow-hidden/);
  });

  it("keeps the radius without clipping, so the card's corners are still its own", () => {
    // The card brings `rounded-lg` itself; nothing inside it that matters reaches a corner.
    expect(chatInput).toMatch(/@container rounded-lg border border-gray-300/);
  });

  it("keeps focusRing off, which cardClassName could not switch off reliably", () => {
    // A `ring-0` through cardClassName sorts before `ring-2` in the built sheet and silently
    // loses the cascade — the reason this is a prop and not a class.
    expect(draftView).toMatch(/focusRing=\{false\}/);
  });

  it("the popovers that were being cut are all upward, so every one of them was affected", () => {
    const upward = chatInput.match(/absolute bottom-full/g) ?? [];
    // Two in chat-input (the `/` menu and a dropdown menu class) plus the "+"/skills menus
    // built through Dropdown's own positioning. The count is a floor, not an inventory: it only
    // has to stay above zero for this guard to mean anything.
    expect(upward.length).toBeGreaterThan(0);
    expect(chatInput).toMatch(/style=\{\{ maxHeight: upwardMaxH \}\}/);
  });
});
