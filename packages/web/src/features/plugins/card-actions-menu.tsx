/**
 * The library card's hover actions, folded into one ellipsis menu.
 *
 * Five buttons laid over a card's name is a control strip, not an affordance: at a third of the
 * page width the group cost the name a third of its own width, and the five glyphs read as five
 * unrelated commands with no hierarchy between them. They are the same five commands as before —
 * this changes where they live, not what they do.
 *
 * **The ellipsis is a filled glyph, not a stroked one** (`ELLIPSIS_ICON` through `GlyphIcon`'s
 * filled mode), for the reason the sidebar's row menu gives: hairline dots vanish at button size.
 *
 * `Dropdown` in portal mode, so the panel escapes the card grid's own overflow — an in-flow
 * absolutely-positioned panel is clipped by any ancestor with a non-visible overflow on one axis,
 * and this one hangs off a card near the edge of a scrolling page.
 *
 * The switch row is not a menu item: it is a `Switch`, because its state lives in its position,
 * not in its glyph, and a power icon that is filled or outline is a difference nobody reads at a
 * glance. It sits at the foot of the panel, in its own row, where it can be aimed at.
 *
 * The update dot rides the **menu row**, not the trigger: the trigger is the card's only visible
 * affordance, so a waiting update would be invisible until the menu was open — the one thing the
 * dot exists to prevent. It also rides the trigger, because a card whose update is waiting should
 * say so without being opened.
 */
import { useState } from "react";
import { Dropdown } from "../../components/ui/dropdown";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { Icon } from "../../components/ui/group-list";
import { Switch } from "../../components/ui/switch";
import { UpdateDot, UPDATE_DOT_INLINE } from "../../components/ui/update-dot";
import {
  ELLIPSIS_ICON,
  overflowMenuDangerClass,
  overflowMenuGlyph,
  overflowMenuRowClass,
} from "../../components/ui/session-row-menu";
import { ICON_SIZE } from "../../lib/icon-scale";
import { S } from "../../lib/strings";

/** One command in the menu. Disabled rows stay listed and say why in their title: a command that
 *  is merely unavailable (nothing to upgrade, not removable) is a fact the user needs, and hiding
 *  it leaves them asking why it is missing. */
export interface CardMenuItem {
  key: string;
  label: string;
  icon: string;
  onClick: () => void;
  /** Red row, for the irreversible one. */
  danger?: boolean;
  disabled?: boolean;
  /** Why it is unavailable, when it is. */
  disabledReason?: string;
  /** The waiting-update dot, on the row that performs the update. */
  updated?: boolean;
}

export interface CardMenuSwitch {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  label: string;
  hint?: string;
}

/** The hover trigger: one ellipsis, revealed like the buttons it replaces. */
const triggerClass =
  "pointer-events-none flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-500 opacity-0 transition-opacity duration-150 focus:pointer-events-auto focus:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 dark:text-gray-400";

export function CardActionsMenu({
  items,
  menuLabel,
  switch: toggle,
  triggerLabel,
}: {
  items: readonly CardMenuItem[];
  /** Accessible name of the menu itself, e.g. 「插件的操作」. */
  menuLabel: string;
  /** The enable/disable switch, rendered in the panel's foot rather than as a row. */
  switch?: CardMenuSwitch;
  /** Accessible name of the ellipsis trigger, typically the subject's own name. */
  triggerLabel: string;
}) {
  const [open, setOpen] = useState(false);
  // Nothing to open: a bundled skill has no actions, and an ellipsis that opens an empty panel is
  // worse than no ellipsis.
  if (items.length === 0 && toggle === undefined) return null;

  return (
    <Dropdown
      open={open}
      setOpen={setOpen}
      portal={{ direction: "down", align: "right" }}
      menuClass="w-56 max-w-[calc(100vw-2rem)]"
      button={
        <button
          type="button"
          title={S.chat.moreActions}
          aria-label={`${S.chat.moreActions} ${triggerLabel}`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={triggerClass}
        >
          <GlyphIcon d={ELLIPSIS_ICON} size={ICON_SIZE.iconButton} filled />
          {items.some((i) => i.updated) && (
            <UpdateDot
              size="inline"
              position="right-0.5 top-0.5 -translate-y-1/2 translate-x-1/2"
            />
          )}{" "}
        </button>
      }
    >
      <div role="menu" aria-label={menuLabel}>
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            title={item.disabled ? (item.disabledReason ?? item.label) : item.label}
            // `disabled` already blocks activation; the muted glyph keeps the row readable while
            // it is unavailable rather than looking like a live command that happens to ignore
            // clicks.
            className={
              item.danger
                ? `${overflowMenuDangerClass} disabled:cursor-not-allowed disabled:opacity-50`
                : `${overflowMenuRowClass} disabled:cursor-not-allowed disabled:opacity-50`
            }
            onClick={item.onClick}
          >
            {item.danger ? (
              // The glyph inherits the row's red.
              <span className="shrink-0">
                <Icon d={item.icon} size={ICON_SIZE.inlineGlyph} />
              </span>
            ) : (
              overflowMenuGlyph(item.icon)
            )}
            <span className="flex-1">{item.label}</span>
            {/*
              `UPDATE_DOT_INLINE`, not `UpdateDot`: that one is absolutely positioned for
              hanging on a control's corner, and a menu row is not a `relative` anchor — it
              would have positioned against the Dropdown root and floated off the row it
              belongs to. This is the in-flow variant update-dot.tsx exports for exactly
              this case.
            */}
            {item.updated && <span aria-hidden className={UPDATE_DOT_INLINE} />}
          </button>
        ))}
        {toggle && (
          // A separator's own row rather than a border on the switch row, so the two read as
          // unrelated things sharing a panel — which is what they are: a command list above, one
          // persistent state below.
          <>
            <div className="my-1 border-t border-gray-100 dark:border-gray-800" role="separator" />
            <div className="flex items-center justify-between gap-3 px-2.5 py-1.5">
              <span className="min-w-0 truncate text-xs text-gray-700 dark:text-gray-300">
                {toggle.label}
              </span>
              <Switch
                size="sm"
                checked={toggle.checked}
                onChange={toggle.onChange}
                disabled={toggle.disabled}
                aria-label={toggle.label}
                title={toggle.hint}
              />
            </div>
          </>
        )}
      </div>
    </Dropdown>
  );
}
