/**
 * The homepage composer frame (`src/features/chat/draft-view.tsx` + `chat-input.tsx`).
 *
 * The reference shows a white card on a gray strip with **no outline and no focus state**: same
 * corner size on both, and nothing changes when the composer takes focus. An earlier pass wrapped
 * them in a bordered box that also ringed and darkened its border on focus, so you saw a second
 * rounded rectangle *around* the card and the card lit up on every click. Two reports came back
 * about exactly those two things, which is why they are checked rather than described.
 *
 * Both parts of that are silent failures, which is why they are worth a test:
 *
 * 1. **The focus ring cannot be turned off with a class.** The card sets `focus-within:ring-2` in
 *    its own base classes, and Tailwind v4 settles conflicting utilities by where they land in the
 *    generated stylesheet — in this build `.focus-within\:ring-2` comes *after*
 *    `.focus-within\:ring-0`. So a `ring-0` passed in via `cardClassName` loses the cascade and
 *    does nothing at all, with no error anywhere. It has to be a prop (`focusRing`) set where the
 *    ring is set, and this test fails if the class-string version creeps back.
 *
 * 2. **The radius is two class strings that must agree.** `rounded-lg` appears on the wrapper, the
 *    card override and the strip. Nothing computes that for you, and a mismatch is a screenshot.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

const draftView = readFileSync(`${SRC}/features/chat/draft-view.tsx`, "utf8");
const chatInput = readFileSync(`${SRC}/features/chat/chat-input.tsx`, "utf8");

describe("homepage composer frame", () => {
  it("draws no border, shadow or ring on the wrapper itself", () => {
    // The wrapper exists only to carry the radius now. Anything focus- or border-related here is
    // the outer rectangle that made the card look boxed-in.
    const wrapper = draftView.match(/<div className="([^"]*)">\s*\n\s*<ChatInput/);
    expect(wrapper).not.toBeNull();
    expect(wrapper?.[1]).toBe("rounded-lg");
  });

  it("keeps the card and the strip on one corner size", () => {
    // All three pieces must be the same radius. A half-rounded card (`rounded-t-*`) is the old
    // strip-attached shape; a different size on the strip is the mismatch reported back.
    expect(draftView).toMatch(/cardClassName="rounded-lg"/);
    expect(draftView).toMatch(/rounded-lg bg-gray-200/);
    expect(draftView).not.toMatch(/cardClassName="[^"]*rounded-t-/);
  });

  it("leaves the strip its own rounded corners rather than inheriting the wrapper's", () => {
    // The wrapper spans both pieces, so if the strip had no radius of its own the gray would show
    // the wrapper's corners only at its own bottom edge — four corners from two different boxes.
    expect(draftView).toMatch(/mt-2\.5 rounded-lg bg-gray-200/);
  });

  it("switches the focus ring off through the prop, never a class-string override", () => {
    expect(draftView).toMatch(/focusRing=\{false\}/);
    // The override that looks right and does nothing: sorts before ring-2 in the built sheet.
    expect(draftView).not.toMatch(/cardClassName="[^"]*ring-0/);
  });

  it("keeps the ring for the callers that do not opt out", () => {
    // The session and subagent composers rely on the default, so dropping the ring globally to
    // fix the draft page would quietly change two other screens.
    expect(chatInput).toMatch(/focusRing = true/);
    expect(chatInput).toMatch(/focusRing \? "focus-within:ring-2 focus-within:ring-gray-400\/30"/);
  });

  it("does not transition box-shadow on the card, since it no longer has one", () => {
    // `transition-[border-color]` only. Leaving `box-shadow` in the list would animate a shadow
    // that is never painted, which is harmless but reads as the frame still expecting one.
    expect(chatInput).toMatch(/transition-\[border-color\]/);
  });

  it("keeps the ownership controls below the card", () => {
    const cardAt = draftView.indexOf("<ChatInput");
    const rowAt = draftView.indexOf("<AgentSelect");
    expect(cardAt).toBeGreaterThan(-1);
    expect(rowAt).toBeGreaterThan(cardAt);
  });
});
