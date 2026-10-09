/**
 * Shared chrome for the plugin / skill / connector surfaces: the origin filter tabs, the search
 * box, the on-off toggle, the origin badge and the sources manager (features/plugins/
 * extension-ui.tsx).
 *
 * **Why one file.** These five pieces appear on three pages. Built three times they would drift —
 * and drift here is visible: the same toggle meaning different things on the plugins and skills
 * tabs, or the connector tab filtering on a different set, is exactly the kind of inconsistency
 * a user reads as "which of these is right?". One implementation, three call sites.
 *
 * **The filter tabs keep their order and their count.** Origin is a partition — an item is in
 * exactly one bucket — so the tabs read as a segmented control rather than a set of overlapping
 * toggles, and the active one is the single filled pill. Tabs that would always be empty are the
 * caller's business (it passes `filtersFor`), not something to paper over here.
 */
import { useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { Input } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import { toastError, toastInfo } from "../../components/ui/toast";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import type { Category, ExtensionFilter, ExtensionOrigin } from "./extension-model";
import { categoryIdFor } from "./extension-state";

/* ── origin ────────────────────────────────────────────────────────────────── */

const FILTER_LABEL: Record<ExtensionFilter, string> = {
  all: S.plugins.filterAll,
  builtin: S.plugins.filterBuiltin,
  user: S.plugins.filterUser,
  bundled: S.plugins.filterBundled,
};

const ORIGIN_LABEL: Record<ExtensionOrigin, string> = {
  builtin: S.plugins.originBuiltin,
  user: S.plugins.originUser,
  bundled: S.plugins.originBundled,
};

/**
 * Origin badge — the small chip that says where an item came from.
 *
 * Tinted by origin, and that tint is the point: built-in and user-installed are different kinds
 * of thing (one you cannot remove, one you can), and a reader should not have to look up a word
 * to tell them apart. Bundled is amber because it is the genuinely ambiguous one — it belongs to
 * a plugin, so the reader has to know whose it is.
 */
export function OriginBadge({ origin }: { origin: ExtensionOrigin }) {
  const tone =
    origin === "builtin"
      ? "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
      : origin === "bundled"
        ? "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
        : "bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300";
  return (
    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] leading-none ${tone}`}>
      {ORIGIN_LABEL[origin]}
    </span>
  );
}

/* ── filters + search ───────────────────────────────────────────────────────── */

/** The origin tabs, plus their live counts so a tab is never a dead end. */
export function OriginFilterTabs({
  value,
  onChange,
  filters,
  counts,
}: {
  value: ExtensionFilter;
  onChange: (next: ExtensionFilter) => void;
  filters: readonly ExtensionFilter[];
  /** Per-origin totals, unfiltered — a count that shifted with the search would be unreadable. */
  counts: Record<ExtensionFilter, number>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1" role="tablist">
      {filters.map((f) => {
        const active = f === value;
        const n = counts[f] ?? 0;
        return (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(f)}
            className={`flex h-7 items-center gap-1 rounded-full px-2.5 text-xs transition-colors duration-150 ${
              active
                ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
                : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
            }`}
          >
            {FILTER_LABEL[f]}
            <span className={active ? "opacity-70" : "text-gray-400 dark:text-gray-500"}>{n}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Search box for a surface.
 *
 * Magnifier glyph with the query as its accessible name (there is no visible label — the row of
 * tabs is the visible structure), and the raw `value`/`onChange` so the caller owns debouncing.
 */
export function ExtensionSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative min-w-48 flex-1">
      <GlyphIcon
        d="M21 21l-4.35-4.35M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0z"
        size={15}
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"
      />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="pl-8"
      />
    </div>
  );
}

/* ── toggle ─────────────────────────────────────────────────────────────────── */

const SWITCH_ON = "M5 12l4.5 4.5L19 7";
const SWITCH_OFF = "M6 6l12 12M18 6L6 18";

/**
 * The on/off control.
 *
 * A **toggle**, not a button with a label, because the state is the message: what a reader needs
 * to know at a glance is whether the item is live, and a button labelled 「禁用」 on an enabled item
 * still has to be read against the item's current state. The state is carried by the glyph, the
 * `aria-pressed`, and the colour — three redundant channels, because it is the one control whose
 * meaning must survive being shown with no label at all.
 *
 * `disabled` is for an item whose state cannot be changed at all (a built-in), not for one that
 * happens to be off.
 */
export function ExtensionSwitch({
  on,
  onToggle,
  disabled = false,
  label,
  busy = false,
}: {
  on: boolean;
  onToggle: () => void;
  disabled?: boolean;
  /** Names the item in the tooltip, e.g. 「启用 git-flow」. */
  label: string;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      // Both directions need a tooltip: the same glyph means different actions depending on state,
      // and an icon-only control cannot leave that to be guessed.
      title={`${label} — ${on ? S.plugins.disable : S.plugins.enable}`}
      aria-label={`${label} — ${on ? S.plugins.disable : S.plugins.enable}`}
      aria-pressed={on}
      disabled={disabled || busy}
      onClick={onToggle}
      className={`flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 transition-colors duration-150 ${
        on ? "bg-gray-900 dark:bg-gray-100" : "bg-gray-200 dark:bg-gray-700"
      } ${disabled || busy ? "cursor-not-allowed opacity-50" : ""}`}
    >
      <span
        className={`flex h-5 w-5 items-center justify-center rounded-full bg-white shadow transition-transform duration-150 dark:bg-gray-900 ${
          on ? "translate-x-4" : "translate-x-0"
        }`}
      >
        <GlyphIcon
          d={on ? SWITCH_ON : SWITCH_OFF}
          size={12}
          // Both marks are drawn at the house weight (GlyphIcon fixes 1.7), so the "off" cross is
          // rotated rather than drawn bolder — a 12px check and a 12px cross at the same weight
          // read as the same kind of mark, which is what the control needs.
          className={on ? "text-gray-700 dark:text-gray-200" : "text-gray-500 dark:text-gray-400"}
        />
      </span>
    </button>
  );
}

/* ── categories ─────────────────────────────────────────────────────────────── */

/**
 * Category management dialog: rename, delete, create.
 *
 * **Deletion explains the consequence rather than just refusing.** The question a user actually
 * has is "what happens to the things under it", and the answer is "they move to 未分类, nothing
 * is deleted" — which is why the confirm text carries the count instead of the dialog just
 * saying no. Built-in categories are refused outright, with the reason on the disabled button,
 * because plugins ship carrying them.
 *
 * Filings live with the caller (it owns the items), so `onDelete` hands back the orphaned item
 * ids and the caller decides what to do with them.
 */
export function CategoryManagerDialog({
  open,
  onClose,
  categories,
  /** Item id -> category id, for counting what a deletion would unfile. */
  filings,
  onRename,
  onCreate,
  onDelete,
}: {
  open: boolean;
  onClose: () => void;
  categories: readonly Category[];
  filings: Readonly<Record<string, string | null>>;
  onRename: (id: string, name: string) => void;
  onCreate: (name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const create = () => {
    const name = draft.trim();
    if (name === "") return;
    onCreate(name);
    setDraft("");
  };

  const commitRename = (id: string) => {
    const name = nameDraft.trim();
    // An empty rename is a no-op, not a category with a blank label: silently filing things under
    // an invisible category is worse than ignoring the keystroke.
    if (name !== "") onRename(id, name);
    setEditing(null);
  };

  const target = categories.find((c) => c.id === pendingDelete);
  const orphans = useMemo(
    () => Object.values(filings).filter((c) => c === pendingDelete).length,
    [filings, pendingDelete],
  );

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={S.plugins.manageCategories}
        widthClass="sm:max-w-md"
        footer={
          <div className="flex justify-end">
            <Button variant="ghost" onClick={onClose}>
              {S.common.close}
            </Button>
          </div>
        }
      >
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {categories.map((c) => (
            <li key={c.id} className="flex items-center gap-2 py-2">
              {editing === c.id ? (
                <>
                  <Input
                    value={nameDraft}
                    autoFocus
                    onChange={(e) => setNameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename(c.id);
                      if (e.key === "Escape") setEditing(null);
                    }}
                    className="h-7"
                  />
                  <Button size="sm" variant="primary" onClick={() => commitRename(c.id)}>
                    {S.common.save}
                  </Button>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate text-sm text-gray-800 dark:text-gray-100">
                    {c.name}
                  </span>
                  {c.builtin && (
                    <span className="shrink-0 text-[11px] text-gray-400">
                      {S.plugins.originBuiltin}
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditing(c.id);
                      setNameDraft(c.name);
                    }}
                  >
                    {S.plugins.categoryRename}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={c.builtin}
                    title={c.builtin ? S.plugins.categoryBuiltinLocked : S.plugins.categoryDelete}
                    onClick={() => setPendingDelete(c.id)}
                  >
                    {S.plugins.categoryDelete}
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>

        <div className="mt-3 flex items-center gap-2 border-t border-gray-100 pt-3 dark:border-gray-800">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
            }}
            placeholder={S.plugins.categoryNamePlaceholder}
            aria-label={S.plugins.addCategory}
            className="h-8"
          />
          <Button variant="secondary" onClick={create} disabled={draft.trim() === ""}>
            {S.plugins.addCategory}
          </Button>
        </div>
      </Modal>

      <Modal
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title={S.plugins.categoryDelete}
        headerless
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              {S.common.cancel}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (pendingDelete !== null) {
                  onDelete(pendingDelete);
                  toastInfo(S.plugins.categoryDeleted);
                }
                setPendingDelete(null);
              }}
            >
              {S.plugins.categoryDelete}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-gray-700 dark:text-gray-200">
          {S.plugins.categoryDeleteConfirm(orphans)}
        </p>
        {target && <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{target.name}</p>}
      </Modal>
    </>
  );
}

/** Categorises an item, normalising an absent category to the uncategorised bucket. */
export function categoryOf(itemCategory: string | null | undefined): string | null {
  return itemCategory ?? null;
}

/** Toast helper kept local so callers do not import three modules to report a category change. */
export function reportCategoryError(e: unknown): void {
  toastError(apiErrorText(e));
}

/** Builds a new category from a name, reusing the same id derivation as the storage layer. */
export function newCategory(name: string): Category {
  return { id: categoryIdFor(name), name: name.trim() };
}
