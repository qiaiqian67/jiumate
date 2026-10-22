/**
 * The layer the browser's pages live in, and where each one sits.
 *
 * A `<webview>` reloads its page whenever it is moved in the DOM, so the pages never live
 * inside the dock — the dock's bodies move between the right and bottom docks, in and out
 * of the merged view, on every conversation switch, and a page inside one of them would
 * reload each time.
 *
 * So the pages live in ONE layer, and the layer is placed over the dock's viewport slot by
 * coordinates. Each page is two boxes: a clipping FRAME at the visible part of the slot, and
 * the VIEW inside it at the slot's full size. The frame grows with the slot while a dock
 * slides open, and the page slides in whole, instead of being re-laid-out at every
 * intermediate width.
 *
 * Every page is mounted, all the time. The one on screen is the frame at the slot; the rest
 * are parked far off-screen at a real size, so a page the agent works in while the dock is
 * closed keeps a desktop layout — and keeps being composited, which is what lets the agent
 * take its screenshot.
 */
import type { Rect, Size } from "./browser-geometry";

export { PARK_LEFT, DEFAULT_PARK_SIZE } from "./browser-geometry";
export type { Rect, Size } from "./browser-geometry";

/**
 * Where the page on screen goes, given the slot the panel provides.
 *
 * With no slot (the panel is closed, or the app is on a page that has no dock), the pages
 * are parked: still mounted, still composited, but out of the user's way.
 *
 * The parked place is the top-left corner BEHIND the app (`z-index: -1`), not off the
 * screen. A `<webview>` that is entirely outside the viewport is never composited, and
 * Chromium's `Page.captureScreenshot` on an uncomposited guest HANGS — so the agent's
 * screenshot of a page in a closed panel would time out. Behind the app, the page keeps its
 * layout, keeps its pixels, and keeps rendering; the user simply does not see it.
 */
export function placement(
  slot: Rect | null,
  isOnScreen: boolean,
  park: Size,
): { frame: Rect; view: Rect } {
  if (slot === null || !isOnScreen) {
    return {
      frame: { left: 0, top: 0, width: park.width, height: park.height },
      view: { left: 0, top: 0, width: park.width, height: park.height },
    };
  }
  return {
    frame: { left: slot.left, top: slot.top, width: slot.width, height: slot.height },
    view: { left: 0, top: 0, width: slot.width, height: slot.height },
  };
}

/**
 * The slot the dock's browser panel leaves for the page, in window coordinates.
 *
 * The panel's body is found by its attribute and measured; the layer is placed over it.
 * `null` when there is no such body — the panel is closed, or the app is on a page with no
 * dock.
 */
export function slotRect(element: HTMLElement | null): Rect | null {
  if (element === null) return null;
  const box = element.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return null;
  return { left: box.left, top: box.top, width: box.width, height: box.height };
}
