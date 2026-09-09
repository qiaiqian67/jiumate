---
title: DRAFT K — 情绪价值 + 数字桌宠
description: 用户当面提出的、还没进入空白分析或决策表的产品需求草稿。参考 moeru-ai/airi。
---

> **DRAFT — 用户输入需求(进行中)**。这块**不在页面权威盘点之内**:用户当面提出的、还没进入空白分析或决策表的产品需求草稿。等正式立项时按工程拆分进对应子节、决策表、路线图,然后本节删除。状态由用户口述驱动,可能互斥、可能重复、可能不完整 —— 用户已声明"后面还有"。

## K. 情绪价值 + 数字桌宠

参考实现:[moeru-ai/airi](https://github.com/moeru-ai/airi) —— 自托管 AI VTuber / 数字伴侣平台,VRM + Live2D 形象、实时语音、多 LLM provider、跨 web/desktop/mobile(~48.9k stars)。

需求:

- **AI 伴侣**:有形象 / 声音 / 性格的角色,可以对话、陪聊
- **数字桌宠**:长期挂在桌面 / 窗口角落的小宠物,有 idle 动画
- **情绪价值**:让产品不止是工具,还能让用户愿意"打开它"、愿意"和它待一会儿"

| 需求 | 现状 | 备注 |
|---|---|---|
| 形象层(avatar) | 缺失 | VRM / Live2D / auto-blink / look-at / idle eye movement |
| 声音(TTS) | 缺失 | 多 provider(ElevenLabs / OpenAI / 火山 / 本地 Kokoro 等) |
| 听觉(ASR) | 缺失 | 客户端语音识别 + talking detection |
| 性格 / 人设 | 缺失 | 与现有 Agent 系统怎么协同 —— 伴侣是 Agent 的一种? |
| 与 Linsight Agent 集成 | 待定 | 伴侣是否走 Linsight 的 LLM 路径?是否能调用工具? |
| 桌面嵌入 | 待定 | 桌宠:Electron tray / Web Widget / 独立 app? |
| 跨平台 | 待定 | web 端实时渲染 vs 原生桌面 vs 移动端 |
| 自托管 / 本地优先 | 待定 | 是否复用 Linsight 现有单实例 / 离线推理通路 |