/**
 * The admin's category manager: the library's tabs, and what they are called.
 *
 * ## Every category is editable, including the three the product ships
 *
 * There is no "official" category. The three that ship are **seed data** — the server writes them
 * into a fresh library once and they are ordinary files from then on — so an admin renames,
 * reorders and deletes them exactly like one they added. The one thing that holds a category in
 * place is the cases filed under it: the server refuses to delete one that still has any, and says
 * how many. This dialog does not pre-empt that check, because it would have to count the cases
 * itself to say the same thing; the server's message names the number and the fix.
 *
 * ## Two phases of one dialog
 *
 * The list, or a form for the one being added or renamed — the same "create and edit share one
 * dialog, only the title says which" idiom the shortcut editor uses, with the footer swapping to
 * cancel/save while the form is up. A nested Modal was the alternative and is worse: this app's Esc
 * layering would make Escape close the inner one while the user expects the whole thing to go.
 *
 * The rows and the form are built from the same pieces every other list and form in the app uses
 * (`Input`, `Button`, `ConfirmModal`), so nothing here is a control of its own invention.
 */
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { Input } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { useLocale } from "../../state/locale";
import { removeInspirationCategory, saveInspirationCategory } from "./inspiration-store";
import type { InspirationCatalogView } from "./inspiration-service";
import type { InspirationCategory } from "@prismshadow/jiumate-inspirations";

/** A category being edited: an id means an existing one, an empty id means a new one. */
interface CategoryDraft {
  id: string;
  name: string;
  nameZh: string;
  order: string;
}

function draftOf(one: InspirationCategory): CategoryDraft {
  return { id: one.id, name: one.name, nameZh: one.nameZh, order: String(one.order) };
}

/**
 * The slug a new category's id is derived from its name.
 *
 * Only a suggestion, and only until the admin touches the id themselves: the server owns the rule,
 * and the id is a file name, so an admin who wants `tools` for 内部工具 has to be able to say so. A
 * CJK-only name folds to nothing, which the id field then asks about — the form's own error says so.
 */
export function categoryIdFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/** Which rule a category draft breaks, as a dictionary key; null when it is saveable. */
export type CategoryDraftError = "nameRequired" | "idRequired";

export function categoryDraftError(draft: CategoryDraft): CategoryDraftError | null {
  if (draft.name.trim() === "" && draft.nameZh.trim() === "") return "nameRequired";
  if (draft.id.trim() === "") return "idRequired";
  return null;
}

