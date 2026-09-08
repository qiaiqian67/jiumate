---
title: 空白分析与优先级建议
description: 我们识别出的能力空白(A–F),以及按 T-shirt 规模分级的优先级建议。最终承接在 capability-decisions 的决策表。
---

本页列出相对于"本地优先的多代理平台"应承担的工作负载,我们识别的能力空白,以及按 **T-shirt 规模**分级的优先级建议:

- **S** = 小时级
- **M** = 1–3 天
- **L** = 1–3 周
- **XL** = 1 个月+

已被认定要做的空白,转入 [capability-decisions](/capability-decisions) 的决策表作为权威记录。

## A. 用户体验(Web + Desktop)

| 缺口 | 影响 | 建议 |
|---|---|---|
| 没有虚拟列表 | 长会话/长 session 列表/长模型目录 DOM 无限增长 | 加 `@tanstack/react-virtual` 到消息、session、模型、benchmark case 列表 |
| 没有 PWA / 离线 | web app 不能装成 PWA,无离线缓存,没有安装提示 | `vite-plugin-pwa` + manifest + 选择性 workbox 缓存 |
| 没有语音输入 | chat composer 缺语音输入模态 | `MediaRecorder` + 通过 Skill 调 ASR(最便宜路径:复用 `use-claude-code` 的模式) |
| 没有 SKILL.md 编辑器 | 只能 ZIP 往返或 chat 安装提示改 skill | 在 Skills tab 加 Markdown 编辑器 + 实时 frontmatter 解析 |
| 没有独立 trace 浏览页 | 跨会话 trace 浏览只能导入 | 恢复老的 `/traces` 页(`trace-panel` 多数组件都还在) |
| 没有 A/B prompt testing | eval 只读 | eval 页:prompt diff + score delta 视图;底层就是两条 trace 对比 |
| 没有快捷键自定义 | 快捷键固定 | 可编辑 key bindings |

## B. 安全 / 多用户 / 合规

按 server 端严重程度排序:

1. **login 之外没有 rate limiting** —— 一个已认证 member 可以烧光 LLM 额度、CPU 或磁盘
2. **没有 audit log** —— vault 写入、model-key 改动、用户创建、平台推送、project 删除都不留痕
4. **没有 CORS 也没有全局安全头策略** —— 暂时安全只是因为没人加 `Access-Control-Allow-Origin`
4. **CSRF 完全靠 `SameSite=Lax` + Content-Type** —— 没有 token、没有 Origin 检查
5. **密钥明文存储**,`<root>/api-token` 等价 admin —— 整个安全边界就是 server 的 OS 账户
6. **没有 request id 也没有结构化日志** —— 事件无法从 `METHOD path status ms` 重建
7. **owner-supplied 的 model / MCP endpoint 的 SSRF** —— `isHttpUrl` 只是 scheme 检查,不是 allowlist;没有私网 IP / metadata 端点拦截
8. **单节点构造**(instance lock + in-process scheduler + in-memory channel)—— 没有水平扩展路径
9. **任何 config PUT 都没有乐观并发** —— 并发编辑者静默互相覆盖
10. **member 角色太宽** —— member 可以改 agent config、装 skill、读写项目里所有 session 的 workspace

| 缺口 | 建议 |
|---|---|
| 没有 SSO / OAuth | `/api/auth/sso/*` + provider registry(OIDC / SAML / Google / 飞书);vault 已经管 secret,scope 可以复用 |
| 没有 CODEOWNERS / Dependabot / gitleaks / SBOM | GitHub 配置文件,一天搞定 |

## C. SDK / 引擎

| 缺口 | 建议 |
|---|---|
| 没有 Plan-Execute 模式 | 加 Plan mode;plan 写进 trace,exec 复用 ReAct |
| 没有多层级子代理 | 加 depth 字段(`origin` 已经支持链) |
| 没有内置 web / git / grep 工具 | core 加 `web_fetch` / `git_*` / `grep` / `glob`;`use-firecrawl` 已经沉淀了通用契约 |
| 没有结构化输出 / `response_format` | 在 `GenerativeModelParameters` 加 `responseFormat`;AgentHub 多数 provider 已支持 |
| 没有 audio 协议 payload | 加 `AudioUrlPayload` / `InlineAudioPayload`,对齐 image 协议 |
| Trace 没有结构化查询层 | 物化一个 `TraceIndex`(SQLite)或对 JSONL 用 DuckDB |
| Trace 没有 size / count 轮转,没有压缩 | 加 zstd + 周轮转 |
| 没有 plugin marketplace 或签名 | 签名 manifest + 安装时 SHA-256 校验 |

## D. CLI

| 缺口 | 建议 |
|---|---|
| 没有 tab completion、没有历史文件 | `node:readline` completer API + `node:fs` 历史 |
| 没有 OAuth / SSO | 与 server 同步 |
| 没有 pipeline / DAG 编排 | `linsight pipeline`(任务 DAG) |

## E. 数据 / 部署 / 文档

| 缺口 | 建议 |
|---|---|
| 文档没有版本切换 | 0.x → 1.0 前必须有,否则老用户回不来 —— 记为 1.0 blocker |
| 文档没有 auto-gen API 页 | 基于 server 现成 OpenAPI 做 vite 插件;或迁移到文档生成器 |
| 没有 RSS、没有 per-post og:image、没有分析 | landing-site 的补充 |
| 没有 per-session 配额或烧钱告警 | server 端 scheduler + webhook / 邮件 / IM 投递 |

## F. 工程化(便宜又高杠杆)

1. `CODEOWNERS` —— 一个 package 一条
2. `dependabot.yml` —— 周级 pnpm 升级 PR
3. `gitleaks` action —— 在 git 历史和 PR 里拦截密钥
4. SBOM(`cyclonedx-bom` 进 release workflow)—— 企业审计
5. 视觉回归 —— Chromatic 或自建 screenshot diff

## 优先级建议

| 优先级 | 项目 | 规模 | 备注 |
|---|---|---|---|
| P0 | 工程化四件套(CODEOWNERS + Dependabot + gitleaks + SBOM) | S(合计 1 天) | 安全与合规基线 |
| P0 | Web 虚拟列表(`@tanstack/react-virtual`) | M | 用户体感最大短板 |
| P0 | Server 全局 rate limiting + 全局 audit log | M | 多用户部署前提;烧钱风险 |
| P1 | Docs 版本切换 + auto-gen API 页 | L | 1.0 前必须有 |
| P1 | Server CSRF token + Origin 检查 + 全局安全头 | S | 几个 middleware 即可 |
| P1 | Core:Plan mode + 多层 subagent + 通用 web/git/grep 工具 | XL | "chat → agent" 升级 |
| P1 | Server SSO / OAuth(provider registry) | L | 企业部署前提 |
| P2 | PWA / 离线模式 | M | 可安装性 |
| P2 | 插件 marketplace + 签名 | L | 生态开放 |
| P2 | SKILL.md 编辑器 / 语音输入 / 独立 trace 浏览页 | M | 体验打磨 |
| P2 | Server 乐观并发 + member 权限收窄 | M | 多编辑者 / 多用户 |
| P3 | Desktop 托盘 + 通知 + 崩溃报告 | M | 桌面 UX |
| P3 | CLI tab completion + history + OAuth | S | 几个 PR 即可 |
| P3 | Docs auto-gen API + RSS + per-post og:image | M | SEO + 社区触达 |