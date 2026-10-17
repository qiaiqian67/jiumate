/**
 * Context menu for the floating pet window.
 *
 * ## Why the anchor is not the click point
 *
 * The menu opens inside a window that is only 96×104 at rest (PET_WINDOW_BASE_* in
 * pet-window.ts) and cannot grow past the screen edge. A menu laid out at the click point in a box
 * that small is cropped on whichever side it falls off: the pet normally sits near the bottom-right
 * corner, so a menu extending left and up from the click point runs off the *window's* left edge,
 * not the screen's — and a cropped menu reads as a broken one rather than as a small window.
 *
 * So the menu is laid out against the window's own corners: it opens up-and-left from the click,
 * clamped so that its measured size always fits, and flips to the opposite direction when it would
 * not. The click point still decides *which* corner, so the menu appears where the user clicked
 * rather than at some fixed spot.
 *
 * The clamping is done in a layout effect against the measured box, because the menu's size is not
 * knowable until it has rendered (the labels are localised, and a long label is wider). Positioning
 * it in the same pass that renders it would place it at its pre-measurement size and leave it there.
 */
import type { MouseEvent } from "react";
import { useLayoutEffect, useRef, useState } from "react";

export interface PetMenuItem {
  key: string;
  label: string;
  danger?: boolean;
  onSelect: () => void;
}

export interface PetMenuAnchor {
  right: number;
  bottom: number;
}

export const PET_MENU_EDGE_MARGIN = 6;

/**
 * The space a menu needs, as the window sizes itself around it.
 *
 * The window is sized by the page (pet-window-page.tsx) from the pet, its bubbles and — while a
 * menu is open — the menu. So these have to be declared where the menu is defined: a menu that grew
 * without them would be sized for the old one and cropped again. The numbers are the CSS's own
 * (`min-width`, `py-1` + border, and the row's `py-1 text-xs`), kept in step with it deliberately
 * rather than measured at runtime, because the window has to be resized *before* the menu renders.
 */
export const MENU_MIN_WIDTH = 120;
/** One row's height: `py-1` (4px each side) + `text-xs` line-height. */
export const MENU_ROW_HEIGHT = 24;
/** The menu's own chrome: `py-1` (4px each side) plus the 1px borders. */
export const MENU_CHROME_HEIGHT = 10;

/** Menu width used for the flip decision before it has rendered. */
const ESTIMATED_MENU_WIDTH = 132;
/** Menu height used for the flip decision before it has rendered. */
const ESTIMATED_MENU_ROW_HEIGHT = 26;

export function menuAnchorFromEvent(event: MouseEvent): PetMenuAnchor {
  return {
    right: Math.max(0, window.innerWidth - event.clientX),
    bottom: Math.max(0, window.innerHeight - event.clientY),
  };
}

/**
 * Where the menu should sit, given its measured size.
 *
 * Exported for the test rather than for the component: the rule is four comparisons, but which of
 * them fires depends on the window size and the click position together, and those are exactly the
 * combinations a manual check misses — the pet near the bottom-right is the common case, and the
 * crop the bug report describes is the top-left combination.
 *
 * ## What this cannot do on its own
 *
 * When the menu is wider than the window there is no position that fits, and this returns the least
 * bad one — anchored to the edge with the margin, extending inwards as far as the window allows.
 * The overflow is real and is not hidden here: the other half of the fix is in
 * pet-window-page.tsx, which grows the window to fit the menu while it is open. This function only
 * decides *which corner* once there is room, and guarantees it never pushes the menu off the top or
 * left of whatever space it has.
 */
export function menuPlacement(
  anchor: PetMenuAnchor,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): PetMenuAnchor {
  // `margin` is the gap between the menu and the window edge, so the menu never sits flush against
  // a corner where the rounded border would touch the pet sprite.
  const margin = PET_MENU_EDGE_MARGIN;

  // Extending up-and-left from the click point is the natural direction for a bottom-right pet.
  // Both axes flip independently: a click near the left edge may still fit vertically.
  let right = anchor.right;
  let bottom = anchor.bottom;

  if (right + size.width + margin > viewport.width) {
    // Flip to the click point's right: `right` becomes the distance from the *left* edge.
    right = Math.max(margin, viewport.width - anchor.right);
  }
  // `max(margin, …)` rather than a bare subtraction: when the menu does not fit at all the upper
  // bound goes negative, and clamping to a negative offset would push the menu off the left edge —
  // strictly worse than overflowing to the right, where the window growth above is already handling it.
  right = clamp(right, margin, Math.max(margin, viewport.width - size.width - margin));

  if (bottom + size.height + margin > viewport.height) {
    bottom = Math.max(margin, viewport.height - anchor.bottom);
  }
  bottom = clamp(bottom, margin, Math.max(margin, viewport.height - size.height - margin));

  return { right, bottom };
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

export function PetMenu({
  items,
  anchor,
  onClose,
}: {
  items: readonly PetMenuItem[];
  anchor: PetMenuAnchor;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // null until measured: the first paint has no size, so the estimate places it and the layout
  // effect corrects it before the browser paints. Placing it only after measuring would mean a
  // visible jump on every open.
  const [placement, setPlacement] = useState<PetMenuAnchor>(() =>
    menuPlacement(
      anchor,
      {
        width: ESTIMATED_MENU_WIDTH,
        height: items.length * ESTIMATED_MENU_ROW_HEIGHT,
      },
      { width: window.innerWidth, height: window.innerHeight },
    ),
  );

  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const next = menuPlacement(
      anchor,
      { width: el.offsetWidth, height: el.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    );
    // Same value: skip the set so this cannot loop on a resize that changed nothing.
    if (next.right === placement.right && next.bottom === placement.bottom) return;
    setPlacement(next);
  }, [anchor, items.length, placement.right, placement.bottom]);

  return (
    <>
      <div className="jiumate-pet-menu__backdrop" onPointerDown={onClose} />
      <div
        ref={ref}
        className="jiumate-pet-menu"
        role="menu"
        style={{ right: `${placement.right}px`, bottom: `${placement.bottom}px` }}
      >
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            className={`jiumate-pet-menu__item${
              item.danger === true ? " jiumate-pet-menu__item--danger" : ""
            }`}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </>
  );
}
