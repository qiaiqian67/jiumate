# 测试 Agent API（AMSP）

Agent API 让你在 Web 界面之外调用 Agent：一个程序拿着 `jiumate_` 开头的密钥，创建会话、发消息、看回复。

本文档是从零开始的手动测试步骤。前半段不需要装任何东西，后半段需要先跑起服务。

---

## 第一段：只测代码（不用起服务）

### 1. 跑 AMSP 的测试

```bash
cd packages/server
npx vitest run test/amsp-concurrency.test.ts
```

应该看到 7 个测试全过：

```
✓ test/amsp-concurrency.test.ts (7 tests) 3ms
Test Files  1 passed (1)
     Tests  7 passed (7)
```

### 2. 类型检查

```bash
cd packages/server
npx tsc --noEmit -p tsconfig.json
```

没有输出就是通过。

### 3. 看这次会话我改了什么

```bash
node scripts/session-changes.mjs --minutes 600
```

会列出工作区改动、每个文件的修改时间，以及真实差异（是内容变了、只变了 BOM、还是根本没变）。

---

## 第二段：起服务实测

### 4. 准备一个干净的测试环境

别用你日常的数据目录，先建一个单独的：

```bash
# Windows PowerShell
$env:JIUMATE_HOME = "$HOME\.jiumate\amsp-test"
```

### 5. 起后端

开一个终端：

```bash
pnpm --filter @prismshadow/jiumate-server dev
```

它会打印监听端口（默认 7368）。

### 6. 起前端

**另开一个终端**：

```bash
pnpm dev:web
```

### 7. 在界面里开一个 Agent 的 API

浏览器打开后端打印的地址，按顺序：

1. 建一个 Project
2. 在里面建一个 Agent
3. 打开这个 Agent 的 **API** 标签页
4. 把开关打开（`enabled`）
5. 点"创建密钥"，给它起个名字

**密钥只显示这一次**，关掉就再也看不到了。立刻复制下来，形如：

```
jiumate_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 8. 拿到 Project 和 Agent 的 id

界面上看不到 id 的话，从浏览器开发者工具的网络请求里看 URL，路径里就有：

```
/api/projects/prj_xxxxx/agents/agt_xxxxx/api
```

### 9. 拿密钥发第一个请求

**PowerShell：**

```powershell
$h = @{ Authorization = "Bearer jiumate_你的密钥" }
Invoke-RestMethod -Uri "http://127.0.0.1:7368/api/projects/你的projectId/agents/你的agentId/api" -Headers $h
```

**macOS / Linux：**

```bash
curl -H "Authorization: Bearer jiumate_你的密钥" \
  "http://127.0.0.1:7368/api/projects/你的projectId/agents/你的agentId/api"
```

这个请求只是**读设置**，用来确认密钥是通的。期望拿到 `{"api":{"enabled":true,...},"serverEnabled":true}`。

---

## 怎么判断结果对不对

下面这张表是这一步的核心——每种情况该看到什么状态码、为什么是这样。

| 你做的事 | 期望结果 | 为什么 |
|---|---|---|
| 带着正确的密钥读设置 | `200` + 你的设置 | 密钥有效 |
| 密钥里改一个字符 | `401` `unauthorized` | 摘要对不上 |
| **不带密钥**，`open` 关着 | `404` `not_found` | 和"Agent 不存在"一样，故意的 |
| **不带密钥**，`open` 开着 | 通过 | 这就是 `open` 的作用：免密钥访问 |
| 正常调，然后把 Agent 开关关掉 | 立刻 `404` | 每次请求实时读设置，不用轮换密钥 |
| 管理员把整个 API 关了 | `503` `api_disabled` | 不是 404，否则你会去查一个没问题的 Agent 名 |
| 跑满并发上限后再来一个 | `429` + `Retry-After` | 唯一预期会自己解除的拒绝 |

**最容易搞混的是第 3 行和第 6 行。**

- `404` = "这个 Agent 没开 API，或者不存在" —— 两种情况故意返回一样的答案
- `503` = "整个服务器的 API 被管理员关了"，所有 Agent 都不可达

这个区分是有意的：如果全局关闭也返回 404，你会以为是自己某个 Agent 名字写错了，去反复检查一个根本没问题的名字。

### 关于 404 那个设计

可能看起来奇怪：为什么"没开"和"不存在"要返回一样的 404？

因为如果不一样，这个接口就变成了**探测器**：用不同状态码就能枚举出服务器上有哪些 Agent。返回一样的答案，这个问题就不存在了。

### 关于密钥放在 URL 里

带密钥请求时可以直接放：

```
?key=jiumate_你的密钥
```

这**只对 GET 有效**。POST 不接受这种方式，因为 URL 里的密钥会被记进服务器日志、代理日志和 Referer 头。

---

## 第三段：自动化测试

### 跑全部测试

```bash
pnpm test
```

会跑所有包。

### 只跑 server 的

```bash
pnpm --filter @prismshadow/jiumate-server test
```

---

## 常见问题

**Q：端口 7368 被占用？**

dev 用 7368，`jiumate` 命令用 7369。换个端口：

```bash
$env:PORT = 7370
```

**Q：`no_default_model` 错误？**

创建会话前，得先在 Project 的 Models 页面加一个模型并设为默认。Agent API 建会话时没有模型可用就是这个错。

**Q：运行时报 `workspace` 相关错误？**

设置里的工作区如果填了，必须是**已存在**的目录，不会自动创建。

**Q：密钥删掉了还能用吗？**

不能。删了之后下一次请求就 `401`。这是设计如此——想停用某个密钥，删掉比换掉更干净。

**Q：怎么知道某个密钥还在被用？**

API 标签页的密钥列表里有"最后使用时间"。每个通过密钥进来的请求都会更新它。

---

## 当前状态

**已完成的：**

- 密钥认证（`src/amsp/authenticate.ts`）—— 摘要查表，四种拒绝状态码各自区分
- 并发闸门（`src/amsp/concurrency.ts`）—— 按 Agent 计数，实时读上限

**还没完成的：**

- HTTP 路由 —— 认证还没接到任何端点上
- 运行 Agent —— 网关现在只有门，没有进到 Agent 的路
- 流式响应 —— 外部调用方还没法订阅回复

也就是说：**界面上的开关和密钥现在还是转不起来**，本文档第二段的第 9 步只验证密钥能被读到，**还不能通过 API 真正调用 Agent**。等路由接上之后，这里会补上实际发消息的步骤。