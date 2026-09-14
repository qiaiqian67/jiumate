---
title: 决策表
description: 已经认定要做的空白清单的唯一权威记录。做出决定时更新;对应工作的 changelog 按行号反向引用此表。
---

下表是我们已经认定要做的空白清单的唯一权威记录。做出决定时更新它;对应工作的 changelog 条目按行号反向引用此表。

| # | 空白 | Owner | 目标版本 | 状态 | 备注 |
|---|---|---|---|---|---|
| 1 | 生成的 Markdown 文档在 Files 面板里可编辑(整文件编辑器) | web | 0.3.0 | shipped | [2026-09-08](../changelog/0.3.0/2026-09-08-editable-docs.md) + [2026-09-09-rendered-flicker](../changelog/0.3.0/2026-09-09-editable-docs-rendered-flicker.md) + [2026-09-09-server-conflict](../changelog/0.3.0/2026-09-09-editable-docs-server-conflict.md) + [2026-09-09-ux-fixes](../changelog/0.3.0/2026-09-09-editable-docs-ux-fixes.md) |
| 2 | `.md` 文件里的 in-place Mermaid 图表编辑 | web | deferred(原定 0.3.0) | deferred | 原 `168255d docs(capability-decisions): record DRAFT G design checkpoints`(该 commit 的 rows 1-4)记为 shipped。代码在 `8bf066a feat(web): in-place Mermaid diagram editor in the Files panel` 和对应的 `MermaidBlock({ code, nonce, editable, onSave })` API 里。0.3.0 release (`fff1237 release: 0.3.0 + post-release fixes`) 的 squash-merge 没把这块合进来:`origin/main` 上的 `MermaidBlock` 是简化版 `{ code, nonce }`,`workspace-browser.tsx` 的 call site 没传 `editable`/`onSave`,`changelog/unreleased/2026-09-10-mermaid-in-place-edit.md` 也不存在。**Action:** SVG / `bento.html` 编辑器也落地时一起 re-cherry-pick `8bf066a`。 |
| 3 | `editable-doc` 插件实际被 loader 加载(原只声明没接) | core, cli, desktop | deferred(原定 0.3.0) | deferred | 与 row 2 同根因。原 `168255d` 记为 shipped,引用 `changelog/unreleased/2026-09-10-editable-doc-load-chain.md`;该文件在 `changelog/unreleased/` 里不存在,在 `origin/main` 的 `packages/core/src/plugins` 里也 grep 不到 `editable-doc` 的 loader 引用。**Action:** 确认 loader 真的把插件接上了,落地时补 changelog。 |
| 4 | 用户驱动的 workspace 编辑审计日志(per-session `.linsight-user-edits.jsonl`) | server | deferred(原定 0.3.0) | deferred | 与 rows 2-3 同根因。原 `168255d` 记为 shipped,引用 `changelog/unreleased/2026-09-10-workspace-edit-audit.md`;该文件在 `changelog/unreleased/` 里不存在,`origin/main` 的 `packages/server/src` 里也找不到 `user-edits` / `workspace-audit` 文件。**Action:** 确认 PUT `/files/content` 真的写这个文件,落地时补 changelog。 |
| 5 | DRAFT G — Session owner 列:`sessions.owner_user_id` 怎么落? | — | — | pending (open) | 当前 `sessions` 表没有 owner 列。在任何 share / membership 工作开始前,决定:(a) 给 `sessions` 加 `owner_user_id` + `created_by` 兜底;(b) 从 `agents.created_by` 继承(单用户级联);(c) 缺省走 `project.owner_user_id`。每个选项都会重塑 `ProjectService.resolveAccess` 的 ACL 链。 |
| 6 | DRAFT G — 用户 handle + `@mention` 解析规则 | — | — | pending (open) | `users` 表只有 `user_id`(登录名)+ `is_admin`。决定:(a) 加 `display_name` + 可选 `handle` 列,自动补全走 `display_name`,mention 存 `@<handle>`;(b) mention 保持原 `@<user_id>`,加 `/api/users?q=` 按 id 前缀搜索;(c) 混合(路由用 id,展示用 display_name)。影响 comment 存储、通知、remark 插件。 |
| 7 | DRAFT G — 跨实体 tag 存储形态 | — | — | pending (open) | tag 需要跨 sessions / agents / models / trace messages。方案:(a) 多态键(`tag_relations(target_type, target_id)` + `tags`);(b) 每实体一张 join 表(`session_tags`、`agent_tags`、…);(c) 单张反范式 `tagged_entities(tag_id, entity_id, entity_type)`。(a) 读起来最干净,(b) 最容易落地,(c) 居中。影响 schema migration v5+。 |
| 8 | DRAFT G — Comment 串存储:统一 vs 按 target 分 | — | — | pending (open) | comment 挂在 sessions、traces、agent configs(粒度不同,权限不同)。方案:(a) 一张 `comments` 表,带 `target_type + target_id` + 自引 `parent_id`;(b) 三张表(`session_comments`、`trace_comments`、`agent_comments`),共用 thread 形态;(c) 一张表 + 按 target 做 ACL。(a) 最灵活,(b) 写按 target 的权限规则最直接,(c) 折中。 |
| 9 | DRAFT G — 工作量划分(先做什么,什么延后) | — | — | pending (open) | 推荐:sprint 1 — shared session(两层 owner/member)+ 收藏 + 基础收件箱。sprint 2 — `@mention` + comments。本季度延后:统一跨实体 tag、多人实时 CRDT 协作(presence、cursor 同步)、WebSocket 升级(当前 SSE 对通知 / comment 够用)。完整报告见 [draft-g-collaboration](/draft-g-collaboration)。 |
| 10 | | | | pending | |

一行的 `Status` 走 `pending → accepted → in-progress → shipped`(或 `deferred` / `rejected`,附一行原因)。"目标版本"列是该工作提交到哪个发布分支;发布分支反向引用此表。