export function CategoryManagerDialog({
  open,
  catalog,
  onClose,
}: {
  open: boolean;
  catalog: InspirationCatalogView;
  onClose: () => void;
}) {
  const { locale } = useLocale();
  const [draft, setDraft] = useState<CategoryDraft | null>(null);
  /**
   * The id being edited, or null while adding.
   *
   * A separate piece of state rather than "the draft has an id", because a *new* category's id is
   * derived from its name as the admin types — reading provenance off the id would flip an add into
   * an update the moment a name was entered, and the save would PUT a category that does not exist.
   */
  const [editingId, setEditingId] = useState<string | null>(null);
  /** On an add, whether the admin has typed an id themselves; until then it follows the name. */
  const [idTouched, setIdTouched] = useState(false);
  const [deleting, setDeleting] = useState<InspirationCategory | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setDraft(null);
      setEditingId(null);
      setIdTouched(false);
      setDeleting(null);
      setSaving(false);
    }
  }, [open]);

  const error = draft === null ? null : categoryDraftError(draft);
  const editing = editingId !== null;

  const startAdd = () => {
    setEditingId(null);
    setIdTouched(false);
    setDraft({ id: "", name: "", nameZh: "", order: String(catalog.categories.length * 10) });
  };

  const startEdit = (one: InspirationCategory) => {
    setEditingId(one.id);
    setIdTouched(true);
    setDraft(draftOf(one));
  };

  const cancelForm = () => {
    setDraft(null);
    setEditingId(null);
    setIdTouched(false);
  };

  const save = () => {
    if (draft === null || error !== null || saving) return;
    const body = {
      id: draft.id.trim(),
      name: draft.name,
      nameZh: draft.nameZh,
      order: Number.parseInt(draft.order.trim(), 10) || 0,
    };
    setSaving(true);
    void saveInspirationCategory(editingId, body)
      .then(() => {
        toastSuccess(S.inspiration.categorySaved);
        cancelForm();
      })
      .catch((err: unknown) => toastError(apiErrorText(err)))
      .finally(() => setSaving(false));
  };

  const remove = () => {
    if (deleting === null) return;
    void removeInspirationCategory(deleting.id)
      .then(() => {
        toastSuccess(S.inspiration.categoryDeleted);
        setDeleting(null);
      })
      .catch((err: unknown) => {
        toastError(apiErrorText(err));
        setDeleting(null);
      });
  };

  /** A category's display name in the active language, falling back to the other side. */
  const label = (one: InspirationCategory): string =>
    locale === "zh" && one.nameZh !== "" ? one.nameZh : one.name;

  return (
    <>
      <Modal
        open={open}
        title={
          draft === null
            ? S.inspiration.categoriesTitle
            : editing
              ? S.inspiration.editTitle
              : S.inspiration.categoryNew
        }
        onClose={draft === null ? onClose : cancelForm}
        widthClass="sm:max-w-lg"
        footer={
          draft === null ? (
            <>
              <Button onClick={onClose}>{S.common.close}</Button>
              <Button variant="primary" onClick={startAdd}>
                {S.inspiration.categoryNew}
              </Button>
            </>
          ) : (
            <>
              <Button onClick={cancelForm}>{S.common.cancel}</Button>
              <Button variant="primary" disabled={error !== null || saving} onClick={save}>
                {S.common.save}
              </Button>
            </>
          )
        }
      >
        {draft === null ? (
          <>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {S.inspiration.categoriesDesc}
            </p>
            {catalog.categories.length === 0 ? (
              <p className="mt-3 text-sm text-gray-400 dark:text-gray-500">
                {S.inspiration.categoriesEmpty}
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
                {catalog.categories.map((one) => (
                  <li key={one.id} className="flex items-center gap-2 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-gray-800 dark:text-gray-200">
                        {label(one)}
                      </span>
                      <span className="block truncate font-mono text-[11px] text-gray-400 dark:text-gray-500">
                        {one.id} · {one.order}
                      </span>
                    </span>
                    <Button size="sm" onClick={() => startEdit(one)}>
                      {S.common.edit}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setDeleting(one)}>
                      {S.common.delete}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <div className="space-y-3">
            <Input
              label={S.inspiration.categoryNameZh}
              required
              value={draft.nameZh}
              autoFocus
              maxLength={40}
              onChange={(event) => {
                const nameZh = event.target.value;
                setDraft((current) =>
                  current === null
                    ? current
                    : {
                        ...current,
                        nameZh,
                        // The id follows the name until the admin types one of their own; after that
                        // it is theirs, because it is a file name.
                        id: idTouched ? current.id : categoryIdFromName(nameZh),
                      },
                );
              }}
            />
            <Input
              label={S.inspiration.categoryNameEn}
              value={draft.name}
              maxLength={40}
              onChange={(event) =>
                setDraft((current) =>
                  current === null ? current : { ...current, name: event.target.value },
                )
              }
            />
            <Input
              label={S.inspiration.categoryId}
              hint={S.inspiration.categoryIdHint}
              value={draft.id}
              maxLength={64}
              disabled={editing}
              onChange={(event) => {
                setIdTouched(true);
                setDraft((current) =>
                  current === null ? current : { ...current, id: event.target.value },
                );
              }}
            />
            <Input
              label={S.inspiration.fieldOrder}
              hint={S.inspiration.fieldOrderHint}
              value={draft.order}
              onChange={(event) =>
                setDraft((current) =>
                  current === null ? current : { ...current, order: event.target.value },
                )
              }
            />
          </div>
        )}
      </Modal>

      <ConfirmModal
        open={deleting !== null}
        title={S.inspiration.categoryDeleteTitle}
        confirmLabel={S.common.delete}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {deleting !== null ? S.inspiration.categoryDeleteConfirm(label(deleting)) : ""}
        </p>
      </ConfirmModal>
    </>
  );
}
