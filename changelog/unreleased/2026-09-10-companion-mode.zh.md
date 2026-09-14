# AI 伴侣模式 — 设置开关 + per-user 人设注入

- **Date:** 2026-09-10
- **Type:** feature
- **Scope:** `core`, `server`, `web`

[English](2026-09-10-companion-mode.md)

新增"AI 伴侣模式"开关，位于系统设置 → 通用。开启后，每次发送新消息都会在用户输入前注入一段 `[companion_persona]` 人设提示，让智能体用更温柔、更专注的语气回应。开关 per-user 存储（`ui_prefs.companionModeEnabled`），默认关闭。

## 设置开关

通用页面新增一行 `Switch`，位于币种与 Trace 导入之间（`packages/web/src/features/settings/companion-mode-row.tsx`）。组件挂载时通过 `GET /api/me/prefs` 加载，初次切换通过 `PUT /api/me/prefs` 持久化（shallow merge）；丢失的写入只影响持久化层，下次挂载会重新读到正确的值。`Switch` 在水合完成前保持 disabled，避免界面先闪一下错误值再变正确。新增 i18n 字符串 `S.settings.companionModeTitle` 与 `S.settings.companionModeInfo`，已在 `strings-en.ts` 同步。

## 标记

新增 `[companion_persona]` 标记（`packages/core/src/omnimessage/markers/origin-blocks.ts`），与其他前缀消息标记并列（`[use_skills]` / `[handoff_from]` / `[scheduled_task]` / `[model_switch_from]` / `[background_task_done]`）。默认人设文本作为 `DEFAULT_COMPANION_PERSONA_TEXT` 随引擎一起发布；`buildCompanionPersonaMessage(text?)` 接受覆盖文本，方便宿主自定义。`parseCompanionPersonaMessage` 是反函数，同样支持方形与遗留尖括号两种形式。tag 加入 `TITLE_NOISE_TAGS`，`stripLeadingMarkerBlocks` 会把它从 goal 模式目标里剥掉，`stripConversationMarkers` 也不会让它泄漏到生成的 Session 标题。`isWholeOriginBlock` 也对新增块返回 `true`。

## 服务端注入

`POST /api/sessions/:sessionId/tasks` 在 handler 顶部读取 `ui_prefs.companionModeEnabled`（`safeReadPrefs` 定义于 `http/routes/sessions.ts`，对损坏 JSON 的处理与 `me.ts` 一致：fall through 到 opt-out）。开启时，handler 在 goal 分支与普通分支两条路径上，都把 `userText(buildCompanionPersonaMessage(), "server")` 作为前缀插入 `messages`。普通分支中，前缀消息作为数组第一个元素传给 `attachFilesToInput`，由于 `appendAttachmentLines` 只修改最后一个 text 消息，人设块原封不动、用户文本照常携带文件标记，Web composer 看到的输入格式不变。goal 分支中，人设块保留在 `messages` 中（模型能看到），但在保存 `objective` 之前被 `stripLeadingMarkerBlocks` 剥掉，避免 goal 插件每轮重新注入。

## 兼容性

零数据迁移。`UiPrefs` 新增可选字段 `companionModeEnabled?: boolean`（`packages/server/src/api/types.ts`）；既有 `[key: string]: unknown` 索引签名早已支持此字段，新增字段仅是 IDE 类型层面的标注。默认关闭，老用户行为不变。切换开关对正在运行的 Session 没有影响——只有切换之后发起的 task 会读取新的 prefs。标记块不会出现在 Trace 标题或 goal 目标中，回看历史也不会被污染。
