# 应用中心页 + 新建对话的 tab 化

- **Date:** 2026-09-10
- **Type:** feature
- **Scope:** `web`

[English](2026-09-10-app-center-page.md)

新增 `/app-center` 页面,把整套应用示例按分类(搭建网页应用 / 搭建和优化智能体 / 创建定时任务 / 我的快捷指令)排成 tab 一次性铺开。每个示例渲染成一张卡片:56px 的 cover 占位缩略图、双行标题、双行描述。点击会先把当前草稿入库、再写入一份新的草稿缓存、最后跳到 `/chat/new` —— 与新建对话页里同一张卡片的点击行为完全一致,两处共用同一份示例清单。

新建对话页的示例区同步由书签式折叠文件夹换成 tab 切换条。每个内置文件夹下的任务在对应 tab 里渲染,cover 缩略图放在每一行的最左侧,老用户不必读标题也能认出示例。「我的快捷指令」tab 继续复用现有的 `ShortcutsFolder`;原有的 `openFolder` 单开状态被替换成 `activeTab`,行为上没有任何差异,只是切换的视觉入口变了。

## 侧栏入口

`应用中心` 现在是页面导航组(`应用中心 → 评估中心`)里的第一条,在 `NAV_GROUP_KEYS` 里固定,侧栏从 manifest 直接渲染,排在 Agents / Plugins / Models / Cost Center / Evaluation Center 前面。收起状态下的窄栏页面列表同样新增了 `/app-center`。路由挂在 `router.tsx`;页面在 `features/chat/app-center-page.tsx`。

## 点击流程

卡片点击:

1. `parkActiveDraft(userId, projectId)` —— 把已输入但未发送的文字入库为 parked draft(与 Skill 库 Quick Invoke 走的是同一条路径)。
2. `saveDraft(key, { ...loadDraft(key), agentId, text, skills, handoffAgentId: undefined })` —— 写入新的草稿缓存项;`loadDraft(key)` 的展开保留了 `modelRef`,所以用户之前选的模型不会被重置。
3. `setCurrentAgentId(agentId)` + `navigate(/chat/new, { state: { agentId } })` —— 在目标 Agent 的新对话页打开。用户在那里读、改、发送,本页不发送任何内容。

卡片 disabled 状态与新建对话页共用同一道 `skillsLoaded` 闸门:Agent 的已安装技能还没读到时点击会把示例要的 Skill pin 静默丢掉,所以保持不可点。

## 兼容性

无数据迁移、无服务端改动,纯 web 端。`EXAMPLE_FOLDERS` 的每个 task 增加 `cover?: string` 字段,既有条目都填了单字符 emoji 默认值;旧数据若没有 cover,会回退到 `S.chat.appCenter.coverFallback`。
