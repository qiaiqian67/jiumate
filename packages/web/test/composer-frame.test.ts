/**
 * The homepage composer frame (`src/features/chat/draft-view.tsx` + `chat-input.tsx`).
 *
 * The reference: a white card **lying on** a gray slab. The gray is the background, not a strip —
 * it is wider than the card, shows above and to both sides of it, and carries a much larger run
 * below the card holding 选择工作空间 / 默认权限. The card is inset in it, with a small even
 * margin on the top and sides.
 *
 * This file exists because two earlier passes got that relationship wrong in opposite directions —
 * one glued card and strip into a single outlined box, the other stacked two same-width boxes with
 * a gap — and in both the gray was a *sibling strip* rather than the surface the card rests on.
 * Neither matched the reference and neither could be caught by the rest of the suite: nothing reads
 * these class strings, and the dev server serves a stale transform, so a pass whose edits are not
 * on disk still reports green. The assertions read the real source.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

const draftView = readFileSync(`${SRC}/features/chat/draft-view.tsx`, "utf8");
const chatInput = readFileSync(`${SRC}/features/chat/chat-input.tsx`, "utf8");

/**
 * The one source line that paints the composer's card. Everything the draft page can turn off
 * about focus lives in this string, so asserting on the line itself (rather than on the whole
 * file) keeps "is this focus effect conditional?" a question with a single answer.
 */
const cardLine = (): string =>
  chatInput.split("\n").find((l) => l.includes("@container rounded")) ?? "";

describe("homepage composer frame", () => {
  it("makes the gray a slab that surrounds the card, not a strip below it", () => {
    // The single wrapper owns the gray and the padding. `p-3` gives the small even margin the
    // reference shows on top and both sides; `pb-6` — far larger — is the gray run at the bottom.
    expect(draftView).toMatch(/overflow-hidden rounded-2xl bg-gray-100 p-3 pb-6/);
  });

  it("has no second gray strip inside the slab", () => {
    // The failure this replaces: a `bg-gray-200` band as a sibling of the card, which reads as a
    // strip under the input rather than as the surface it rests on.
    expect(draftView).not.toMatch(/bg-gray-200/);
  });

  it("clips the card to the slab's corners rather than giving it its own", () => {
    // `overflow-hidden` on the slab is what squares off the card against the gray. A radius passed
    // through cardClassName would draw a second set of corners inside the gray.
    expect(draftView).toMatch(/cardClassName=""/);
    expect(draftView).not.toMatch(/cardClassName="[^"]*rounded/);
  });

  it("keeps the ownership controls on the slab, below the card and without a surface", () => {
    // No radius on the controls: they have no background of their own, only the gray under them.
    const row = draftView.match(/<div className="(px-1 pb-1 pt-2\.5)">/);
    expect(row).not.toBeNull();
    const cardAt = draftView.indexOf("<ChatInput");
    expect(draftView.indexOf("<AgentSelect")).toBeGreaterThan(cardAt);
  });

  it("switches the focus ring off through the prop, never a class-string override", () => {
    // Tailwind v4 settles conflicting utilities by their position in the stylesheet: in this build
    // `.focus-within\:ring-2` sorts after `.focus-within\:ring-0`, so a ring-0 handed in through
    // cardClassName loses the cascade and does nothing, silently.
    expect(draftView).toMatch(/focusRing=\{false\}/);
    expect(draftView).not.toMatch(/cardClassName="[^"]*ring-0/);
  });

  it("puts the focus border under the same prop as the ring", () => {
    // The black frame reported after the ring was removed was NOT the ring — it was
    // `focus-within:border-gray-500`, darkening the border from gray-300 to gray-500 on every
    // click. Measured: 87.2% lightness → 55.1%, plus a 2px rgba(0,0,0,.12) ring shadow.
    // Both, and the dark-mode variant, now ride the same conditional as the ring.
    const line = cardLine();
    const conditional = line.slice(line.indexOf('focusRing ? "'));
    // Every focus-within effect must come from inside the ternary — none may sit in the
    // always-on part of the class string, where it would apply even with focusRing={false}.
    const alwaysOn = line.slice(0, line.indexOf("${focusRing"));
    expect(alwaysOn).not.toMatch(/focus-within:border/);
    expect(alwaysOn).not.toMatch(/focus-within:ring/);
    expect(conditional).toMatch(
      /focusRing \? "focus-within:border-gray-500 focus-within:ring-2 focus-within:ring-gray-400\/30 dark:focus-within:border-gray-400"/,
    );
  });

  it("keeps the ring for the callers that do not opt out", () => {
    // The session and subagent composers rely on the default; removing it globally to fix the
    // draft page would quietly change two other screens. It is a conditional, not a deletion —
    // the border, ring and dark-mode border all still ship when the prop is on.
    expect(chatInput).toMatch(/focusRing = true/);
    const conditional = cardLine().slice(cardLine().indexOf('focusRing ? "'));
    expect(conditional).toMatch(/focus-within:ring-2/);
    expect(conditional).toMatch(/focus-within:border-gray-500/);
    expect(conditional).toMatch(/dark:focus-within:border-gray-400/);
  });

  it("draws no focus ring anywhere on the draft wrapper", () => {
    // An outer ring or a focus-darkened border is the second, larger rectangle around the card
    // that made every click light the composer up.
    expect(draftView).not.toMatch(/has-\[:focus-within\]/);
    expect(draftView).not.toMatch(/focus-within:ring/);
  });

  it("leaves the card's resting border alone", () => {
    // Base classes stay rounded-lg / border-gray-300 for the session and subagent composers. The
    // draft page must not achieve its look by editing those: it clips the card to the slab's radius
    // instead, so the shared card is untouched by a change meant for one screen.
    expect(chatInput).toMatch(/@container rounded-lg border border-gray-300 bg-white/);
  });
});
