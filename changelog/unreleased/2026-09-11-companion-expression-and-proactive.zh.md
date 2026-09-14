# AI 伴侣 — 表情层、主动聊天触发骨架、伴侣专属设置页

- **Date:** 2026-09-11
- **Type:** feature
- **Scope:** `server`, `web`

[English](2026-09-11-companion-expression-and-proactive.md)

在昨天交付的四段位置选择器之上，本轮补齐三件让伴侣「活起来」的事：由 Agent 的 `SessionStatus` 驱动的多姿态状态机（L.1）、监听用户活动并判断伴侣何时可以开口的主动聊天触发骨架（L.2）、以及伴侣专属设置页（名字、称谓、主动间隔）（L.3）。三者合在一起是 airi「用户愿意打开它、愿意花时间陪它」目标的最小可用切片，设计上为后续 TTS / ASR / VRM 阶段预留接入点，不需要重接这一层。

## 宠物表情层

共享的 `<CompanionPet>`（`packages/web/src/features/chat/companion-pet.tsx`）现在驱动一个 7 姿态状态机——`idle / thinking / listening / speaking / celebrating / confused / sleepy`，输入是 `SessionStatus`。`poseFromTaskStateForTest` 把 `idle` 映射到 `idle`，其它状态（`running`、`compacting`）映射到 `thinking`；banner 在反应气泡出现时把姿态切到 `celebrating`，让可见的姿态切换对应到对话节奏。宠物 SVG 的几何由单一的 `POSE_GEOMETRY` 表承载——`tilt`、`eyeY`、`eyeShape`、`mouth`、`tailSpeed`、`ears`——加姿态只需加一行，不是改布局。

视觉行为：

- **眼追光标。** 宠物在 ±2 px 窗口内跟随鼠标（在 SVG 边界框内裁剪），手停在宠物右侧时看起来就像宠物在看过去。
- **随机眨眼。** 每 3-7 秒眨眼一次，与姿态无关；`prefers-reduced-motion` 媒体查询会关掉眨眼但不影响姿态切换。
- **点击反应。** 点击宠物（无论挂在 banner / widget / 悬浮窗哪一面）会把 `isWaving` 设 1.5 秒：双侧耳朵抖动 + 尾巴加速摇。`stopPropagation` 让点击不会同时触发 composer 或 dock。
- **闲置微动。** 缓慢的呼吸缩放 + 偶尔的耳尖抽动，让对话间隔里宠物不会显得卡死。

姿态 CSS 关键帧（`companion-tail-sway-fast`、`companion-breathe`、`companion-ear-wave`）写在 `packages/web/src/styles.css`，与上一轮的 `companion-tail-sway` 同区；每个都是 transform-only，可以与现有动画干净叠加。状态文案（`statusCopyForTest`）按姿态在 `strings.ts` 与 `strings-en.ts` 中各自收录，单元测试钉死两个语言下 7 个姿态全部返回非空且两两不同的字符串——以后的文案改动不能静默落到「我在陪你」兜底。

## 主动聊天触发骨架

`packages/web/src/features/chat/use-proactive-trigger.ts` 是 L.2 骨架：一个订阅 `document` 上的 `mousedown / keydown / touchstart / wheel` 的 hook，每 5 秒重新评估一次，把 `armed` 在每个静默区间内精确切到 `true` 一次。它**不**调用 LLM——那是后续阶段订阅 `armed` 翻转后该决定的事。切分理由：触发器是纯本地逻辑（无 I/O、无 API 面），因此行为可以被单元测试钉死，而不必 stub 任何东西；未来的「说什么」那一半可以独立替换，不影响触发器。

阈值语义，由 `isProactiveArmedForTest` 钉死：任何非正阈值（包含 `0`，即「关闭」滑块档，以及 `NaN`）都让 hook 永远不触发；只有空闲时长严格大于等于阈值才会让 `armed = true`。任何新一次活动事件立即 disarm，所以一次静默区间不会触发两次。

Hook 在 chat 页（`packages/web/src/features/chat/chat-page.tsx`）的 BroadcastChannel handler 之后挂载；挂载是无条件的——`threshold = 0` 只会让 hook 丢掉所有 listener、停在「永远不触发」状态。所以只要 chat 页打开，宠物就在观察真实的 document 事件，单元测试也不需要伪造 DOM。

## 伴侣专属设置页

