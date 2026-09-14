---
title: DRAFT K — Emotional value + digital desktop pet
description: A draft of product requirements captured from the user, not yet promoted to the gap analysis or decision table. References moeru-ai/airi. Current main line: thicken the pet expression layer → TTS + voice reactions → ASR + microphone → VRM/Live2D.
---

> **DRAFT — User-input requirement (in progress).** This block is **outside the page's authoritative inventory**: a draft of product requirements captured from the user, not yet promoted to the gap analysis or decision table. When the requirement is officially picked up, it is split out into the appropriate sections and decision table, and this draft is deleted. State is user-driven; the items may be mutually exclusive, duplicated, or incomplete — the user has flagged "more to come".

## K. Emotional value + digital desktop pet

Reference: [moeru-ai/airi](https://github.com/moeru-ai/airi) — self-hosted AI VTuber / digital companion platform; VRM + Live2D avatars, real-time voice, multi-LLM providers, web / desktop / mobile (~48.9k stars).

Requirements:

- **AI companion**: a character with avatar / voice / personality that can chat and be companion
- **Digital desktop pet**: a long-lived pet on the desktop / window corner with idle animation
- **Emotional value**: the product should be more than a tool — the user should want to "open it" and "spend time with it"

### Current gap (vs airi)

| Dimension | airi | us |
|---|---|---|
| Avatar layer | VRM + Live2D + auto-blink + look-at + idle eye movement + lip sync | a 36-96 px SVG fox |
| Voice (TTS) | ElevenLabs / OpenAI / Volcengine / local Kokoro, multi-provider | none |
| Hearing (ASR) | browser microphone + Discord voice + Whisper + VAD talking detection | none |
| Realtime dialog | WebRTC VAD → STT → LLM → TTS pipeline | none |
| Memory | DuckDB WASM + pglite "Memory Alaya" | none (only Agent State) |
| Persona | full character, independent LLM loop, proactive chat | single `[companion_persona]` marker |
| Platforms | Stage Web / Stage Tamagotchi / Stage Pocket | Web + one desktop floating window |
| Settings depth | model / voice / avatar / behaviour / schedule / plugins, whole suite | 4-segment placement picker |
| Game integration | Minecraft / Factorio / Helldivers 2 PoC | N/A |
| Social | Discord / Telegram | none |

### Already shipped (before 2026-09-11)

- PR 1: 4-segment placement picker (`ui_prefs.companionPlacement`) + server-side persona gate `placementEnablesPersona()` + 11-case parameterised tests
- PR 2: `CompanionBanner` + `CompanionWidget` + Electron floating window + shared `<CompanionPet>` visual + `CompanionStore` (React Context) + bilingual changelog

### Next-phase roadmap (user-approved on 2026-09-11)

1. **Pet expression layer** (L.1)
   - Multi-pose: listening / speaking / celebrating / confused / sleepy, 7-state machine
   - Eye-tracking the mouse cursor (≤ 2 px parallax shift)
   - Random blink (every 3-7 s, independent of idle)
   - Click-on-pet reaction: wave (ear wiggle + heart bubble)
   - Idle micro-motion: breathing scale, occasional ear twitch, head tilt

2. **Proactive chat** (L.2, cross-cutting)
   - Pet can ping the user after N minutes of inactivity (pushes a reminder-class task)
   - Or bubble randomly while idle
   - Every phase carries it forward. Phase 1 ships only the **trigger skeleton** (active/inactive detection + throttle config); the real LLM call waits for Phase 2+

3. **Companion-specific settings page** (L.3)
   - New `/settings/companion` sub-page
   - Phase 1 content: pet name, pronoun, idle timeout slider (feeds proactive chat)
   - Later phases: personality sliders (playful ↔ formal / verbose ↔ terse / empathy), TTS provider picker, avatar picker, proactive frequency, quiet hours
   - Not reusing Agent configuration — companion is an independent persona

4. **TTS + voice reactions** (L.4)
   - Pet actually speaks after each turn
   - Web Speech API for the free tier, ElevenLabs / OpenAI / local Kokoro behind it
   - Floating window audio output (`<audio>` in companion-page)
   - The same turn also fires the bubble reaction (visual + audio in sync)

5. **Microphone input + ASR** (L.5)
   - Tap-to-talk or push-to-talk, transcribed into the chat composer
   - Web Speech API first, Whisper behind it
   - Mic-permission UI / waveform / status indicator / VAD shut-off detection
   - Linked to L.4: ASR → LLM → TTS makes the full voice loop

6. **VRM / Live2D stereoscopic avatar** (L.6)
   - three.js + VRM loader
   - auto-blink / look-at / lip-sync (TTS audio input from L.4)
   - User-replaceable model files (GLB/VRM upload)
   - Re-designs the floating window canvas (transparent-background WebGL canvas)
   - Largest engineering lift — last

### Cross-cutting: companion vs Linsight Agent system

User decision: **companion = proactive chat** (airi-style), not pure decoration + persona injection. Specifically:

- Companion has its own persona (system prompt), compatible with but independent of the existing Agent's `[companion_persona]` marker
- When proactive, the companion can launch a new task (going through Linsight's existing LLM path)
- Pet can sense "user has been away for a while" and ping (throttled: at most once per 6 h / quiet hours suppressed)
- Proactive content is governed by personality sliders (playful pet = chattier, formal pet = reserved)

### Engineering boundaries

- **Zero breakage**: any new companion capability must remain backward-compatible with the four `companionPlacement` values; legacy `companionModeEnabled` migration logic stays
- **Self-hosted / local-first**: TTS prefers Web Speech API (local, free), ASR prefers Web Speech API (local), VRM models loaded locally
- **Cross-platform**: desktop (Web Speech API + third-party providers both work), web (Web Speech API fully supported); VRM in desktop + desktop pet window
- **Settings storage**: every companion-specific config goes into `ui_prefs.companionXxx`, sibling of `companionPlacement`

### PR slicing recommendation

| PR | Content | Estimated scope |
|---|---|---|
| **PR-A (this round)** | L.0 + L.1 + L.2 skeleton + L.3 skeleton | Expression layer + proactive trigger skeleton + companion settings page (basic items) |
| PR-B | L.4 TTS + voice reactions | TTS provider integration + floating window audio |
| PR-C | L.5 microphone + ASR | Mic UI + VAD + LLM integration |
| PR-D | L.6 VRM/Live2D | three.js + model loading + stereoscopic floating window |

Each PR is independently rollback-able, ships its own bilingual changelog and quality-gate conclusion.

### Awaiting user input (before next session)

- L.1 pose inventory: should I draft SVG mockups of the seven poses before coding?
- L.3 settings page naming: `/settings/companion` vs `Settings → Companion` nested sub-page vs top-level entry?
- L.4 TTS priority: Web Speech API first or straight to ElevenLabs/OpenAI? (local-first vs audio-quality-first)
- L.5 ASR shape: tap-only / push-to-talk / VAD auto-shutoff — pick one or all?

### Linked decision table

None yet (not formally promoted).