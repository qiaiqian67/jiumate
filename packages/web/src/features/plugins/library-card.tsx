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
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { SkillTile } from "../skills/skill-icon-view";
import { KEY_ICON } from "../../components/ui/icons";

export function LibraryCard({
  icon,
  name,
  fallbackIcon,
  description,
  descriptionTitle,
  action,
  actionOverlay,
  meta,
  keyState,
  keyLabel,
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
  /**
   * Lay `action` over the card's top-right rather than beside the name.
   *
   * For a hover-revealed group that outnumbers the width a name can spare: in the row the
   * buttons are invisible at rest but still occupy it, so the name truncates at a fraction of
   * the card. Overlaying hands the whole row to the name and spends the hover itself instead.
   * A single always-visible control (one install button) stays in flow — there is nothing to
   * reveal and no reason to cover anything.
   */
  actionOverlay?: boolean;
  /** Optional bottom line of real data (version, usage, connection target). */
  meta?: string;
  /** Key state for a subject that needs credentials: yellow unset, green ready, undefined when
   *  it needs none. Rendered at the bottom-right of the meta row. */
  keyState?: "unset" | "ready";
  /** Tooltip naming the variables a keyState subject waits on. */
  keyLabel?: string;
  /** When set, the name area becomes a button that opens the subject. */
  onOpen?: () => void;
}) {
  const header = (
    // `items-center`, not `items-start`: the tile is 40px and the name one line of 20px, and
    // top-aligning them leaves the name sitting high against a much taller icon — which reads
    // as the two not belonging to the same card.
    <span className="flex min-w-0 flex-1 items-center gap-2.5">
      <SkillTile icon={icon} name={name} fallback={fallbackIcon} size={40} glyph={22} />
      {/* One line, ellipsized. `truncate` rather than `line-clamp-2`: the card's width is fixed by
          the grid, so a second line buys nothing but makes short names ragged and pushes the
          description down on the cards that happen to have long names. What shows is a function
          of the card width, which is the honest trade for a fixed grid — the full name stays on
          `title` and in the accessible name, and the detail modal shows it in full. */}
      <span className="min-w-0 flex-1 truncate text-[15px] font-semibold" title={name}>
        {name}
      </span>
    </span>
  );
  return (
    // h-full + the meta line's mt-auto keep the bottoms of a row aligned when one card's
    // description runs to two lines and its neighbour's takes one.
    <div className="group relative flex h-full flex-col rounded-xl border border-gray-200 bg-white p-4 transition-shadow duration-150 hover:shadow-md dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center gap-2">
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            className="flex min-w-0 flex-1 items-center text-left"
          >
            {header}
          </button>
        ) : (
          header
        )}
        {action !== undefined &&
          (actionOverlay ? (
            // Laid over the name's tail instead of beside it. In the row these four buttons are
            // ~146px — invisible at rest but still occupying that space, which left every name
            // about a third shorter and truncating near fifteen characters. The overlay's own
            // inset matches the card's padding so it lines up with the icon, and the `p-4`
            // padding on the card is what keeps the revealed buttons clear of the rounded
            // corner.
            <div className="pointer-events-none absolute right-4 top-4 flex items-center opacity-0 transition-opacity duration-150 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
              <div className="pointer-events-auto">{action}</div>
            </div>
          ) : (
            // In-flow: reserve the row's height so revealing the actions cannot reflow the name.
            <div className="flex min-h-8 shrink-0 items-center">{action}</div>
          ))}
      </div>
      <p
        className="mt-3 line-clamp-2 text-[13px] leading-5 text-gray-500 dark:text-gray-400"
        title={descriptionTitle ?? description}
      >
        {description}
      </p>
      {(meta !== undefined || keyState !== undefined) && (
        // The meta line and the key mark share one row so the key sits at the card's
        // bottom-right rather than adding a row of its own — a subject needing credentials is a
        // fact about it, not a second line of copy.
        <div className="mt-auto flex items-end gap-2 pt-3">
          {meta !== undefined && (
            <p className="min-w-0 flex-1 text-[11px] text-gray-400 dark:text-gray-500">{meta}</p>
          )}
          {keyState !== undefined && (
            <span
              className={`shrink-0 ${keyState === "ready" ? "text-emerald-500 dark:text-emerald-400" : "text-amber-500 dark:text-amber-400"}`}
              title={keyLabel}
              aria-label={keyLabel}
              role="img"
            >
              <GlyphIcon d={KEY_ICON} size={14} />
            </span>
          )}
        </div>
      )}
    </div>
  );
}
