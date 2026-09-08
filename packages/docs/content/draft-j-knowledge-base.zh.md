---
title: DRAFT J — 知识库 + 文档归一化
description: 用户当面提出的、还没进入空白分析或决策表的产品需求草稿。参考 firecrawl/anydoc。
---

> **DRAFT — 用户输入需求(进行中)**。这块**不在页面权威盘点之内**:用户当面提出的、还没进入空白分析或决策表的产品需求草稿。等正式立项时按工程拆分进对应子节、决策表、路线图,然后本节删除。状态由用户口述驱动,可能互斥、可能重复、可能不完整 —— 用户已声明"后面还有"。

## J. 知识库 + 文档归一化

参考实现:[firecrawl/anydoc](https://github.com/firecrawl/anydoc) —— Firecrawl 出品的 Rust 库,Node.js / Python / WASM 绑定,14 种办公格式 + PDF → GFM Markdown,中位 <5ms。

需求:

- **知识库模块**:接受所有类型的文档资料(用户上传的任意文件)
- **准确识别 + 整理**:归一化成 LLM 可快速检索/读取的格式(MD 优先,或 JSON / 结构化文本)
- **检索性能**:大模型读知识库时延迟可接受

| 需求 | 现状 | 备注 |
|---|---|---|
| 知识库模块 UI | 缺失 | 单独一个模块,管理上传/分类/检索 |
| 文档归一化 → MD | 缺失(可选 anydoc 作底座) | anydoc 已覆盖 Word / PowerPoint / Excel / OpenDocument / RTF / EPUB / CSV / PDF 共 14 种 |
| 超出 anydoc 的格式 | 缺失 | 扫描 PDF / 图片需 OCR;音视频需转录;代码仓、压缩包、HTML 邮件等需另设计 |
| 与 Linsight 的集成方式 | 缺失 | 知识库如何喂给 agent 作为上下文?RAG?tool call?附件预算? |
| 检索层 | 缺失 | 向量化 / 倒排 / chunk 切分;是否复用现有 search 通路 |
| 权限 / 共享 | 待定 | 知识库随 project 走还是跨 project?能否共享给特定用户? |
| 更新 / 重新归一化 | 缺失 | 源文件变更后,MD 缓存如何失效 |