/**
 * The draft screen's inspiration picker: a few starters, one tab per category, and a way into the
 * full library.
 *
 * ## Why it is capped
 *
 * The draft page reserves no scroll area for this block — its height is the tab strip plus the open
 * tab's rows — so an unbounded library (which the library now is, since admins author cases) would
 * make the page jump as the user switches tabs, and a long category would push the composer off
 * screen. The cap is therefore what keeps the block a fixed shape: at most {@link PICKER_ROWS} case
 * rows per category, then a row that opens the gallery. The shortcuts folder, whose length is the
 * user's own, is bounded the same way and by its own cap (`user-shortcuts.ts`).
 *
 * ## What a click does
 *
 * Fills the composer through the handle `draft-view.tsx` owns, sending nothing. The case's skills
 * merge into the current selection through {@link buildInspirationFill} — only those the Agent has
 * installed, because a composer that is already open can see both lists, unlike the gallery, which
 * hands the composer the case's skills and lets it prune (see `inspiration-fill.ts`).
 *
 * ## Why the shortcuts folder is still here
 *
 * A saved shortcut is the user's own text and pins no Skills; it is not an inspiration case and is
 * not stored with them (`user-shortcuts.ts` says why). It keeps its place as the last tab, which is
 * also where the eye expects "mine" to be.
 */
import { useState } from "react";
import { S } from "../../lib/strings";
import { useLocale } from "../../state/locale";
import { useNavigate } from "react-router";
import { Tabs } from "../../components/ui/tabs";
import type { TabItem } from "../../components/ui/tabs";
import { exampleRowClass } from "../chat/example-folder-row";
import { SHORTCUTS_FOLDER_ID, ShortcutsFolder } from "../chat/shortcuts-folder";
import { localizedCase } from "./inspiration-service";
import { useInspirationCatalog } from "./inspiration-store";
import type { InspirationCase } from "@prismshadow/linsight-inspirations";
import type { Locale } from "../../state/locale";

/** Most case rows one category tab shows before the "browse all" row. */
export const PICKER_ROWS = 3;

/** Where the "browse the whole library" row goes. */
export const LIBRARY_PATH = "/app-center";

/**
 * One case row: its cover glyph at the left, then the localized title, with the description as the
 * row's tooltip. Single line and truncated — the block's height is the point, and the description is
 * one click away on the card.
 */
function CaseRow({
  one,
  locale,
  disabled,
  onFill,
}: {
  one: InspirationCase;
  locale: Locale;
  disabled: boolean;
  onFill: () => void;
}) {
  const copy = localizedCase(locale, one);
  return (
    <li>
      <button
        type="button"
        title={`${copy.description}\n${S.inspiration.fillHint}`}
        disabled={disabled}
        onClick={onFill}
        className={`flex w-full items-center gap-2 ${exampleRowClass}`}
      >
        <span
          aria-hidden
          className="flex h-5 w-5 shrink-0 items-center justify-center text-base leading-none"
        >
          {one.cover.kind === "glyph" ? one.cover.glyph : "🖼️"}
        </span>
        <span className="min-w-0 flex-1 truncate">{copy.title}</span>
      </button>
    </li>
  );
}

export function InspirationPicker({
  skillsReady,
  installedSkills,
  onFill,
  readComposerText,
  onFillShortcut,
}: {
  /**
   * Whether the selected Agent's installed skills are known yet. A case row waits for it: filling
   * before the list arrives would merge against an empty one and silently drop the case's pins.
   * The shortcuts folder does not wait — it pins nothing (see user-shortcuts.ts).
   */
  skillsReady: boolean;
  /** The selected Agent's installed skills, so a case's pins land only where they exist. */
  installedSkills: readonly string[];
  /** Fill the composer with a case: prompt + the skills to merge into the selection. */
  onFill: (prompt: string, skills: readonly string[]) => void;
  /** The composer's current text, read at click time by the shortcuts folder. */
  readComposerText: () => string;
  /** Fill from a saved shortcut: prompt only, no pins. */
  onFillShortcut: (prompt: string) => void;
}) {
  const { locale } = useLocale();
  const navigate = useNavigate();
  const { catalog } = useInspirationCatalog();

  // The first category, or the shortcuts folder when the catalog has none (a library whose only
  // categories were deleted server-side still renders this block).
  const [tab, setTab] = useState<string>(catalog.categories[0]?.id ?? SHORTCUTS_FOLDER_ID);

  const tabItems: TabItem<string>[] = [
    ...catalog.categories.map<TabItem<string>>((category) => ({
      key: category.id,
      label: locale === "zh" && category.nameZh ? category.nameZh : category.name,
    })),
    { key: SHORTCUTS_FOLDER_ID, label: S.chat.shortcuts.folder },
  ];

  const activeCategory = catalog.categories.find((category) => category.id === tab) ?? null;
  const activeCases =
    activeCategory === null
      ? []
      : catalog.cases.filter((one) => one.categoryId === activeCategory.id);
  const shown = activeCases.slice(0, PICKER_ROWS);

  return (
    <div>
      <Tabs items={tabItems} active={tab} onChange={setTab} />
      <div className="mt-2">
        {activeCategory !== null ? (
          <ul className="space-y-0.5">
            {shown.map((one) => (
              <CaseRow
                key={one.id}
                one={one}
                locale={locale}
                disabled={!skillsReady}
                onFill={() => onFill(localizedCase(locale, one).prompt, one.skills)}
              />
            ))}
            {/* The row that makes the cap honest: it says the list continues, and it is where the
                user was going anyway once three rows were not enough. */}
            <li>
              <button
                type="button"
                onClick={() => navigate(LIBRARY_PATH)}
                className={`flex w-full items-center gap-2 ${exampleRowClass}`}
              >
                <span aria-hidden className="flex h-5 w-5 shrink-0 items-center justify-center">
                  ⋯
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {S.inspiration.browseAll(
                    activeCases.length > PICKER_ROWS ? activeCases.length : undefined,
                  )}
                </span>
              </button>
            </li>
          </ul>
        ) : (
          <ShortcutsFolder
            open
            onOpen={() => undefined}
            readComposerText={readComposerText}
            onFill={onFillShortcut}
          />
        )}
      </div>
    </div>
  );
}
