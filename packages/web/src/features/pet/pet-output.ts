/**
 * Turns the live transcript into the one line a pet bubble shows.
 *
 * The bubble is 180px wide and a couple of lines tall, so markdown has to go:
 * a fenced block or a link would eat the whole budget and read as punctuation
 * soup. Mirrors OpenBitFun's `markdownToPlainText` + `truncateLatestOutput`,
 * kept out of the chat page so it can be unit-tested without a stream.
 */
import type { ChatItem } from "../../lib/omni/stream-model";

/**
 * The bubble shows a fixed number of lines, so the emitter trims here rather
 * than shipping a whole reply across the channel on every streamed token.
 */
export const PET_OUTPUT_LIMIT = 160;

export function petPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[^\n]*\n?|```/g, " "))
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/[*_~]{1,3}/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Collapse whitespace and trim to the bubble's budget, with an ellipsis when cut. */
export function truncatePetOutput(text: string, limit = PET_OUTPUT_LIMIT): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= limit) return flat;
  return `${flat.slice(0, limit - 1).trimEnd()}…`;
}

/** The newest assistant segment with content, flattened and trimmed for the bubble. */
export function latestAssistantText(items: readonly ChatItem[]): string {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (item === undefined) continue;
    if (item.kind !== "assistant_text") continue;
    if (item.text.trim() === "") continue;
    return item.text;
  }
  return "";
}

/** `latestAssistantText` + markdown flattening + truncation, in one call. */
export function latestBubbleOutput(items: readonly ChatItem[]): string {
  return truncatePetOutput(petPlainText(latestAssistantText(items)));
}
