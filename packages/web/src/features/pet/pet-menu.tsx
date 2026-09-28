/**
 * Context menu for the floating pet window.
 *
 * Positioned by its distance from the window's **bottom-right** corner rather
 * than by `clientX/clientY`: the shell keeps that corner fixed when the window
 * grows, so a corner-relative anchor survives the resize that opening the menu
 * triggers. Ported from OpenBitFun's `menuAnchorFromEvent`.
 */
import type { MouseEvent } from "react";

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

export function menuAnchorFromEvent(event: MouseEvent): PetMenuAnchor {
  return {
    right: Math.max(0, window.innerWidth - event.clientX),
    bottom: Math.max(0, window.innerHeight - event.clientY),
  };
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
  return (
    <>
      <div className="jiumate-pet-menu__backdrop" onPointerDown={onClose} />
      <div
        className="jiumate-pet-menu"
        role="menu"
        style={{ right: `${anchor.right}px`, bottom: `${anchor.bottom}px` }}
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
