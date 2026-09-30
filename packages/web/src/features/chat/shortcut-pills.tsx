/**
 * 快捷指令 —— 输入框上方的药丸行。
 *
 * 数据和弹窗都由 useShortcuts（shortcuts-manager.tsx）提供，与选择器里的列表共用同一份
 * 服务端存储（ui_prefs.draftShortcuts）和同一套新建/编辑/删除弹窗：在这里改过，那边跟着变。
 *
 * 药丸点击的行为和文件夹里一样：**只填入输入框，不自动发送**。原因写在 user-shortcuts.ts：
 * 快捷指令是用户自己敲的字，不绑定任何技能，Agent 是点完之后才选的。
 *
 * 三个入口的位置各有理由：
 *
 * 齿轮在整行最右，且不跟着药丸横向滚动 —— 药丸多了要滑，齿轮跟着滑走就再也点不到了。
 * 点它进入管理态：每个药丸上长出编辑和删除。管理态下点药丸仍然是填入（不误触发编辑），
 * 改与删各自是独立的按钮。
 *
 * 加号在最后一个药丸后面：它是「加一条」，和「改已有几条」是两件事，所以位置分开。
 * 到达上限时消失而不是禁用——上限写在弹窗里，界面上留一个点了没反应的东西更糟。
 *
 * 收起/展开：点标题折叠整行。没有快捷指令时整行不渲染，它是补充入口，不该占输入框上方的位置。
 */
import { useState } from "react";
import { S } from "../../lib/strings";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { useShortcuts } from "./shortcuts-manager";

export function ShortcutPills({
  onFill,
  readComposerText,
}: {
  /** 填入输入框，不发送。 */
  onFill: (prompt: string) => void;
  /** 新建时正文取自输入框此刻的文字，所以读的是此刻而不是挂载时。 */
  readComposerText: () => string;
}) {
  const { shortcuts, loaded, canAdd, startCreate, startEdit, startDelete, dialogs } =
    useShortcuts(readComposerText);
  const [collapsed, setCollapsed] = useState(false);
  /** 管理态：药丸上是否长出编辑/删除。 */
  const [managing, setManaging] = useState(false);

  // 一条都没存的时候不占位置：这一行是补充入口，不是这一屏的主内容。
  if (!loaded || shortcuts.length === 0) return null;

  if (collapsed) {
    return (
      <>
        <div className="mb-1 flex items-center">
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="flex items-center gap-1 rounded-full bg-gray-100/70 px-2.5 py-1 text-xs text-gray-600 transition-colors duration-150 hover:bg-gray-200/70 dark:bg-gray-800/60 dark:text-gray-300 dark:hover:bg-gray-700/60"
          >
            <GlyphIcon d={SPARK_ICON} size={13} className="shrink-0" />
            {S.chat.shortcuts.pills}
            <GlyphIcon d={EXPAND_ICON} size={13} className="shrink-0 text-gray-400" />
          </button>
        </div>
        {dialogs}
      </>
    );
  }

  return (
    <>
      <div className="mb-1 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="flex shrink-0 items-center gap-1 text-xs text-gray-400 transition-colors duration-150 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
        >
          <GlyphIcon d={SPARK_ICON} size={13} className="shrink-0" />
          {S.chat.shortcuts.pills}
          <GlyphIcon d={COLLAPSE_ICON} size={12} className="shrink-0" />
        </button>

        {/* 药丸可横向滑；齿轮和加号不跟着滑（齿轮在整行最右，加号在最后一个药丸后面）。 */}
        <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
          {shortcuts.map((one) => (
            <span
              key={one.id}
              className="flex shrink-0 items-center rounded-full border border-gray-200 bg-white transition-colors duration-150 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800/60"
            >
              <button
                type="button"
                // 药丸上的 title 是完整的提示词：药丸本身只放标题，长提示词放不下也不该放。
                title={one.prompt}
                onClick={() => onFill(one.prompt)}
                className="flex max-w-40 items-center gap-1 py-1 pr-1.5 pl-2.5 text-xs text-gray-700 dark:text-gray-300"
              >
                <span className="min-w-0 truncate">{one.title}</span>
                {/* 管理态下药丸右侧换成动作按钮，那个角标就多余了。 */}
                {!managing && (
                  <GlyphIcon d={CHEVRON_ICON} size={12} className="shrink-0 text-gray-400" />
                )}
              </button>
              {managing && (
                <>
                  <button
                    type="button"
                    aria-label={`${S.common.edit} ${one.title}`}
                    title={S.common.edit}
                    onClick={() => startEdit(one)}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                  >
                    <GlyphIcon d={PENCIL_ICON} size={12} />
                  </button>
                  <button
                    type="button"
                    aria-label={`${S.common.delete} ${one.title}`}
                    title={S.common.delete}
                    onClick={() => startDelete(one)}
                    className="mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors duration-150 hover:bg-red-50 hover:text-red-600 dark:text-gray-500 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                  >
                    <GlyphIcon d={TRASH_ICON} size={12} />
                  </button>
                </>
              )}
            </span>
          ))}

          {/* 加号在最后一个药丸后面：加一条，和「改已有」是两件事。 */}
          {canAdd && (
            <button
              type="button"
              aria-label={S.chat.shortcuts.new}
              title={S.chat.shortcuts.new}
              onClick={startCreate}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-dashed border-gray-300 text-gray-400 transition-colors duration-150 hover:border-gray-400 hover:text-gray-700 dark:border-gray-600 dark:text-gray-500 dark:hover:border-gray-500 dark:hover:text-gray-200"
            >
              <GlyphIcon d={PLUS_ICON} size={12} />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setManaging((v) => !v)}
          aria-pressed={managing}
          aria-label={S.chat.shortcuts.manage}
          title={S.chat.shortcuts.manage}
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors duration-150 ${
            managing
              ? "bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-100"
              : "text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-300"
          }`}
        >
          <GlyphIcon d={GEAR_ICON} size={13} />
        </button>
      </div>
      {dialogs}
    </>
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
/** 齿轮：进入管理态。 */
const GEAR_ICON =
  "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.63.72 1.09 1.51 1.09H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z";
const PENCIL_ICON = "M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z";
const TRASH_ICON = "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6";
const PLUS_ICON = "M12 5v14M5 12h14";
