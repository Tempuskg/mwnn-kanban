---
id: card-mrjtorob-1
title: In AI loop the status dialog covers up the default chat window submit button
column: col-mqwk2njn-4
position: -1000
assignee: { kind: ai }
createdAt: 1783983455003
updatedAt: 1784475104126
---

## Description
Adjust the AI-loop status dialog layout or positioning in the default chat window so it does not cover the chat composer's submit button, while keeping the loop status visible and usable.

## Acceptance criteria
- [x] With the default chat window open and an AI loop running, the status dialog does not overlap the chat composer or its submit button.
- [x] The default chat window's submit button remains fully visible, enabled when appropriate, and clickable while the status dialog is displayed.
- [x] The status dialog remains readable and continues to show AI-loop progress/status updates after it is repositioned or resized.
- [x] The behavior is verified at the supported default chat window viewport sizes, including a narrow viewport where the previous overlap could occur.
- [x] Existing AI-loop status and chat-submit behavior continues to work when the status dialog is hidden or dismissed.

## Activity
### 2026-07-13T23:01:01.328Z - Definition requested from Codex (ChatGPT)
Asked Codex (ChatGPT) to fill in the Description and Acceptance criteria for this card.

### 2026-07-13T23:02:37.006Z - AI loop placed this card in Ready
The definition was just filled in; moved to "Ready" to wait for a human to review the Description and Acceptance criteria before implementation starts.

### 2026-07-13T23:02:38.298Z - Triage requested from Codex (ChatGPT)
Asked Codex (ChatGPT) to decide whether this card is doable by an AI agent and record the assignee.

### 2026-07-14T01:24:56.086Z - Triage decision
AI can implement this autonomously because the card defines concrete layout and interaction outcomes, and the repository contains the code and test surfaces needed to adjust and validate the webview behavior. No product decision or external/manual implementation step is left open.

### 2026-07-16T12:13:21.123Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.

### 2026-07-16T12:20:01.294Z - Implementation completed by Codex
Moved AI-loop progress from a notification overlay to the VS Code status bar, preserving progress updates and the existing Stop AI Loop command without covering chat at default or narrow widths. Added regression coverage and a changelog entry; compile, focused AI-loop/chat tests, and lint passed. The full suite's unrelated pre-existing `planImporter.test` failure remains outside this card.
