/**
 * The browser's dock tab, brought up when the agent opens a page.
 *
 * The agent's page is the user-visible half of what the agent does, and a page that opens
 * in a dock the user has closed is a page they never see. So an open request brings the
 * browser's tab up — once per conversation, so hiding it again is respected: the user
 * closing the panel says "not now", and the next page the agent opens may ask again.
 *
 * The dock is per conversation (each conversation has its own arrangement), so this is
 * scoped: the page opens in the conversation that asked for it.
 */
import { openPanel } from "../dock/dock-state";

/** The conversations whose browser tab has been brought up, so it is not done twice. */
const broughtUp = new Set<string>();

/**
 * Brings the browser's dock tab up in this conversation, unless it already is.
 *
 * `scope` is the conversation the page belongs to; the empty string is the draft page,
 * which has no conversation of its own and is treated as its own scope.
 */
export function revealBrowserPanel(scope: string): void {
  if (broughtUp.has(scope)) return;
  broughtUp.add(scope);
  openPanel("browser");
}

/** Forgets what was brought up — the conversation changed, so the next page may ask again. */
export function resetBrowserReveal(): void {
  broughtUp.clear();
}
