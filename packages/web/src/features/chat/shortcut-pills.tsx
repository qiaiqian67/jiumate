/**
 * 我的快捷指令 —— 输入框上方的药丸行。
 *
 * 数据链路和 `shortcuts-folder.tsx` 完全一致（`ui_prefs.draftShortcuts`，服务端按用户存），
 * 这里只换一种展示：文件夹是列表，药丸行是输入框上方的一排。两者写的是同一份数据，
 * 所以在文件夹里删掉一条，这一行的药丸也会跟着少——不额外维护第二份状态。
 *
 * 药丸的行为和文件夹里一样：**只填入输入框，不自动发送**。原因写在 user-shortcuts.ts：
 * 快捷指令是用户自己敲的字，不绑定任何技能，Agent 是点完之后才选的。
 *
 * 收起/展开：点右侧箭头折叠整行，折叠后只留一个标题按钮，省得在没有快捷指令的时候占着
 * 输入框上方的位置。没到货之前整行不渲染（`loaded`），避免空态闪一下再变成有内容。
 */
import { useCallback, useEffect, useState } from "react";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { normalizeShortcuts, type UserShortcut } from "./user-shortcuts";

export function ShortcutPills({ onFill }: { onFill: (prompt: string) => void }) {
  const [shortcuts, setShortcuts] = useState<UserShortcut[]>([]);
  /** 数据没到之前整行不出现：空态先闪一下再变成有内容，比晚 100ms 显示更难看。 */
  const [loaded, setLoaded] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api
      .getPrefs()
      .then((res) => {
        if (!cancelled) setShortcuts(normalizeShortcuts(res.prefs.draftShortcuts));
      })
      .catch(() => undefined) // 读不到就当没存过，这一行不显示即可，不该因此报错
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const fill = useCallback(
    (one: UserShortcut) => {
      onFill(one.prompt);
    },
    [onFill],
  );

  // 一条都没存的时候不占位置：药丸行是补充入口，不是这一屏的主内容。
  if (!loaded || shortcuts.length === 0) return null;

  if (collapsed) {
    return (
      <div className="mb-1 flex items-center">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="flex items-center gap-1 rounded-full bg-gray-100/70 px-2.5 py-1 text-xs text-gray-600 transition-colors duration-150 hover:bg-gray-200/70 dark:bg-gray-800/60 dark:text-gray-300 dark:hover:bg-gray-700/60"
        >
          <GlyphIcon d={SPARK_ICON} size={13} className="shrink-0" />
          {S.chat.shortcuts.folder}
          <GlyphIcon d={EXPAND_ICON} size={13} className="shrink-0 text-gray-400" />
        </button>
      </div>
    );
  }

  return (
    <div className="mb-1 flex items-center gap-1.5 overflow-x-auto pb-0.5">
      <span className="flex shrink-0 items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
        <GlyphIcon d={SPARK_ICON} size={13} className="shrink-0" />
        {S.chat.shortcuts.folder}
      </span>
      {shortcuts.map((one) => (
        <button
          key={one.id}
          type="button"
          // 药丸上的 title 是完整的提示词：药丸本身只放标题，长提示词放不下也不该放。
          title={one.prompt}
          onClick={() => fill(one)}
          className="flex max-w-48 shrink-0 items-center gap-1 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-700 transition-colors duration-150 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-300 dark:hover:bg-gray-700/60"
        >
          <span className="min-w-0 truncate">{one.title}</span>
          <GlyphIcon d={CHEVRON_ICON} size={12} className="shrink-0 text-gray-400" />
        </button>
      ))}
      <button
        type="button"
        onClick={() => setCollapsed(true)}
        aria-label={S.chat.shortcuts.collapse}
        title={S.chat.shortcuts.collapse}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-300"
      >
        <GlyphIcon d={COLLAPSE_ICON} size={13} />
      </button>
    </div>
  );
}

/** 一颗火星：这是「我攒的东西」，不是系统给的入口。 */
const SPARK_ICON = "M12 2.5 14 9l6.5 2-6.5 2-2 6.5-2-6.5L3.5 11 10 9z";
/** 药丸右侧的下拉角标，和参考图一致。 */
const CHEVRON_ICON = "m6 9 6 6 6-6";
/** 收起：向上收起整行。 */
const COLLAPSE_ICON = "m18 15-6-6-6 6";
/** 展开：展开整行。 */
const EXPAND_ICON = "m6 9 6 6 6-6";
