# 应用中心卡片对齐插件库的卡片详情模式

- **Date:** 2026-09-10
- **Type:** feature
- **Scope:** `web`

[English](2026-09-10-app-center-card-detail.md)

应用中心卡片现在采用与插件库（`features/plugins/plugins-page.tsx`）一致的双段式形态：卡片主体是可点击的按钮，点击后打开只读的详情 Modal；卡片右侧是纸飞机图标按钮，触发与 Modal 底部"在草稿中打开"按钮相同的 `fillExample` / `fillShortcut` 链路。原先整个卡片就是一个跳转 `/chat/new` 的按钮，浏览时感觉像是被甩进聊天窗口而不是在查看一个示例。新形态让两种交互都能在一张卡片上完成，又不离开当前页面。

## 卡片布局

每张卡片是一个横向 flex 容器，包含两个子元素：左侧主体按钮（封面字符 + 标题 + 描述 + 元信息行 `分类：X · 预选 N 项技能`），点击打开详情 Modal；右侧固定大小的次级按钮承载纸飞机图标（`SEND_ICON`，现在从 `components/ui/icons.tsx` 导出，方便插件库与应用中心共用同一份 path）。图标按钮沿用之前整张卡片的 `skillsLoaded` gate：当前 Agent 还没加载完已安装技能时，快启仍然不可点，避免 example 的 skill pin 被静默丢弃。卡片本身的 disabled 状态取消——只有快启按钮受 gate，主体始终可以打开预览。

## 详情 Modal

Modal 渲染 `features/chat/example-detail.tsx` 里的 `ExampleDetailModal`，与 `PluginDetailModal` 的 chrome 保持一致：封面方块 + 标题 + 完整描述 + meta 行 + 预选技能 chips 区段 + 只读的提示词正文。Modal 底部有一个取消按钮和一个主按钮"在草稿中打开"，调用与图标按钮相同的 `fillExample` / `fillShortcut`，先看后决定的用户最终落到与一键填入完全相同的 composer 状态。快捷指令渲染时封面是 `⚡`、meta 行是固定的 `S.chat.appCenter.shortcutMeta`、预选技能区段下显示占位文案 `S.chat.appCenter.noSkillsHint`——快捷指令不预选任何技能。

## 文案

`S.chat.appCenter` 新增 `detailTitle`、`invoke`、`invokeHint`、`promptLabel`、`skillsLabel`、`noSkillsHint`、`metaLine(folderName, skillCount)` 与 `shortcutMeta`。页面级 `pageDesc` 与 `fillHint` 不变。所有新增字段在 `strings-en.ts` 同步镜像。

## 兼容性

无数据迁移、无 server 改动，纯前端。`fillExample` / `fillShortcut` 的内部逻辑（park + saveDraft + 跳转 `/chat/new`）保持不变，差异只在触发位置。卡片外壳从单个圆角按钮改为横向 flex 容器，外层 `grid grid-cols-1 sm:grid-cols-2` 的两列排版不变，无需调整间距。