系统设置「个人」分组里新增一页 **AI 伴侣**（`packages/web/src/lib/settings-sections.ts` 在 `appearance` 与 `account` 之间加 `companion`）。这一页与 Agent 工作流独立：在伴侣名字或称谓上做修改并不会启用伴侣，即便通用页的位置选择器是「关闭」，这一页仍然可见。

三行设置，位于 `packages/web/src/features/settings/companion-section.tsx`：

- **名字**（`companionNameLabel`）：一个 40 字符输入框。空值表示「用默认问候语」，不是「用户忘了填」——服务端按原样存空字符串，下游文案自己决定怎么显示。
- **称谓**（`companionPronounLabel`）：覆盖封闭枚举 `he / she / they / it`（与服务端新增的 `CompanionPronoun` enum 一一对应）的 4 段 `Segmented<CompanionPronoun>`。未设置时默认 `they`；未知字符串由服务端拒绝，而不是悄悄映射。
- **主动间隔**（`companionProactiveTimeoutLabel`）：覆盖 `关闭 / 1 分钟 / 5 分钟 / 15 分钟 / 30 分钟 / 60 分钟` 的 6 档 `Segmented<number>`。滑块的毫秒值由 `snapProactiveTimeoutMsForTest` 取整并吸附，所以旧版本写入或手工编辑的、不在档位上的值在加载时会吸附到最近的档位。

新增三个可选 `ui_prefs` 字段（`companionName?: string`、`companionPronoun?: CompanionPronoun`、`companionProactiveTimeoutMs?: number`），加到 `packages/server/src/api/types.ts` 的 `UiPrefs` 上。三者都由 `packages/server/src/services/companion-prefs.ts` 在写入时校验（名字长度上限、称谓封闭枚举、超时 0 或区间内有限数值）；拒绝的写入不存盘、返回 400，与 `draftShortcuts` 同套语义。`packages/web/src/features/chat/companion-store.tsx` 现在暴露 `name / pronoun / proactiveTimeoutMs` 与既有 `placement / floatingPosition` 并列，从 `GET /api/me/prefs` 加载、通过 `PUT /api/me/prefs` fire-and-forget 写入。

## 兼容性

- **零数据迁移。** 三个新字段全部可选；老 prefs 文件加载后落到 `name = ""`、`pronoun = "they"`、`proactiveTimeoutMs = 0`——与全新用户的默认值一致。
- **既有位置选择器不变。** 通用页上的 4 段选择器仍负责位置字段；这一页纯粹是加法。
- **人设提示块的线协议不变。** `[companion_persona]` 与 `MARKER_TAGS.companionPersona` 在线上仍是同一字节序列、剥离清单仍用同一键。
- **主动聊天是 opt-in。** 默认 `proactiveTimeoutMs = 0`（「永不主动」），所以不打开这一页的用户看不到任何行为变化。即便打开了，随时可以把滑块拖回 0。
- **服务端强制校验。** 绕过编辑器的请求（例如手写 PUT）也不能把无界字符串塞进 prefs 行；同一个 40 字符上限、同一个封闭称谓枚举、同一个 `[60_000, 3_600_000]` 毫秒区间。

## 测试

- `packages/web/test/companion-pet.test.ts` — 4 个用例：`COMPANION_POSES` 恰好是文档承诺的 7 个姿态，`poseFromTaskStateForTest` 把 `idle` → `idle`、其它状态 → `thinking`，`statusCopyForTest` 在两种语言下为每个姿态返回非空且两两不同的文案，最常见的 `idle` vs `thinking` 配对文案明显有别。
- `packages/web/test/companion-store.test.ts` — 既有 8 个 `placementFromPrefs` 用例 + 新增 6 个 `companionIdentityFromPrefs` 用例，钉死三个中性默认值、每个合法称谓都原样回显、垃圾字符串与 `NaN` 落到默认值。
- `packages/web/test/use-proactive-trigger.test.ts` — 6 个用例：`isProactiveArmedForTest` 在 `threshold <= 0` 时永不触发、在阈值处精确触发，`snapProactiveTimeoutMsForTest` 把精确档位原样回写、偏离档位的值吸附到最近档。
- `packages/server/test/companion-prefs.test.ts` — 跨三个字段 12 个用例：合法值的存取往返、各受限场景的拒绝（名字超长、未知称谓、超时低于下限 / 高于上限 / 非数值），并通过先写一个无关字段再触发失败 PUT 的方式验证「被拒绝的写入不存盘」这条路由层契约。