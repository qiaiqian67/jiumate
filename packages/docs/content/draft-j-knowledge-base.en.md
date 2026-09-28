---
title: DRAFT J — Knowledge base + document normalization
description: A draft of product requirements captured from the user, not yet promoted to the gap analysis or decision table. References firecrawl/anydoc.
---

> **DRAFT — User-input requirement (in progress).** This block is **outside the page's authoritative inventory**: a draft of product requirements captured from the user, not yet promoted to the gap analysis or decision table. When the requirement is officially picked up, it is split out into the appropriate sections and decision table, and this draft is deleted. State is user-driven; the items may be mutually exclusive, duplicated, or incomplete — the user has flagged "more to come".

## J. Knowledge base + document normalization

Reference: [firecrawl/anydoc](https://github.com/firecrawl/anydoc) — Firecrawl's Rust library with Node.js / Python / WASM bindings; 14 office + PDF formats → GFM Markdown; median conversion under 5ms.

Requirements:

- **Knowledge-base module**: accepts all kinds of user-uploaded documents
- **Accurate recognition + organization**: normalize to an LLM-friendly format (Markdown preferred, or JSON / structured text)
- **Retrieval performance**: low latency when an LLM reads from the knowledge base

| Requirement | Status | Notes |
|---|---|---|
| Knowledge-base module UI | missing | standalone module: upload / categorize / retrieve |
| Document normalization → Markdown | missing (anydoc as a base candidate) | anydoc covers Word, PowerPoint, Excel, OpenDocument, RTF, EPUB, CSV, PDF — 14 formats |
| Formats beyond anydoc | missing | scanned PDFs / images need OCR; audio / video need transcription; code repos, archives, HTML mail need separate design |
| Integration with JiuMate | missing | how does the knowledge base feed an agent as context? RAG? tool call? attachment budget? |
| Retrieval layer | missing | vector / inverted index / chunking; reuse existing search path? |
| Permission / sharing | TBD | per-project or cross-project? share with specific users? |
| Update / re-normalize | missing | when the source file changes, how does the Markdown cache invalidate |