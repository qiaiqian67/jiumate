---
title: 能力盘点
description: 平台每个 package 今天交付了什么、关键路径在哪里、还有哪些未实现的细节。配套的能力盘点方法在 capability-matrix。
---

本页是 JiuMate 当前能力的权威盘点。每一条都标注了对应的文件路径;如果路径错了或者文件已经变了,把对应声明视为错误 —— 盘点的可信度只取决于它引用的路径。

盘点覆盖:

- [packages/core](#packagescore) —— SDK 与执行引擎
- [packages/server](#packagesserver) —— HTTP API、SSE 流转、调度器、持久化
- [packages/web](#packagesweb) —— React 19 SPA
- [packages/cli](#packagescli) —— `jiumate` 命令及其子命令
- [plugins/](#plugins) —— 已交付的 12 个插件包
- [packages/desktop](#packagesdesktop) —— Electron 外壳
- [公开站点 / 工程化](#站点与工程化) —— landing、docs、CI、签名、发布

## packages/core

| 维度 | 现状 | 关键路径 |
|---|---|---|
| Agent 循环 | 单流 ReAct,**并发执行 tool**,approval 串行;子代理最多一层(`MAX_SUBAGENT_DEPTH = 1`) | `engine/context-engine.ts` |
| 流式输出 | 唯一的输出模式;`partial_*` 实时增量,segment 结束补完整 `model_msg` | `llm/generative-model.ts` |
| LLM 抽象 | 通过 `@prismshadow/agenthub` 接入所有 provider;tool calling、vision、inline thinking、prompt caching、thinking level、fast mode 全部支持 | `interfaces/llm.ts:137` |
| 重试分类 | 只有 4 类是 fatal(凭证、4xx、fast mode 不支持、装配失败),其余一律 retryable;默认 `maxReconnects = 5`、`maxTurnAttempts = 20` | `context-engine.ts:427` |
| 工具集 | 9 个内置(读/写/编辑/shell/input-shell/2× subagent/2× image);**没有内置 web fetch / git / grep** | `environment/tools/registry.ts:37` |
| OmniMessage 协议 | 7 类 payload + 9 类 event;方括号 marker 形式(`[tag]…[/tag]`)是权威写法,角括号形式无限期兼容 | `omnimessage/types.ts`、`markers/` |
| Trace | 追加式 JSONL,单次 `write(2)` + `O_APPEND`;记录 `request_begin/end`、`token_usage`、`subagent`、`approval_decision`、`compaction_begin/end`、`hook`、`mcp_connect_begin/end`;**没有结构化查询、远程、压缩、按大小/数量轮转** | `trace/writer.ts:207` |
| 沙箱 | `command_policy` 拦截 `rm -rf`、`mkfs` 等小段正则;**没有 OS 级沙箱**;绝对路径允许;跟随 symlink | `internal/command-policy.ts` |
| 插件 | npm 包,`plugin.json` + `skills/<name>/SKILL.md` + `hooks/*.mjs`(纯 Node 子进程,stdin/stdout JSON);**没有 marketplace、没有签名、没有热装** | `plugins/index.ts` |
| 公开 API | 7 个子路径入口 + 主 barrel,导出 `Agent`、`Session`、`ContextEngine`、占位符、`GenerativeModel`、`Environment`、`Writer`、hooks、marker 解析器 | `index.ts` |
| i18n | core 没有运行时 i18n;`error_message` 故意保持英文,Web 按 `error_code` 翻译 | — |

## packages/server

Hono 4 + `node:sqlite` + `ws`,~50k LOC,121 测试文件 / 44k 行。

runtime shell(`createRuntimeApp`、`bootAppDeps`)与平台 surface(`buildAppDeps`、`createApp`,`app.ts:1120-1256`)分离。几乎所有业务路由都在平台里,可以通过 `POST /api/hmr/upgrade` 的签名 gzip 推送整体热替换;只有 `/api/auth`、`/api/desktop`、`/api/hmr` 与静态托管留在 runtime 层。

| 维度 | 现状 | 关键路径 |
|---|---|---|
| HTTP 路由 | ~200 个端点,挂载在 `app.ts:465-492`(runtime)与 `app.ts:1154-1256`(platform)。主要子树:`/api/projects/:p/...`、`/api/projects/:p/agents/:a/...`、`/api/sessions/:id/...`(40+ 子路由,最大文件 `sessions.ts` 1395 行)、`/api/sessions/:id/messaging/{feishu,telegram,qq,wechat}/...`、`/api/terminals/...`、`/preview/:token/*`。验证全部手写(`http/validate.ts`);**没有 OpenAPI schema、没有 API 版本、没有 `HEAD`/`OPTIONS` 处理** | `app.ts` |
| 认证模型 | 单租户单管理员,两角色 ACL(owner/member)+ admin。Cookie `jiumate_session`(HttpOnly、SameSite=Lax、30 天滑动续期);`<root>/api-token` 每次启动重 mint,Bearer = admin 等价 | `auth/service.ts`、`auth/api-token.ts` |
| 首次登录 claim | 生成 144 位随机密码后立刻哈希并丢弃明文;启动时打印首次登录链接(30 天有效);`/api/auth/claim` 严格按 token 校验 | `auth/service.ts:44,129` |
| 项目 | `project_id` = 目录名,不可改;只能改显示名;非 admin id 必须以 `<userId>-` 前缀;**没有软删除/归档/转让所有权** | `project-service.ts:158-175` |
| Agent | 完整文件系统配置在 `system_config.yaml` + `AGENTS.md`;member 可写两者;tar.gz 导入/导出,带显式 overwrite 标志 | `agent-service.ts:445` |
| 技能 / 插件 | ZIP 上传/下载;`assertSafeEntryPath` 阻挡 zip-slip;`MAX_ARCHIVE_BYTES = 14MB` + per-file 与 total 上限;**替换语义 + 显式 `overwrite` 标志**;member 可写;**没有签名、没有病毒扫描** | `skills.ts:46-56` |
| 模型 | `PUT /models` 是整表声明式替换;`/test`、`/detect`、`/list`、`/detect-vision` 实时探测;OAuth 通过 `/model-oauth/*`(PKCE 全在服务端);**没有 ETag / If-Match —— last write wins** | `models.ts:225-329` |
| LLM 路径 | **不代理**。server 直接 `createCoreSessionLoader` → `createAgent` 同进程运行;凭证存 `.project_config.toml`,per project(0600,plaintext),仅 owner 可写;`modelConfigChanged` 同时失效运行时缓存、向所有 channel 广播 `credentials_updated`、触发远端机器同步 | `runtime/session-manager.ts:224` |
| SSE / 实时 | `/api/sessions/:id/stream` 与 `/api/events`,共用 `Channel`;event id `<epoch>-<seq>`(每进程 8 字符 epoch);ring buffer 10k / 8MB;`Last-Event-ID` 命中回放、未命中单播 `resync_required`;`: ping` 每 20 秒;首事件总是权威 `task_state` + replay 所有未决 approval;任务返回 202 且与 SSE 解耦 —— 关 tab 不停任务 | `sse.ts`、`channel.ts` |
| 持久化 | `node:sqlite` `DatabaseSync`,WAL + FK + `busy_timeout=5000`;16 张表:`users`、`auth_sessions`、`projects`、`project_members`、`agents`、`sessions`、`usage_records`、`error_records`、`schedule_state`、`messaging_bindings`、`ui_prefs`、`server_settings`、`machine`、`machines`、`machine_project`、`trace_files`、`trace_sessions`;**只有 `error_records` 有 20k 行 + 周期修剪;`usage_records` 无限增长;大多数面向用户的表没有 FK** | `schema.ts`、`database.ts:49` |
| 迁移 | `PRAGMA user_version` 严格单调,DDL 冻结,每步 `BEGIN/COMMIT` + 回滚 + `swapSafe` 标志;非 swap-safe 迁移在热推路径抛 `RestartRequiredError` 而不是半应用;目前 4 条 | `db/migrations.ts` |
| Usage / 计费 | `token_usage` 事件 → 每个请求一行 `usage_records`;**cost 在查询时计算,从不存储**;支持 peak/off-peak;按 `date|agent|model|session` 分组,粒度 `minute|hour|day|week|month` 带 zero-fill 序列;子代理消耗通过 `origin_session_id` 归属到主会话;**没有 invoicing、预算、配额、告警** | `services/usage-service.ts` |
| 调度器 | in-process,30 秒 tick;schedule 是声明式 TOML,系统永不写回;运行态在 `schedule_state`;**没有 backfill、queue-when-busy、mtime 门控扫描、没有 cron 表达式、没有失败重试/backoff**;`POST /:id/retry-now` 强制一次 | `runtime/scheduler.ts` |
| 后台循环 | Channel sweep、30 分钟 idle 运行时清理(`unref`)、TTL 缓存的 `UpdateCheckService`、后台 `UpdateJob`(通过 `GET /api/version/update` 可读进度)、机器 SSH lanes / tunnels、消息长连接、启动 `adoptUnmanagedTraceSessions` | — |
| Vault / 密钥 | `<agent>/.vault.toml` 0600;key 名走 shell env 规则,value ≤ 8192 字节(Linux `E2BIG`);**明文存储是设计如此;没有 KMS,没有轮换;模型只看 key 名** | `state/agent-vault.ts:107` |
| 文件上传 | 请求体上限**按 admin 附件预算每次派生** —— 测量式(chunked-safe),不靠读 header;默认 100MB/文件、120MB/请求、admin 范围 1–200MB;`INLINE_IMAGE_MAX_MB` 独立更小(base64 4/3 膨胀进 trace JSONL);zip-slip + `realpath` 双层防护 | `attachment-limits.ts`、`workspace-files-service.ts` |
| 同源 XSS | workspace 文件读强制 `nosniff` + `Cache-Control: no-store`;内联 HTML 降级 `text/plain`;`?preview=1` 给 `CSP: sandbox`(无 `allow-same-origin`);SVG 保留 `image/svg+xml`(让 `<img>` 渲染)同时给 `CSP: sandbox`(让直接导航失效);`?preview-redirect` 颁发签名 token 后 302 到独立 preview origin;preview hostname 只服务 `/preview/*`,`/api` 永远 401 且不读 cookie;preview token 与 host 绑定、有 TTL | `sessions.ts:1211-1257`、`preview.ts` |
| i18n | 服务端**英文 only**,设计如此。契约是 `error.code` 而不是 message;Web 按手维护的 `S.errors.byCode` 表翻译;**没有 `Accept-Language` 处理;server codes 与前端表之间没有编译期或测试期校验** —— 新增/重命名 code 会静默退化到原始英文 | `http/errors.ts:121-127` |
| 测试 | 121 vitest 文件 / 44k 行;`TEST_PASSWORD_HASH_COST = 2`(最低合法 scrypt)让套件保持快速;生产强度单独断言;E2E 在 `packages/web/e2e/`(31 个 Playwright spec + mock LLM);**没有 load/soak、fuzz、覆盖率阈值、server codes ↔ frontend 表的契约测试** | `test/helpers.ts` |
| 生产硬化 | 强项:per-request derived body limit、独立 preview origin、`JIUMATE_TRUST_PROXY=1` 显式 opt-in、默认 127.0.0.1 绑定、0600 + `O_EXCL|O_NOFOLLOW` 密钥文件、`timingSafeEqual` 用于 token 和密码、单实例 lock(pid 存活 + 端口监听双信号);**缺失:login 之外的 rate limiting、audit log、CORS、全局安全头、request id、结构化日志、SSRF 保护、乐观并发、member 权限收窄** | `app.ts`、`lock.ts`、`auth/middleware.ts` |

## packages/web

React 19 + Vite 7 + Tailwind 4。

| 维度 | 现状 | 关键路径 |
|---|---|---|
| 路由 | 9 条主路由 + 全屏 terminal;9-tab Agent 设置;**没有路由级 code splitting** | `router.tsx` |
| Chat UI | 完整:markdown + Shiki + KaTeX + xterm、文件/图片拖拽、9 个 tool 卡片、subagent 拓扑图、上下文甜甜圈、对话大纲、`/compact`、`/agent` 与 `/model` 切换 | `features/chat/*` |
| 虚拟列表 | **完全没有** —— 长会话 DOM 一直累积 | — |
| Agent 管理 | 9 个 tab(概览/系统提示/运行时/工具/MCP/技能/钩子/记忆/保险库/调度);占位符插入 chip | `features/agents/agent-settings-page.tsx` |
| SKILL.md 编辑器 | **没有** ——只能 ZIP 上传/下载或走 chat 安装提示 | `features/agents/skills-tab.tsx` |
| 模型管理 | 170 KB 的 `models-page.tsx`,按 vendor 分组,credential masked,OAuth 已支持;**没有 per-key 轮换 UI** | `features/models/models-page.tsx` |
| Trace 查看器 | 嵌入 chat 页 dock tab;CUDA 风格 swimlane timeline;**没有独立跨会话 trace 浏览页** | `features/traces/trace-panel.tsx` |
| Eval | 只读 scoreboard;**不支持 A/B prompt 对比、不能在 UI 改评分** | `features/benchmark/benchmark-page.tsx` |
| 设置 | 模态弹窗;语言(中/英/跟)、主题(亮/暗/跟)、字号、强调色、终端主题、币种;admin:用户管理、代理、上传、trace 导入 | `features/settings/*` |
| i18n | 中英双语,**类型系统强制对齐**(`placeholders-parity.test.ts`);硬编码 JSX 字面量不审计 | `lib/strings.ts`(2451 行)+ `strings-en.ts`(2497 行) |
| 状态管理 | zustand + 手写 fetch;**没有 React Query / SWR** —— 切走再回来重新拉取 | — |
| a11y | 完整键盘、ARIA、Esc-layer 栈、tone 系统;**模态没有显式 focus-trap**(只靠 Esc 关闭) | `components/ui/modal.tsx` |
| PWA | **没有** —— 无 service worker、manifest、`beforeinstallprompt`、离线 | — |
| 语音输入 | **没有** | — |
| 测试 | 118 单测 + 31 Playwright e2e;**没有视觉回归** | `test/`、`e2e/` |

## packages/cli

`@jiumate/cli`。

28 个子命令,涵盖 `auth`、`config`、`run`、`chat`、`ls`、`logs`、`input`、`agent`、`project`、`cost`、`schedule`、`server`、`web`、`update`、`version`。持久化 `node:readline` + bracketed-paste 处理 + `\` 续行;`/exit`、`/clear`、`/compact`、`/goal[:budget]`、`/thinking`、`/verbose`。**所有读命令支持 `--json` 用于脚本化;`--background` 与 `--timeout 0` 用于非阻塞用法。** 连接解析:显式 `--server` env > 活着的 `<root>/server.lock` > 自动 spawn 后台 server。401 自动重读 `<root>/api-token`。**没有 tab completion、没有历史文件、没有 OAuth/SSO。**

## plugins

12 个:

```
@jiumate/agent-development   4 skills   LLM/config/orchestration/SDK
@jiumate/agent-tuning        4 skills   init/benchmark/eval/optimize
@jiumate/continual-learning  1 hook     stop:提炼 30-turn 之后的发现成 skill
@jiumate/data-analysis       1 skill
@jiumate/goal                2 hooks    user_prompt + stop:`/goal` 后端
@jiumate/humanizer           1 skill    3-layer 去 AI 痕迹
@jiumate/model-development   3 skills   llamafactory / ollama / vllm
@jiumate/skill-porting       1 skill    从外部生态安装 skill
@jiumate/software-development 2 skills  SE 工作流 + 设计语言
@jiumate/use-bento-slides    1 skill    .bento.html 幻灯片
@jiumate/use-claude-code     1 skill    远程 SSH 跑 Claude Code
@jiumate/use-firecrawl       1 skill    搜索 / 抓取
```

没有任何插件**新增 tool** —— 全部靠 Skill(LLM 侧)与 Hook(子进程侧)扩展行为。**没有脚手架 / 生成器**(`pnpm create-plugin` 不存在)。

## packages/desktop

Electron 43。三平台打包(mac / win / linux)。macOS Developer ID + notarization;Windows 通过 EVSign 做 Authenticode,带 `verifyUpdateCodeSignature`。**Linux AppImage 不签名,没有 apt 渠道。** `electron-updater` 对接 GitHub Releases;首次检查 20 秒,之后每 6 小时。server 跑在 Electron `utilityProcess`;**没有 renderer IPC 桥**(窗口是纯浏览器,一切走 HTTP);**没有托盘图标、没有系统通知、没有崩溃报告。**

## 站点与工程化

- **Landing**(`packages/landing`)—— 11 个 section,双语;Playwright 用 mock LLM 拍 12 张产品截图。
- **Docs**(`packages/docs`)—— 24 个 slug × 2 语言 = 48 个文件;sidebar 4 段(start / guides / design / reference);Ctrl/Cmd+K 全文搜索、复制 Markdown 按钮;**没有版本切换、没有 auto-gen API 页、没有 RSS、没有 per-post og:image、没有分析。**
- 都部署到 GitHub Pages 的自定义 apex `jiumate.ooo`。

CI 多 shard 多平台(`ci.yml`),`desktop-build.yml` 处理签名,`release.yml` 处理发版,`pages.yml` 部署公开站点。**没有 CODEOWNERS、没有 Dependabot、没有 gitleaks、没有 SBOM。** Apache-2.0 LICENSE + 发布时复制到每个包;SECURITY.md、CONTRIBUTING.md、ISSUE 模板、Discord 链接。