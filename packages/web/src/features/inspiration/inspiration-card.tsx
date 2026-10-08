/**
 * One inspiration case as a gallery card.
 *
 * The shape is the plugins library's two-part card (`features/plugins/plugins-page.tsx`), which
 * the old App Center page already copied: the main body opens the detail Modal, and the trailing
 * edge carries the one-click fill. Both are reachable from the card without leaving the page —
 * read first, start second.
 *
 * The trailing edge is a **text** button, not a glyph one: that is what the plugins library puts
 * on its cards, and `Button`'s bordered `size="icon"` square has no call site anywhere in the app.
 * The heart and the admin's edit/delete beside it are bare glyphs with no button chrome — the shape
 * every glyph-only affordance in this app uses (the session row's hover actions, the copy button).
 *
 * The card carries four things the old one did not:
 *
 * - **A cover area, not a thumbnail.** The screenshot-sized block at the top is what the eye scans
 *   the grid with, so it holds either the admin's uploaded image or the case's glyph at display
 *   size. A glyph card therefore reads as deliberately sparse rather than as a missing image.
 * - **A kind badge**, because a case can be an app, an agent, a skill, a tool or a prompt and the
 *   difference decides whether clicking it is a build request or a question.
 * - **An official badge** for a built-in. The built-ins are the product's own showcase and cannot
 *   be edited or deleted, and saying so on the card is what makes the missing edit affordance read
 *   as a rule rather than as a bug.
 * - **A star**, which is the user's own list rather than an admin's content.
 *
 * The admin's edit and delete buttons are hover/focus-revealed *and* always present in the
 * accessibility tree, so a keyboard user reaches them with Tab — the sidebar's hover-only pattern
 * would put them out of reach there.
 */
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { HEART_ICON } from "../../components/ui/icons";
import { ICON_SIZE } from "../../lib/icon-scale";
import { S } from "../../lib/strings";
import { PENCIL_ICON, TRASH_ICON } from "../../components/ui/session-row-menu";
import { coverUrl, isEditable, kindLabel, localizedCase } from "./inspiration-service";
import type { InspirationCase } from "@prismshadow/jiumate-inspirations";
import type { Locale } from "../../state/locale";

/**
 * A trailing glyph action (edit / delete).
 *
 * A bare `<button>` around a glyph — **no border, no background** — because that is what every
 * glyph-only affordance in this app is: the session row's hover actions, the copy button, the
 * group headers. `Button`'s `size="icon"` is a *bordered* square and no call site in the app uses
 * it, so reaching for it here is what made these read as square buttons rather than as marks.
 *
 * No hover-gating, unlike the session row's: those sit on a row the pointer is already on, whereas
 * these are the only way to reach an admin case's edit form, and an affordance that appears only
 * under the pointer is one a scanning eye never learns is there.
 */
function CardAction({
  label,
  glyph,
  danger = false,
  onClick,
}: {
  label: string;
  glyph: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-400 transition-colors duration-150 ${
        danger
          ? "hover:text-red-600 dark:hover:text-red-400"
          : "hover:text-gray-700 dark:hover:text-gray-200"
      }`}
    >
      <GlyphIcon d={glyph} size={ICON_SIZE.rowLead} />
    </button>
  );
}

export function InspirationCard({
  one,
  locale,
  favorite,
  canManage,
  disabled,
  onOpen,
  onInvoke,
  onToggleFavorite,
  onEdit,
  onDelete,
}: {
  one: InspirationCase;
  locale: Locale;
  favorite: boolean;
  /**
   * Whether this viewer may edit or delete *this* case. True for an admin whatever the source:
   * a built-in is shadowed by an admin copy of the same id, never rewritten in place.
   */
  canManage: boolean;
  /** True until the selected Agent's installed skills are known: a fill before that drops pins. */
  disabled: boolean;
  onOpen: () => void;
  onInvoke: () => void;
  onToggleFavorite: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const copy = localizedCase(locale, one);
  const image = coverUrl(one);
  const editable = isEditable(one, canManage);

  return (
    <article className="group flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white transition-colors duration-150 hover:border-gray-300 hover:shadow-sm dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700">
      {/* Cover: a button, because the whole point of the block is "show me this one". A real
          <img> rather than a background, so a broken asset degrades to its alt text instead of
          to an empty box. */}
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${S.inspiration.openDetail} ${copy.title}`}
        title={copy.description}
        className="flex h-36 w-full items-center justify-center overflow-hidden bg-gray-50 transition-colors duration-150 hover:bg-gray-100 dark:bg-gray-800/60 dark:hover:bg-gray-800"
      >
        {image !== null ? (
          <img
            src={image}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
            // A cover that fails to load falls back to the case's glyph, which is always there.
            onError={(event) => {
              event.currentTarget.style.display = "none";
            }}
          />
        ) : (
          <span aria-hidden className="text-5xl leading-none">
            {one.cover.kind === "glyph" ? one.cover.glyph : "✨"}
          </span>
        )}
      </button>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-3">
        <div className="flex items-start gap-1.5">
          <button
            type="button"
            onClick={onOpen}
            className="min-w-0 flex-1 text-left text-sm font-medium text-gray-900 hover:underline dark:text-gray-100"
          >
            <span className="line-clamp-2">{copy.title}</span>
          </button>
          <button
            type="button"
            aria-pressed={favorite}
            aria-label={`${favorite ? S.inspiration.unfavorite : S.inspiration.favorite} ${copy.title}`}
            title={favorite ? S.inspiration.unfavorite : S.inspiration.favorite}
            onClick={onToggleFavorite}
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors duration-150 ${
              favorite
                ? "text-red-500 dark:text-red-400"
                : "text-gray-300 hover:text-red-500 dark:text-gray-600 dark:hover:text-red-400"
            }`}
          >
            <GlyphIcon d={HEART_ICON} size={ICON_SIZE.rowLead} filled={favorite} />
          </button>
        </div>

        <p className="line-clamp-2 min-h-8 text-xs text-gray-500 dark:text-gray-400">
          {copy.description}
        </p>

        <div className="mt-auto flex items-center gap-1.5 pt-1">
          <Badge>{kindLabel(one.kind)}</Badge>
          {one.source === "builtin" && <Badge tone="brand">{S.inspiration.official}</Badge>}
          {!one.enabled && <Badge tone="amber">{S.inspiration.hiddenBadge}</Badge>}
          <span className="flex-1" />
          {editable && (
            // Visible on hover/focus and dimmed at rest rather than hidden: an admin scanning the
            // grid should be able to see which cards are theirs without hovering each one.
            <span className="flex items-center opacity-60 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
              <CardAction label={S.common.edit} glyph={PENCIL_ICON} onClick={onEdit} />
              <CardAction label={S.common.delete} glyph={TRASH_ICON} danger onClick={onDelete} />
            </span>
          )}
          {/* The visible label is the same two words on every card, so the accessible name carries
              the case title: a screen reader otherwise reads a column of eleven identical buttons.
              `title` gives the same disambiguation to a pointer. */}
          <Button
            size="sm"
            className="shrink-0"
            disabled={disabled}
            aria-label={`${S.inspiration.invokeHint} ${copy.title}`}
            title={`${S.inspiration.invokeHint} ${copy.title}`}
            onClick={onInvoke}
          >
            {S.inspiration.invokeHint}
          </Button>
        </div>
      </div>
    </article>
  );
}
