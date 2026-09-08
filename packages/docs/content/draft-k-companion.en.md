---
title: DRAFT K — Emotional value + digital desktop pet
description: A draft of product requirements captured from the user, not yet promoted to the gap analysis or decision table. References moeru-ai/airi.
---

> **DRAFT — User-input requirement (in progress).** This block is **outside the page's authoritative inventory**: a draft of product requirements captured from the user, not yet promoted to the gap analysis or decision table. When the requirement is officially picked up, it is split out into the appropriate sections and decision table, and this draft is deleted. State is user-driven; the items may be mutually exclusive, duplicated, or incomplete — the user has flagged "more to come".

## K. Emotional value + digital desktop pet

Reference: [moeru-ai/airi](https://github.com/moeru-ai/airi) — self-hosted AI VTuber / digital companion platform; VRM + Live2D avatars, real-time voice, multi-LLM providers, web / desktop / mobile (~48.9k stars).

Requirements:

- **AI companion**: a character with avatar / voice / personality that can chat and be companion
- **Digital desktop pet**: a long-lived pet on the desktop / window corner with idle animation
- **Emotional value**: the product should be more than a tool — the user should want to "open it" and "spend time with it"

| Requirement | Status | Notes |
|---|---|---|
| Avatar layer | missing | VRM / Live2D / auto-blink / look-at / idle eye movement |
| Voice (TTS) | missing | multi-provider: ElevenLabs / OpenAI / Volcengine / local Kokoro |
| Hearing (ASR) | missing | client-side speech recognition + talking detection |
| Personality / persona | missing | how does this interact with the existing Agent system — is the companion a kind of Agent? |
| Integration with Linsight Agent | TBD | does the companion go through Linsight's LLM path? can it call tools? |
| Desktop embedding | TBD | pet as Electron tray / Web widget / standalone app? |
| Cross-platform | TBD | real-time web rendering vs native desktop vs mobile |
| Self-hosted / local-first | TBD | reuse Linsight's single-instance / offline inference path? |