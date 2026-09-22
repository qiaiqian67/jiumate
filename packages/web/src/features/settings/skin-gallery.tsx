/**
 * The theme gallery: one list, the way Codex Dream Skin's library is one list.
 *
 * ## Why one list and not two
 *
 * This used to be three controls — a light-skin dropdown, a dark-skin dropdown and a wallpaper
 * picker — because a palette served one mode and the artwork was a separate choice. That is not
 * how a theme works in the project this format comes from: a theme is a palette **and** an
 * artwork, and it declares which shells the artwork holds up under. `appearance` is the field
 * that replaces the split, so there is nothing left to choose twice.
 *
 * ## Why picking a card can move the mode
 *
 * A single-shell theme pins the app's mode (`theme.tsx`), because the parts of the window this
 * host does not paint render against the shell. So a card's badge says what it will do before
 * the click: `auto` follows the user's own setting, `light` and `dark` pin it. The card for a
 * theme whose shell differs from the current one says so rather than letting the click look
 * inert.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import { S } from "../../lib/strings";
import { CheckIcon, CloseIcon } from "../../components/ui/icons";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { apiErrorText } from "../../lib/api-error";
import { ApiError } from "../../api/client";
import { useTheme } from "../../state/theme";
import { deleteTheme } from "../skin/skin-service";
import type { ThemeDescriptor } from "../skin/skin-service";
import type { SkinSelection } from "../../state/theme";

export function SkinGallery() {
  const { themes, activeTheme, setTheme, pinnedMode, refreshSkins } = useTheme();
  const [deleting, setDeleting] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    setDeleting(id);
    try {
      await deleteTheme(id);
      // Clear a selection that named it: the resolver would degrade a dangling id to "none"
      // anyway, but leaving it would keep the gallery showing a name that no longer exists.
      if (activeTheme === id) setTheme(null);
      await refreshSkins();
      toastSuccess(S.settings.themeDeleted);
    } catch (err) {
      toastError(err instanceof ApiError ? apiErrorText(err) : S.settings.themeDeleteFailed);
    } finally {
      setDeleting(null);
    }
  };

  // A selection from the account's prefs may name a theme installed on another host, or deleted
  // since. Showing it keeps the gallery honest about what is selected.
  const dangling =
    activeTheme !== null && !themes.some((theme) => theme.id === activeTheme) ? activeTheme : null;

  return (
    <div className="py-3.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
          {S.settings.themeTitle}
        </p>
        {pinnedMode !== null && (
          <span className="rounded-full border border-gray-200 px-1.5 py-0.5 text-[10px] text-gray-500 dark:border-gray-700 dark:text-gray-400">
            {S.settings.themePinsMode(
              pinnedMode === "dark" ? S.settings.themeDark : S.settings.themeLight,
            )}
          </span>
        )}
      </div>
      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{S.settings.themeInfo}</p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SkinCard
          name={S.settings.themeNone}
          note={S.settings.themeNoneNote}
          selected={activeTheme === null}
          onSelect={() => setTheme(null)}
        />
        {dangling !== null && (
          <SkinCard
            name={dangling}
            note={S.settings.themeMissing}
            selected
            onSelect={() => setTheme(dangling)}
          />
        )}
        {themes.map((theme) => (
          <SkinCard
            key={theme.id}
            name={theme.name}
            note={
              theme.appearance === "auto"
                ? S.settings.themeFollowsMode
                : S.settings.themePinsMode(
                    theme.appearance === "dark" ? S.settings.themeDark : S.settings.themeLight,
                  )
            }
            selected={activeTheme === theme.id}
            onSelect={() => setTheme(theme.id)}
            preview={<ThemePreview theme={theme} />}
            {...(theme.source === "user"
              ? { onDelete: () => void handleDelete(theme.id), deleteDisabled: deleting !== null }
              : {})}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * A card. The select action is a `button` and the delete is its *sibling*, not its child: a
 * button inside a button is invalid HTML, and the alternative — a `div` with a click handler —
 * gives up the keyboard and screen-reader behaviour the select action needs.
 */
function SkinCard({
  name,
  note,
  selected,
  onSelect,
  preview,
  onDelete,
  deleteDisabled = false,
}: {
  name: string;
  note?: string;
  selected: boolean;
  onSelect: () => void;
  preview?: ReactNode;
  onDelete?: () => void;
  deleteDisabled?: boolean;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-lg border transition ${
        selected
          ? "border-gray-900 dark:border-gray-100"
          : "border-gray-200 hover:border-gray-400 dark:border-gray-700 dark:hover:border-gray-500"
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className="block w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400"
      >
        <span className="block h-16 w-full overflow-hidden">{preview ?? <NoPreview />}</span>
        <span className="flex items-center gap-1 px-2 py-1.5">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium text-gray-900 dark:text-gray-100">
              {name}
            </span>
            {note !== undefined && (
              <span className="block truncate text-[10px] text-gray-500 dark:text-gray-400">
                {note}
              </span>
            )}
          </span>
          {selected && (
            <CheckIcon size={12} className="shrink-0 text-gray-900 dark:text-gray-100" />
          )}
        </span>
      </button>
      {onDelete !== undefined && (
        <button
          type="button"
          onClick={onDelete}
          disabled={deleteDisabled}
          aria-label={`${S.settings.themeDelete} ${name}`}
          title={`${S.settings.themeDelete} ${name}`}
          className="absolute right-1 top-1 rounded-md bg-gray-900/60 p-0.5 text-white transition hover:bg-gray-900/80 disabled:opacity-40 dark:bg-black/60 dark:hover:bg-black/80"
        >
          <CloseIcon size={12} />
        </button>
      )}
    </div>
  );
}

/**
 * The preview: the theme's own artwork when it has one, framed the way the wallpaper layer will
 * frame it so the card and the result agree. Otherwise a swatch built from the declared palette,
 * which is what a palette-only theme has to show.
 */
function ThemePreview({ theme }: { theme: ThemeDescriptor }) {
  const background = theme.background;
  if (background !== null) {
    return (
      <img
        src={background.url}
        alt=""
        loading="lazy"
        className="h-full w-full object-cover"
        style={{
          objectPosition: `${String(background.focusX * 100)}% ${String(background.focusY * 100)}%`,
        }}
      />
    );
  }
  const { colors } = theme;
  return (
    <span
      className="flex h-full w-full items-center justify-center"
      style={{ backgroundColor: colors.background }}
    >
      <span
        className="flex h-2/3 w-3/4 flex-col justify-center gap-1 rounded-sm px-2"
        style={{ backgroundColor: colors.panel }}
      >
        <span className="block h-1 w-2/3 rounded-full" style={{ backgroundColor: colors.text }} />
        <span className="block h-1 w-1/3 rounded-full" style={{ backgroundColor: colors.accent }} />
      </span>
    </span>
  );
}

/**
 * The app's own appearance has no palette of its own — it *is* the app's palette, and the only
 * honest way to draw it would be to hard-code one mode's values into this file. A muted blank
 * says "nothing overridden" without claiming a preview it cannot render.
 */
function NoPreview() {
  return (
    <span className="flex h-full w-full items-center justify-center bg-gray-100 dark:bg-gray-800">
      <span className="h-px w-6 bg-gray-300 dark:bg-gray-600" />
    </span>
  );
}
