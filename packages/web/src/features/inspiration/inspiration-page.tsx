/**
 * The inspiration library page (`/app-center`): every case in the library, filed into tabs.
 *
 * ## Why it looks like a gallery rather than a list
 *
 * A returning user is browsing for something to start, so the page shows the whole menu at once —
 * cards in a responsive grid, a cover to recognise each one by, a one-line description to choose
 * between them. The draft screen's picker (`features/chat/inspiration-picker.tsx`) is the same data
 * with the opposite bias: a few rows, no scrolling, because there the user has already decided to
 * start something.
 *
 * ## Tabs, and what each one means
 *
 * `All` is the catalog as the server ordered it; `Featured` is what an admin marked; the category
 * tabs are the library's own filing; `Favourites` is the viewer's. Only the last is per user — the
 * rest are the library's shape, which is why it is the one tab that can be empty for a reason the
 * user controls.
 *
 * ## The admin's surface
 *
 * `canManage` comes from the server, not from the user record the page holds: the write routes
 * re-check it, and a page that inferred it would show controls that fail. When it is true the page
 * gains "new case", "manage categories", and a per-card edit/delete — on admin cases only, since a
 * built-in is not the admin's to change.
 *
 * ## Filling from here
 *
 * Clicking a card's quick-start parks whatever draft is active, writes a new one carrying the case's
 * prompt, and opens the new-chat route — the same handoff the draft screen's picker performs, so a
 * case started from either surface lands in the same composer state. Nothing is sent from this page.
 */
import { useMemo, useState } from "react";
import { S } from "../../lib/strings";
import { useDocumentTitle } from "../../lib/use-document-title";
import { useLocale } from "../../state/locale";
import { useProject } from "../../state/project";
import { Button } from "../../components/ui/button";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { EmptyState } from "../../components/ui/empty-state";
import { InfoPopover } from "../../components/ui/info-popover";
import { Input } from "../../components/ui/input";
import { Tabs } from "../../components/ui/tabs";
import type { TabItem } from "../../components/ui/tabs";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { apiErrorText } from "../../lib/api-error";
import { InspirationCard } from "./inspiration-card";
import { InspirationDetailModal } from "./inspiration-detail";
import { CaseEditorDialog } from "./inspiration-editor";
import { CategoryManagerDialog } from "./inspiration-categories";
import { localizedCase, visibleCases } from "./inspiration-service";
import type { InspirationFilter } from "./inspiration-service";
import { toggleFavorite, useInspirationFavorites } from "./inspiration-favorites";
import { removeInspirationCase, useInspirationCatalog } from "./inspiration-store";
import { useInspirationInvoke } from "./inspiration-fill";
import type { InspirationCase } from "@prismshadow/linsight-inspirations";

/** The tab strip's own keys: the three fixed ones plus one per category, prefixed to stay unique. */
type TabKey = "all" | "featured" | "favorites" | `category:${string}`;

function filterOf(key: TabKey): InspirationFilter {
  if (key === "all") return { kind: "all" };
  if (key === "featured") return { kind: "featured" };
  if (key === "favorites") return { kind: "favorites" };
  return { kind: "category", categoryId: key.slice("category:".length) };
}

