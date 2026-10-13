/**
 * 卡片按钮的图标路径。
 *
 * **放在这里是为了让技能卡片和插件卡片用同一套图标。** 之前这几个路径各写一份、分散在
 * `plugins-page.tsx` 和 `session-row-menu.tsx` 里，于是两个卡片各自长出一套；两张卡片一旦画得
 * 不一样，眼睛读到的就是两个系统而不是一个页面的两个视图。
 *
 * **能复用的就复用，不另画。** 垃圾桶仍然用 `session-row-menu.tsx` 里那一个——为了「同款」而重新
 * 描一条看起来差不多的路径，恰好是这个模块要消灭的那类分歧：形状近似但不完全相同，在一个并排的
 * 图标行里是能看出来的。
 *
 * 都是 24×24 的线性路径（Feather 风格），与 `GlyphIcon` 的约定一致；尺寸由调用方通过
 * `ICON_SIZE.iconButton` 传入，不在这里定死。
 */
import { SEND_ICON } from "../../components/ui/icons";
import { TRASH_ICON } from "../../components/ui/session-row-menu";

export { SEND_ICON, TRASH_ICON };

/** 升级（rotate-cw，逆时针回转箭头）。 */
export const UPDATE_ICON = "M23 4v6h-6M20.49 15a9 9 0 1 1-2.12-9.36L23 10";

/** 管理安装（下载到托盘）。 */
export const INSTALL_ICON = "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3";
