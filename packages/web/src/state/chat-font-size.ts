/**
 * 阅读字号的全局状态 hook：所有需要读/写字号的地方（目前只有系统设置 → 个人 → 通用）
 * 走这一个源。
 *
 * ## 为什么需要它，而不是在设置页里直接用 loadChatFontSize
 *
 * 因为设置页**不是**常驻的。字号是通过写 `:root` 上的 CSS 变量生效的，而
 * `.md-body` 在主对话流、子智能体流、Workspace 预览里都有——它们都在聊天页那棵树之外
 * （设置页挂在完全不同的路由分支上）。如果只有设置页在挂载时应用一次，那么：
 *
 * - 打开设置切到「大」→ 关掉设置 → 字号生效（写进了 :root）
 * - 但**新开一个标签页**、或者从别的入口进聊天页时，:root 上没有这个变量，正文退回
 *   CSS 兜底的 16px，而 localStorage 里明明存着「大」。
 *
 * styles.css 的 :root 兜底只能保证"不会错得离谱"，不能保证"记住用户的选择"。所以
 * 应用的根必须有一个常驻的订阅者，在挂载时把存好的档位重新写回 :root——这正是这个
 * hook 的职责，和 `useLocale` / `useTheme` 处理语言、主题的方式完全一致。
 *
 * 它不放在 lib/ 里：lib 是纯逻辑（不碰 React），这个 hook 碰，所以住在 state/ 下，
 * 与 locale.tsx / theme.tsx 同列。
 */
import { useCallback, useEffect, useState } from "react";
import {
  applyChatFontSize,
  loadChatFontSize,
  storeChatFontSize,
  type ChatFontSize,
} from "../lib/chat-font-size";

export interface ChatFontSizeState {
  /** The current size. */
  value: ChatFontSize;
  /** Persist and apply it immediately. */
  set: (size: ChatFontSize) => void;
}

export function useChatFontSize(): ChatFontSizeState {
  const [value, setValue] = useState<ChatFontSize>(loadChatFontSize);

  /**
   * 每次档位变化都重新写 :root —— 包含首次挂载那一次。
   *
   * 首次挂载这次是必需的（见文件头）：它把存好的偏好从 localStorage 带回 :root。CSS 里
   * 的 :root 兜底只是让首屏不至于失控，并不代表"用户的选择"。
   *
   * 依赖里是 `value` 而不是"只跑一次"，因为设置页切档时也要立刻反映——否则要等下一次
   * 挂载才生效，用户会以为点击没生效。
   */
  useEffect(() => {
    applyChatFontSize(value, document.documentElement);
  }, [value]);

  // 应用存储：语言、主题、货币都是"每浏览器"而不是"每安装"（install-scope.ts 的分类），
  // 字号同理——它是阅读习惯，换一台机器重新选一次是合理的，不需要跟着安装走。
  const set = useCallback((size: ChatFontSize) => {
    setValue(size);
    storeChatFontSize(size);
  }, []);

  return { value, set };
}

/**
 * 常驻的字号作用域：挂在应用根（app.tsx），保证无论当前在哪个路由、设置页是否打开，
 * `:root` 上的 `--chat-font-size` 都被刷新为存好的档位。
 *
 * 它渲染 null——字号是纯 CSS 自定义属性，没有需要下发的 React 值，所以整个应用里唯一
 * 需要读取当前档位的地方就是设置页那一行 `Segmented`，直接用自己的 hook 读即可。这个
 * 组件的职责只有一件事：让偏好始终反映在文档上。
 *
 * 为什么需要它常驻：设置页不是常驻的，而正文（`.md-body`）在聊天页那棵树里。把应用放在
 * 设置页挂载时应用一次，意味着"改完设置、关掉设置、再从别的入口进聊天"时正文会退回 CSS
 * 兜底的 16px，尽管 localStorage 里明明存着「大」。
 */
export function ChatFontSizeScope() {
  // 调用 hook 就够了：它内部的 effect 会在挂载时以及每次切档时把档位写到 :root
  // （见 useChatFontSize）。这里不需要再加一个。
  useChatFontSize();
  return null;
}
