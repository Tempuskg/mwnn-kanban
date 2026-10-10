---
id: card-muv70vog-1
title: "When I assign to AI chat but the chat hasn't loaded yet, the chat loads but doesn't get the prompt and then I have to assign again and it works."
column: col-mqwk2njn-4
position: -55000
assignee: { kind: human }
preferredModel.codex: gpt-5.5
preferredModel.claude-code: sonnet
thinkingLevel.copilot: high
thinkingLevel.codex: high
thinkingLevel.claude-code: high
createdAt: 1791201330016
updatedAt: 1791404753916
---

## Description
Ensure that assigning a card to AI Chat succeeds on the first attempt even when the chat interface has not finished loading. The extension must retain the generated assignment prompt while chat initializes and deliver it once the chat is ready, without requiring the user to assign the card again or creating duplicate submissions.

## Acceptance criteria
- [x] Assigning a card to AI Chat before the chat interface has loaded opens or initializes the chat and submits the generated assignment prompt automatically when it becomes ready.
- [x] The initial assignment prompt is delivered exactly once; chat readiness events or retries do not create duplicate prompt submissions.
- [x] Assigning a card when AI Chat is already loaded continues to submit the prompt immediately without regression.
- [x] If chat initialization or prompt delivery fails, the user receives a clear failure indication and the extension does not falsely report the assignment as successfully handed off.
- [x] Automated tests cover both the not-yet-loaded and already-loaded chat paths, including protection against duplicate prompt delivery.

## Activity
### 2026-10-07T18:08:57.038Z - Usage Orchestrator chose OpenAI Codex CLI
Stage: definition. OpenAI Codex CLI reports 94% remaining, resetting 2026-10-14T12:24:03.000Z - the soonest reset among the CLIs with usage left, so it is spent before it is lost.

### 2026-10-07T18:08:57.592Z - OpenAI Codex CLI definition handoff started
Started OpenAI Codex CLI in the active workspace and waiting for card-file completion evidence.
Workspace default model: gpt-5.6-sol.
Workspace default thinking level: low.

### 2026-10-07T18:09:47.325Z - Run settings recommended by Jev
Jev (TypeSafe) judged this card's difficulty tier: **standard**.

- copilot: model `gpt-5.3-codex`, thinking level `high`
- codex: model `gpt-5.5`, thinking level `high`
- claude-code: model `sonnet`, thinking level `high`

### 2026-10-07T18:22:05.056Z - Auto-start held in Ready
Assigned to AI, but the card stays in Ready: "Implement" is at its WIP limit of 1.

### 2026-10-07T18:22:28.007Z - Usage Orchestrator chose GitHub Copilot CLI
Stage: implementation. GitHub Copilot CLI's usage is unknown (Reading GitHub Copilot CLI usage is not supported yet.), so it is being drained until it stops accepting work.

### 2026-10-07T18:22:28.546Z - GitHub Copilot CLI implementation handoff started
Started GitHub Copilot CLI in the active workspace and waiting for card-file completion evidence.
Card preferred model: gpt-5.3-codex.
Card thinking level: high.

### 2026-10-07T18:22:37.827Z - GitHub Copilot CLI implementation handoff failed
GitHub Copilot CLI rejected the card's preferred model "gpt-5.3-codex": Error: Model "gpt-5.3-codex" from --model flag is not available.. The card was not advanced; set a model name GitHub Copilot CLI accepts on the card, or clear the card's preferred model to use that CLI's default.

### 2026-10-07T19:24:26.589Z - Usage Orchestrator chose OpenAI Codex CLI
Stage: implementation. OpenAI Codex CLI reports 94% remaining, resetting 2026-10-14T12:24:02.000Z - the soonest reset among the CLIs with usage left, so it is spent before it is lost.

### 2026-10-07T19:24:27.450Z - OpenAI Codex CLI implementation handoff started
Started OpenAI Codex CLI in the active workspace and waiting for card-file completion evidence.
Card preferred model: gpt-5.5.
Card thinking level: high.

### 2026-10-07T19:26:15.628Z - OpenAI Codex CLI implementation completed
Updated Codex clipboard chat handoff delivery to keep the generated prompt available while the chat composer initializes, retry paste delivery until one attempt succeeds, and return a visible failure without recording a successful handoff if delivery never succeeds. Added focused chat handoff tests for already-loaded delivery, delayed composer readiness, duplicate prevention, and failure reporting.
Validated with `npm run compile-tests`, `node --test dist-test/test/unit/chatHandoff.test.js`, `npm run compile`, `npm test`, and `npm run lint`.
STATUS: DONE

### 2026-10-07T19:26:46.113Z - Run with AI parked in Verify
Implementation finished; reassigned to Human for verification and sign-off.
