/**
 * The rectangles the browser's layer is placed by.
 *
 * A page is two boxes: a clipping FRAME at the visible part of the slot, and the VIEW
 * inside it at the slot's full size. The frame grows with the slot while a dock slides
 * open, and the page slides in whole, instead of being re-laid-out at every intermediate
 * width.
 */

/** One rectangle in window coordinates. */
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A width and a height. */
export interface Size {
  width: number;
  height: number;
}

/** Where parked pages go: far enough left that no screen reaches them. */
export const PARK_LEFT = -20000;

/** The size of a page that has never been on screen: a common desktop viewport. */
export const DEFAULT_PARK_SIZE: Size = { width: 1280, height: 800 };
