/**
 * The library card: one installable subject shown as the reference layout — a tinted icon
 * tile and a name on the first row, the corner action at the card's top-right, the
 * description spanning the full card width underneath, and an optional real-data line at the
 * bottom.
 *
 * The description deliberately does NOT sit beside the icon: it is the widest thing on the
 * card and the only part whose length varies, so giving it the full width is what keeps two
 * lines of it legible at a third of the page instead of truncating after four words.
 *
 * Lives beside the two tabs that use it rather than in components/ui, which never reaches
 * into features/ — everything here is display only, so the caller owns the data and the
 * action.
 */
import type { ReactNode } from "react";
import { SkillTile } from "../skills/skill-icon-view";

export function LibraryCard({
  icon,
  name,
  fallbackIcon,
  description,
  descriptionTitle,
  action,
  meta,
  onOpen,
}: {
  /** Sanitized inline svg of the subject, when it has one. */
  icon?: string;
  /** Names the tile's palette color and is the card's title. */
  name: string;
  /** 24×24 line path drawn when there is no usable icon (the subject's kind). */
  fallbackIcon: string;
  /** One or two lines under the header; clamped, with the full text on hover. */
  description: string;
  descriptionTitle?: string;
  /** The corner control (install, edit, …). */
  action?: ReactNode;
  /** Optional bottom line of real data (version, usage, connection target). */
  meta?: string;
  /** When set, the name area becomes a button that opens the subject. */
  onOpen?: () => void;
}) {
  const header = (
    <span className="flex min-w-0 flex-1 items-center gap-2.5">
      <SkillTile icon={icon} name={name} fallback={fallbackIcon} size={40} glyph={22} />
      <span className="min-w-0 flex-1 truncate text-[15px] font-semibold" title={name}>
        {name}
      </span>
    </span>
  );
  return (
    // h-full + the meta line's mt-auto keep the bottoms of a row aligned when one card's
    // description runs to two lines and its neighbour's takes one.
    <div className="group flex h-full flex-col rounded-xl border border-gray-200 bg-white p-4 transition-shadow duration-150 hover:shadow-md dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-start gap-2">
        {onOpen ? (
          <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 text-left">
            {header}
          </button>
        ) : (
          header
        )}
        {action !== undefined && (
          // Reserve the row's height so revealing the actions on hover cannot reflow the name.
          <div className="flex min-h-8 shrink-0 items-center">{action}</div>
        )}
      </div>
      <p
        className="mt-3 line-clamp-2 text-[13px] leading-5 text-gray-500 dark:text-gray-400"
        title={descriptionTitle ?? description}
      >
        {description}
      </p>
      {meta !== undefined && (
        <p className="mt-auto pt-3 text-[11px] text-gray-400 dark:text-gray-500">{meta}</p>
      )}
    </div>
  );
}