export function InspirationPage() {
  useDocumentTitle(S.inspiration.pageTitle);
  const { locale } = useLocale();
  const { agents } = useProject();
  const { catalog, status } = useInspirationCatalog();
  const favorites = useInspirationFavorites();
  const invoke = useInspirationInvoke();

  const [tab, setTab] = useState<TabKey>("all");
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<InspirationCase | null>(null);
  const [editing, setEditing] = useState<{ open: boolean; one: InspirationCase | null }>({
    open: false,
    one: null,
  });
  const [deleting, setDeleting] = useState<InspirationCase | null>(null);
  const [managingCategories, setManagingCategories] = useState(false);

  const shown = useMemo(
    () => visibleCases(catalog, filterOf(tab), query, favorites ?? []),
    [catalog, tab, query, favorites],
  );

  const tabItems: TabItem<TabKey>[] = useMemo(
    () => [
      { key: "all", label: S.inspiration.tabAll },
      { key: "featured", label: S.inspiration.tabFeatured },
      ...catalog.categories.map<TabItem<TabKey>>((category) => ({
        key: `category:${category.id}`,
        label: locale === "zh" && category.nameZh ? category.nameZh : category.name,
      })),
      { key: "favorites", label: S.inspiration.tabFavorites },
    ],
    [catalog.categories, locale],
  );

  // A fill needs an Agent to land on. The Project's agents are loaded by the layout, so this is
  // "no Agent exists yet" rather than "still loading" — and `useInspirationInvoke` is what actually
  // refuses, this only greys the button out.
  const noAgent = agents.length === 0;

  const confirmDelete = () => {
    if (deleting === null) return;
    const one = deleting;
    void removeInspirationCase(one.id)
      .then(() => {
        toastSuccess(S.inspiration.deleted);
        setDeleting(null);
      })
      .catch((err: unknown) => {
        toastError(apiErrorText(err));
        setDeleting(null);
      });
  };

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-5xl">
        {/* The page header follows the models page exactly: title with the description behind an
            info trigger beside it, then one wrapping row holding the search box and the admin's
            actions. The search box is the only flexible child and the buttons are `shrink-0`, so a
            narrow window wraps the group to its own line instead of squeezing a button down to a
            square with its label wrapped inside it. */}
        <div className="mb-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="flex items-center gap-1.5 text-xl font-semibold">
              {S.inspiration.pageTitle}
              <InfoPopover label={S.inspiration.pageTitle}>{S.inspiration.pageDesc}</InfoPopover>
            </h1>
            <div className="flex min-w-0 max-w-full grow items-center gap-2 sm:grow-0">
              <div className="min-w-0 flex-1 sm:w-56 sm:flex-none">
                <Input
                  size="sm"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={S.inspiration.searchPlaceholder}
                  aria-label={S.inspiration.searchLabel}
                />
              </div>
              {catalog.canManage && (
                <>
                  <Button
                    size="sm"
                    className="shrink-0"
                    onClick={() => setManagingCategories(true)}
                  >
                    {S.inspiration.manageCategories}
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    className="shrink-0"
                    onClick={() => setEditing({ open: true, one: null })}
                  >
                    {S.inspiration.newCase}
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Diagnostics are an admin's to act on and nobody else's business: an unreadable case
            directory is a server-side problem, and a member can do nothing about it. */}
        {catalog.canManage && catalog.diagnostics.length > 0 && (
          <ul className="mb-3 space-y-1 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
            {catalog.diagnostics.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}

        <Tabs items={tabItems} active={tab} onChange={setTab} />

        <div className="mt-4">
          {shown.length === 0 ? (
            <EmptyState
              title={
                tab === "favorites"
                  ? S.inspiration.favoritesEmpty
                  : query.trim() !== ""
                    ? S.inspiration.searchEmpty(query)
                    : S.inspiration.empty
              }
            />
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {shown.map((one) => (
                <li key={one.id}>
                  <InspirationCard
                    one={one}
                    locale={locale}
                    favorite={favorites?.includes(one.id) ?? false}
                    canManage={catalog.canManage}
                    disabled={noAgent}
                    onOpen={() => setDetail(one)}
                    onInvoke={() => invoke(one, localizedCase(locale, one).prompt)}
                    onToggleFavorite={() => toggleFavorite(one.id)}
                    onEdit={() => setEditing({ open: true, one })}
                    onDelete={() => setDeleting(one)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        {status === "failed" && (
          <p className="mt-4 text-center text-xs text-gray-400 dark:text-gray-500">
            {S.inspiration.offlineHint}
          </p>
        )}
      </div>

      {detail !== null && (
        <InspirationDetailModal
          one={detail}
          catalog={catalog}
          locale={locale}
          favorite={favorites?.includes(detail.id) ?? false}
          disabled={noAgent}
          onClose={() => setDetail(null)}
          onToggleFavorite={() => toggleFavorite(detail.id)}
          onInvoke={() => {
            const one = detail;
            setDetail(null);
            invoke(one, localizedCase(locale, one).prompt);
          }}
        />
      )}

      <CaseEditorDialog
        open={editing.open}
        one={editing.one}
        catalog={catalog}
        onClose={() => setEditing({ open: false, one: null })}
      />

      <CategoryManagerDialog
        open={managingCategories}
        catalog={catalog}
        onClose={() => setManagingCategories(false)}
      />

      <ConfirmModal
        open={deleting !== null}
        title={S.inspiration.deleteTitle}
        confirmLabel={S.common.delete}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {deleting !== null ? S.inspiration.deleteConfirm(deleting.title) : ""}
        </p>
      </ConfirmModal>
    </div>
  );
}
