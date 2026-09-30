/**
 * 灵感卡片条 —— 新会话页输入框下方。
 *
 * 和「我的快捷指令」药丸行是同一层意思：把本来藏在选择器里的东西挪到一眼能看到的地方。
 * 数据链路完全复用现有实现（内置 catalog + 服务端合并，见 inspiration-store.ts），
 * 这里只换展示：从选择器里的文字列表，变成一排横向滚动的封面卡片。
 *
 * 点击的行为和 picker 里的行完全一致 —— 填入输入框、不发送。理由写在 draft-view.tsx 的
 * fillCase 上：用户要读一遍落进去的东西，可能改，然后自己按发送。
 *
 * 三条布局上的决定：
 *
 * 没有标题。分类选项卡自己说明了这一块是什么，标题只是重复一遍，还占一行高度。
 *
 * 「换一批」和选项卡同一行、靠右、且不跟着横向滚动。选项卡在窄屏上要能滑，所以那一行是
 * 两段：可滑的选项卡 + 固定在右边的「换一批」。如果让「换一批」跟着一起滑，滑到右边就
 * 点不到了。
 *
 * 卡片宽度固定，靠滚动条看更多，不压缩。压缩单卡宽度（flex 挤压或百分比宽度）会让封面图
 * 变窄、标题换行，同一批卡片在窗口变窄时整排变形；固定宽度 + 滚动是稳定的一行，窗口变了
 * 只是能看到几张变了。滚动条是可见的——藏起来的话用户不知道右边还有卡片。
 */
import { useMemo, useState } from "react";
import { S } from "../../lib/strings";
import { useLocale } from "../../state/locale";
import { coverUrl, localizedCase } from "./inspiration-service";
import { useInspirationCatalog } from "./inspiration-store";

/**
 * 一次渲染多少张卡。多渲染一些（而不是刚好一屏），这样滚动条才有意义——刚好一屏时
 * 滚动条永远拖不动，「还有更多」这件事也就传达不出去。
 */
const RENDER_LIMIT = 24;
/** 「全部」选项卡的取值。null 而不是空串，分类 id 不会是空串。 */
const ALL_TABS = null;

export function InspirationStrip({
  onFill,
}: {
  /** 填入输入框并合入技能选择；不发送。 */
  onFill: (prompt: string, skills: readonly string[]) => void;
}) {
  const { locale } = useLocale();
  const { catalog } = useInspirationCatalog();
  // 换一批的起点。取模回绕，所以不会翻到空的一轮。
  const [offset, setOffset] = useState(0);
  // 当前分类（null = 全部）。切分类时 offset 归零——否则从一个分类的第 2 屏切过去，
  // 会落到另一个分类的中间，看起来像随机跳了一组。
  const [category, setCategory] = useState<string | null>(ALL_TABS);

  const scoped = useMemo(
    () =>
      category === ALL_TABS
        ? catalog.cases
        : catalog.cases.filter((one) => one.categoryId === category),
    [catalog.cases, category],
  );

  const shown = useMemo(() => {
    const all = scoped;
    if (all.length === 0) return [];
    const start = ((offset % all.length) + all.length) % all.length;
    // 从 offset 起连取 RENDER_LIMIT 张，取模回绕：总数少于上限时循环补齐，滚动条
    // 依然能一路看回去；超过上限时先给这一段，滚到底「换一批」再翻下一段。
    return Array.from(
      { length: Math.min(RENDER_LIMIT, all.length) },
      (_, i) => all[(start + i) % all.length],
    );
  }, [scoped, offset]);

  if (catalog.cases.length === 0) return null;

  // 一个分类都不剩（库里只有分类、分类下没有案例）时，不给选项卡行：一个点了就空白的
  // 选项卡比没有选项卡更糟。
  const hasTabs = catalog.categories.length > 0;

  return (
    <section className="mt-4">
      {/* 选项卡行：左侧可横向滑（窄屏上分类多了会溢出），右侧的「换一批」固定不动 ——
          让它跟着一起滑的话，滑到右边就点不到了。 */}
      <div className="mb-2 flex items-center gap-2">
        {hasTabs && (
          <div className="no-scrollbar -mx-1 flex min-w-0 flex-1 gap-1.5 overflow-x-auto px-1">
            {[
              {
                id: ALL_TABS,
                name: S.inspiration.allCategories,
                nameZh: S.inspiration.allCategories,
              },
              ...catalog.categories.map((c) => ({
                id: c.id as string | null,
                name: c.name,
                nameZh: c.nameZh,
              })),
            ].map((tab) => (
              <button
                key={tab.id ?? "all"}
                type="button"
                onClick={() => {
                  setCategory(tab.id);
                  setOffset(0);
                }}
                className={`shrink-0 rounded-full px-2.5 py-1 text-xs transition-colors duration-150 ${
                  category === tab.id
                    ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
                    : "bg-gray-100/70 text-gray-600 hover:bg-gray-200/70 dark:bg-gray-800/60 dark:text-gray-300 dark:hover:bg-gray-700/60"
                }`}
              >
                {locale === "zh" && tab.nameZh ? tab.nameZh : tab.name}
              </button>
            ))}
          </div>
        )}
        {/* 没有分类时，左边没有可滑的选项卡，这一行只剩「换一批」靠右。 */}
        {!hasTabs && <div className="min-w-0 flex-1" />}
        <button
          type="button"
          onClick={() => setOffset((o) => o + RENDER_LIMIT)}
          className="flex shrink-0 items-center gap-1 text-xs text-gray-500 transition-colors duration-150 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
        >
          {S.inspiration.shuffle}
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
            <path d="M21 4v6h-6" />
          </svg>
        </button>
      </div>

      {/* 固定宽度 + 可见滚动条：不压缩单卡（压缩会让封面变窄、标题换行，整排在窗口变窄
          时变形），窗口变了只是能看到几张变了。滚动条故意不隐藏——藏起来用户就不知道右边
          还有卡片。 */}
      <div className="flex gap-2.5 overflow-x-auto pb-2">
        {shown.map((one, i) => {
          if (one === undefined) return null;
          const copy = localizedCase(locale, one);
          const img = coverUrl(one);
          return (
            <button
              // 同一分类被循环补齐时可能有重复，同一个 id 会渲染两次；下标进 key
              // 才能稳定，否则 React 会复用错节点。
              key={`${one.id}-${i}`}
              type="button"
              title={`${copy.description}\n${S.inspiration.fillHint}`}
              onClick={() => onFill(copy.prompt, one.skills)}
              className="group w-44 shrink-0 text-left"
            >
              <span className="relative block aspect-[3/2] w-full overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800">
                {img !== null ? (
                  <img
                    src={img}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                  />
                ) : (
                  // 字形封面：本来就没有图片，画一个居中的字形，而不是留一块灰底让人
                  // 以为图还没加载出来。
                  <span className="flex h-full w-full items-center justify-center text-3xl leading-none">
                    {one.cover.kind === "glyph" ? one.cover.glyph : "🖼️"}
                  </span>
                )}
              </span>
              <span className="mt-1.5 block truncate text-xs text-gray-600 dark:text-gray-400">
                {copy.title}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
