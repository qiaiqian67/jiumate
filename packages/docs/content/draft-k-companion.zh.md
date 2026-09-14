---
title: DRAFT K — 情绪价值 + 数字桌宠
description: 用户当面提出的、还没进入空白分析或决策表的产品需求草稿。参考 moeru-ai/airi。当前主线:Pet 表情层做厚 → TTS + 语音反应 → ASR + 麦克风 → VRM/Live2D。
---

> **DRAFT — 用户输入需求(进行中)**。这块**不在页面权威盘点之内**:用户当面提出的、还没进入空白分析或决策表的产品需求草稿。等正式立项时按工程拆分进对应子节、决策表、路线图,然后本节删除。状态由用户口述驱动,可能互斥、可能重复、可能不完整 —— 用户已声明"后面还有"。

## K. 情绪价值 + 数字桌宠

参考实现:[moeru-ai/airi](https://github.com/moeru-ai/airi) —— 自托管 AI VTuber / 数字伴侣平台,VRM + Live2D 形象、实时语音、多 LLM provider、跨 web/desktop/mobile(~48.9k stars)。

需求:

- **AI 伴侣**:有形象 / 声音 / 性格的角色,可以对话、陪聊
- **数字桌宠**:长期挂在桌面 / 窗口角落的小宠物,有 idle 动画
- **情绪价值**:让产品不止是工具,还能让用户愿意"打开它"、愿意"和它待一会儿"

### 当前差距 (vs airi)

| 维度 | airi | 我们 |
|---|---|---|
| Avatar 层 | VRM + Live2D + auto-blink + look-at + idle eye movement + lip sync | 一只 36-96px 的 SVG 狐狸 |
| 声音 (TTS) | ElevenLabs / OpenAI / 火山 / 本地 Kokoro 多 provider | 无 |
| 听觉 (ASR) | 浏览器麦克风 + Discord 语音 + Whisper + VAD talking detection | 无 |
| 实时对话 | WebRTC VAD→STT→LLM→TTS 流水线 | 无 |
| 记忆 | DuckDB WASM + pglite "Memory Alaya" | 无(只有 Agent State) |
| 人设 | 完整角色,可独立 LLM 循环,可主动开口 | 单段 `[companion_persona]` marker |
| 平台 | Stage Web / Stage Tamagotchi / Stage Pocket | Web + 桌面单一悬浮窗 |
| 设置深度 | 模型 / 声音 / avatar / 行为 / 调度 / 插件一整套 | 4 段位置选择器 |
| 游戏 | Minecraft / Factorio / Helldivers 2 PoC | N/A |
| 社交 | Discord / Telegram | 无 |

### 已落地 (2026-09-11 之前)

- PR 1: 4 段位置选择器 (`ui_prefs.companionPlacement`) + server 注入门 `placementEnablesPersona()` + 参数化 11 case 测试
- PR 2: `CompanionBanner` + `CompanionWidget` + Electron 悬浮窗 + `<CompanionPet>` 共享视觉 + `CompanionStore` (React Context) + 双语 changelog

### 下一阶段路线 (用户 2026-09-11 认可)

1. **Pet 表情层做厚** (L.1)
   - 多姿态:listening / speaking / celebrating / confused / sleepy,共 7 个状态机节点
   - 眼睛追踪鼠标光标(最多 2px 位移,parallax)
   - 随机眨眼(每 3-7s 一次,独立于 idle)
   - 点击宠物:wave 反应(耳朵摇 + heart 气泡)
   - idle 微动作:呼吸缩放 + 偶发耳朵抽动 + 头倾

2. **主动聊天** (L.2,横切关注点)
   - 伴侣能在 idle N 分钟后主动 ping 用户(推 reminder 类 task)
   - 或空闲时随机冒泡
   - 每个 phase 都要带进来。Phase 1 只做**触发器骨架**(active/inactive 检测 + 节流配置),真正的 LLM 调用等 Phase 2+

3. **伴侣专属设置页** (L.3)
   - 新加 /settings/companion 子页
   - Phase 1 内容:宠物名 / 称谓 / idle timeout slider(给主动聊天用)
   - 后续 phase 补:personality sliders(playful↔formal / verbose↔terse / empathy)、TTS provider picker、avatar picker、proactive frequency、quiet hours
   - 不复用 Agent 配置 —— 伴侣是独立 persona

4. **TTS + 语音反应** (L.4)
   - 宠物每轮后真说话
   - Web Speech API 免费起步,ElevenLabs / OpenAI / 本地 Kokoro 可选
   - 悬浮窗音频输出 (`<audio>` in companion-page)
   - 同一 turn 也触发气泡反应(视觉 + 听觉同步)

5. **麦克风输入 + ASR** (L.5)
   - 点按说话或按住说话,转写后塞进 chat composer
   - Web Speech API 起步,Whisper 可选
   - 麦克风权限 UI / 波形 / 状态指示 / VAD 检测闭嘴
   - 与 L.4 联动:ASR → LLM → TTS 构成完整 voice loop

6. **VRM / Live2D 立体 avatar** (L.6)
   - three.js + VRM loader
   - auto-blink / look-at / lip-sync(接 L.4 的 TTS 音频)
   - 用户换模型文件(GLB/VRM 上传)
   - 重新设计悬浮窗 canvas(透明背景的 WebGL canvas)
   - 工程量最大,放最后

### 横切:伴侣与 Linsight Agent 系统的关系

用户决策:**伴侣 = 主动聊天**(airi 风格),不是纯装饰 + persona 注入。具体:

- 伴侣有自己的 persona(system prompt),与现有 Agent 的 `[companion_persona]` marker 兼容但可独立配置
- 主动聊天时,伴侣可以发起一个新的 task(走 Linsight 现有 LLM 路径)
- 宠物可以感知"用户离开了一阵"并主动 ping(节流:每 6h 至多一次 / quiet hours 抑制)
- 主动内容受 personality sliders 控制(playful pet 更啰嗦,formal pet 更克制)

### 工程边界

- **零破坏**:伴侣新增能力必须向后兼容 `companionPlacement` 四个值;legacy `companionModeEnabled` 迁移逻辑不变
- **self-hosted / 本地优先**:TTS 优先 Web Speech API(本地免费),ASR 优先 Web Speech API(本地),VRM 模型本地加载
- **跨平台**:桌面(Web Speech API + 第三方 provider 都支持),web(Web Speech API 全支持);VRM 在桌面 + 桌面 pet 窗口渲染
- **设置存储**:所有伴侣专属配置走 `ui_prefs.companionXxx`,与现有 `companionPlacement` 平级

### PR 切分建议

| PR | 内容 | 预计体量 |
|---|---|---|
| **PR-A (本期)** | L.0 + L.1 + L.2 骨架 + L.3 骨架 | 表情层 + 主动聊天触发器 + 伴侣设置页(基础项) |
| PR-B | L.4 TTS + 语音反应 | TTS provider 接入 + 悬浮窗音频 |
| PR-C | L.5 麦克风 + ASR | 麦克风 UI + VAD + 与 LLM 集成 |
| PR-D | L.6 VRM/Live2D | three.js + 模型加载 + 立体悬浮窗 |

每个 PR 独立可回滚、都有自己的双语 changelog 与质量门结论。

### 待用户拍板(下一会话前)

- L.1 表情清单:是否需要我先画出 7 个姿态的 SVG mockup,再开始编码?
- L.3 设置页命名:`/settings/companion` vs `Settings → Companion` 嵌套子页 vs 顶层入口?
- L.4 TTS 优先级:Web Speech API 起步还是直接 ElevenLabs/OpenAI?(本地优先 vs 音质优先)
- L.5 ASR 形态:点按 / 按住 / VAD 自动闭嘴 三选一还是全要?

### 关联决策表

无(还没立项)。