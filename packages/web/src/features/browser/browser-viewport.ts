/**
 * The slot the dock's browser panel leaves for the page.
 *
 * The panel is a viewport, not the host: the pages live in the app's layer (browser-runtime
 * .tsx), and the layer is placed over this slot by coordinates. The element is found by a
 * data attribute rather than a ref, because the panel and the layer are two different
 * components: neither holds the other.
 */
import type { WebviewElement } from "./browser-guests";

/** The attribute the panel's slot carries, so the layer can find it. */
export const BROWSER_VIEWPORT_ATTR = "data-browser-viewport";

/** The slot the page on screen is shown in, or null when the panel is not showing. */
export function browserSlot(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.querySelector<HTMLElement>(`[${BROWSER_VIEWPORT_ATTR}]`);
}

/** The `<webview>` element showing a tab in this window, if this window hosts it. */
export function webviewForTab(tabId: number | null): WebviewElement | null {
  if (tabId === null || typeof document === "undefined") return null;
  const elements = document.querySelectorAll<WebviewElement>("webview");
  for (const element of elements) {
    try {
      if (element.getWebContentsId() === tabId) return element;
    } catch {
      // Attached, but the element has not been told its id yet.
    }
  }
  return null;
}
