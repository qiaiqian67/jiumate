/**
 * 快捷指令的读取、保存，以及新建/编辑/删除三个弹窗。
 *
 * 抽出来是因为同一份数据现在有两个界面在用：选择器里的列表（shortcuts-folder.tsx）和输入框
 * 上方的药丸行（shortcut-pills.tsx）。存储规则、长度上限、校验都在 user-shortcuts.ts 里，
 * 这里只管「读回来 / 写回去 / 弹窗开在哪个条目上」——两个界面共用一份，不各写一遍。
 *
 * 写的是同一份服务端数据（ui_prefs.draftShortcuts），所以在任一界面增删改，另一边跟着变。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { toastError } from "../../components/ui/toast";
import { Button } from "../../components/ui/button";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { Input, Textarea } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import {
  canAddShortcut,
  defaultShortcutTitle,
  normalizeShortcuts,
  removeShortcut,
  shortcutDraftError,
  upsertShortcut,
  SHORTCUT_PROMPT_MAX,
  SHORTCUT_TITLE_MAX,
  type ShortcutDraft,
  type UserShortcut,
} from "./user-shortcuts";

export interface ShortcutsController {
  shortcuts: UserShortcut[];
  /** 存储列表是否已到达。没到之前界面不该先显示空态。 */
  loaded: boolean;
  /** 是否还能再加一条（到上限时为 false）。 */
  canAdd: boolean;
  /** 打开新建弹窗，正文取自输入框此刻的文字。 */
  startCreate: () => void;
  /** 打开编辑弹窗。 */
  startEdit: (one: UserShortcut) => void;
  /** 打开删除确认。 */
  startDelete: (one: UserShortcut) => void;
  /** 那三个弹窗，调用方在任意位置渲染一次即可。 */
  dialogs: ReactNode;
}

export function useShortcuts(readComposerText: () => string): ShortcutsController {
  const [shortcuts, setShortcuts] = useState<UserShortcut[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState<ShortcutDraft | null>(null);
  const [deleting, setDeleting] = useState<UserShortcut | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .getPrefs()
      .then((res) => {
        if (!cancelled) setShortcuts(normalizeShortcuts(res.prefs.draftShortcuts));
      })
      .catch(() => undefined) // 读不到就当没存过，界面照常用
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** 回滚用的最新列表：陈旧的闭包会退回到两次编辑之前的列表。 */
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;
  const persist = useCallback((next: UserShortcut[]) => {
    const rollback = shortcutsRef.current;
    setShortcuts(next);
    api.putPrefs({ draftShortcuts: next }).catch((e: unknown) => {
      setShortcuts(rollback);
      toastError(apiErrorText(e));
    });
  }, []);

  const editing = draft !== null && draft.id !== null;
  const draftError = draft === null ? null : shortcutDraftError(draft);

  const saveDraft = () => {
    if (draft === null || draftError !== null) return;
    persist(upsertShortcut(shortcuts, draft));
    setDraft(null);
  };

  return {
    shortcuts,
    loaded,
    canAdd: canAddShortcut(shortcuts),
    // 高价值路径：输入框里已经打好的字就是新指令的正文，第一行拿来建议标题。
    startCreate: () => {
      const text = readComposerText().trim();
      setDraft({ id: null, title: defaultShortcutTitle(text), prompt: text });
    },
    startEdit: (one) => setDraft({ ...one }),
    startDelete: (one) => setDeleting(one),
    dialogs: (
      <>
        {/* 新建和编辑共用一个弹窗：字段和规则完全一样，只有标题说明是哪一个。 */}
        <Modal
          open={draft !== null}
          title={editing ? S.chat.shortcuts.editTitle : S.chat.shortcuts.createTitle}
          onClose={() => setDraft(null)}
          widthClass="sm:max-w-lg"
          footer={
            <>
              <Button onClick={() => setDraft(null)}>{S.common.cancel}</Button>
              <Button variant="primary" disabled={draftError !== null} onClick={saveDraft}>
                {S.common.save}
              </Button>
            </>
          }
        >
          {draft !== null && (
            <div className="space-y-3">
              <Input
                label={S.chat.shortcuts.titleLabel}
                hint={S.chat.shortcuts.titleHint(SHORTCUT_TITLE_MAX)}
                error={
                  draftError === "titleTooLong"
                    ? S.chat.shortcuts.titleTooLong(SHORTCUT_TITLE_MAX)
                    : undefined
                }
                value={draft.title}
                autoFocus
                maxLength={SHORTCUT_TITLE_MAX}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                onKeyDown={(e) => {
                  // isComposing guard（仓库的输入法约定）：确认中文候选会触发 Enter，
                  // 不挡住的话会把还没上屏的拼音存成标题。
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) saveDraft();
                }}
              />
              <Textarea
                label={S.chat.shortcuts.promptLabel}
                info={S.chat.shortcuts.promptInfo}
                infoLabel={S.common.moreInfoAbout(S.chat.shortcuts.promptLabel)}
                hint={S.chat.shortcuts.promptHint(SHORTCUT_PROMPT_MAX)}
                error={
                  draftError === "promptTooLong"
                    ? S.chat.shortcuts.promptTooLong(SHORTCUT_PROMPT_MAX)
                    : undefined
                }
                value={draft.prompt}
                rows={8}
                size="sm"
                maxLength={SHORTCUT_PROMPT_MAX}
                onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
              />
            </div>
          )}
        </Modal>

        <ConfirmModal
          open={deleting !== null}
          title={S.chat.shortcuts.deleteTitle}
          confirmLabel={S.common.delete}
          onClose={() => setDeleting(null)}
          onConfirm={() => {
            if (deleting !== null) persist(removeShortcut(shortcuts, deleting.id));
            setDeleting(null);
          }}
        >
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {deleting !== null ? S.chat.shortcuts.deleteConfirm(deleting.title) : ""}
          </p>
        </ConfirmModal>
      </>
    ),
  };
}
