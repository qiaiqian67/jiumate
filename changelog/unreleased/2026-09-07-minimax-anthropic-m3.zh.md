# MiniMax M3 新增 Anthropic 协议预设条目

- **Date:** 2026-09-07
- **Type:** feature
- **Scope:** `core`, `web`, `server`, `docs`

[English](2026-09-07-minimax-anthropic-m3.md)

MiniMax M3 同一模型提供两种协议入口。原预设条目走厂商 Responses API，地址 `https://api.minimax.io/v1`；本次新增第二条走厂商 Anthropic 协议端点 `https://api.minimax.cn/anthropic/v1/messages`。Web 模型页因此并排列出两条 `MiniMax-M3`：一条 Responses、一条 Anthropic Messages，按 MiniMax 发布的统一牌价计费（标准档 512K 输入以内，cache read 0.06 / input 0.30 / output 1.20 USD 每百万 Token）。两条都读取同一 `MINIMAX_API_KEY`，选用哪一条只是协议选择，与计费无关。

新条目固定使用新 client 类型 `minimax-ant-messages`，以便环境变量回退解析到 `MINIMAX_*`（凭据属于 MiniMax 而非 Anthropic）。`resolveModelEnv` 新增一个精确匹配分支，置于通用 `ant-messages` 子串匹配之前；缺此分支，新条目会静默套用 `ANTHROPIC_*`，破坏目录不变量 `provider.envKey === resolveModelEnv(model_id, client_type).envKey`。

## 细节

- 新增目录条目：`provider = "minimax"`，`model_id = "MiniMax-M3-Anthropic"`，`client_type = "minimax-ant-messages"`，`base_url = "https://api.minimax.cn/anthropic"`，上下文窗口（1,000,000）与视觉支持与 Responses 条目相同，三档价格完全一致。
- `model-catalog.ts` 中新增模块级常量 `MINIMAX_ANT_BASE_URL` 与既有 `MINIMAX_BASE_URL` 并列，两个 base URL 都以命名常量管理。
- `minimax` provider 块保持单条 `envKey: "MINIMAX_API_KEY"` 与单条 `apiKeyUrl`；本分组现以同一计费暴露两种协议表面，注释中已注明。
- `resolveModelEnv("MiniMax-M3-Anthropic", "minimax-ant-messages")` 返回 `MINIMAX_API_KEY` / `MINIMAX_BASE_URL`。既有 `minimax-m3` 精确匹配分支未动；通用 `ant-messages` 分支仍对其它 client 类型返回 `ANTHROPIC_*`。
- `canonicalClientType` 与 `fastModeProtocol` 不需改动：前者原样透传 `minimax-ant-messages`；后者的 `t.includes("ant-messages")` 子串匹配已将其归入 Anthropic 协议（`fast_mode` 将发送 `speed: "fast"` 加 `fast-mode-2026-02-01` beta 请求头）。
- `protocol-path.ts` 不需改动：既有的 `if (t.includes("ant-messages")) return "/v1/messages";` 子串匹配已能命中 `minimax-ant-messages` 并返回正确路径。
- 新条目由 `presetModelEntries`、服务端 `GET /api/projects/:id/models` 的配对引用列表、`model-catalog.test.ts` 的目录不变量测试、`modelHomepageUrl` 自动接管——后两者均回退到共用的 `https://platform.minimax.io/docs/guides/models-intro` 链接。
- 文档更新：`models.en.md` / `models.zh.md` 内置 Provider 分组表新增一行；`unified-llm-api` 技能的 MiniMax M3 id 表新增一列；`plugins/agent-development/skills/linsight-sdk/SKILL.md` 的环境变量正则补上 `MINIMAX`（同时对齐 `ZAI` 与 `MOONSHOT`，与 `unified-llm-api/SKILL.md` 保持一致）。
- 未对 MiniMax 真实 Anthropic 协议端点做 e2e 测试——需要真实 API Key，超出本 PR 范围。Harness 层由 core / web / server 三套测试覆盖；真实 Key 冒烟测试留待后续。