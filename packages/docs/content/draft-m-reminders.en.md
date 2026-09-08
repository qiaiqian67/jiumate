---
title: DRAFT M — Real-time reminders for session confirmations
description: A draft of product requirements captured from the user, not yet promoted to the gap analysis or decision table.
---

> **DRAFT — User-input requirement (in progress).** This block is **outside the page's authoritative inventory**: a draft of product requirements captured from the user, not yet promoted to the gap analysis or decision table. When the requirement is officially picked up, it is split out into the appropriate sections and decision table, and this draft is deleted. State is user-driven; the items may be mutually exclusive, duplicated, or incomplete — the user has flagged "more to come".

## M. Real-time reminders for session confirmations

Requirement: when there is a human-confirmation item in a session (typically: a waiting approval — pre-tool execution approval, or a timeout), the system **actively pushes a notification** to the user, rather than relying on the user watching the UI.

Trigger scenarios:

- Agent triggers a tool with `approval_mode != "allow-all"` and waits for a human decision
- A sent approval has crossed the timeout threshold
- Other states requiring human intervention (task failure, token exhaustion, external service errors, etc.)

| Requirement | Status | Notes |
|---|---|---|
| Web in-app notification | partial | approvals already surface in the chat dock; only visible while the tab is open |
| Desktop (OS) notification | missing | Electron `Notification` / macOS NSUserNotification / Windows toast |
| Email notification | missing | escalation when idle for too long |
| IM-bridge notification | TBD | push to Feishu / DingTalk / WeChat / QQ via L's "project-level bridge"? |
| Sound cue | missing | desktop pet / TTS (re-uses K) |
| Mobile push | missing | mobile-app push, or PWA web-push |
| Notification aggregation / quiet policy | missing | aggregate via G's inbox; Do-Not-Disturb window; per-session folding |
| Reminder priority | TBD | approvals are high-priority; info items can be downgraded to silent |
| Mobile / offline scenarios | TBD | when the user is away from any terminal — can the reminder "find" them? |