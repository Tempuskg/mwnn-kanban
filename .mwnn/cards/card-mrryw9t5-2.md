---
id: card-mrryw9t5-2
title: "get ai loop to work with all the copilot, codex, and claude cli's. If Cursor has a cli do that one too."
column: col-mqwk2njn-4
position: -8000
assignee: { kind: human }
createdAt: 1784475932585
updatedAt: 1785076904545
---

## Description
Extend the AI loop's agent handoff layer so card-definition and card-implementation work can run through locally installed GitHub Copilot CLI, OpenAI Codex CLI, or Anthropic Claude Code CLI. Keep prompt delivery, workspace context, card status detection, board transitions, cancellation, and failure handling consistent across providers. Also investigate Cursor's current official CLI and add it only if it supports equivalent non-interactive agent execution.

## Acceptance criteria
- [x] The AI loop exposes GitHub Copilot CLI, OpenAI Codex CLI, and Anthropic Claude Code CLI as supported agent providers without duplicating provider-specific logic in the board-processing algorithm.
- [x] For each supported provider, the loop launches the configured CLI in the active workspace, supplies the existing definition or implementation handoff prompt, waits for completion evidence in the card file, and applies the same subsequent board transition.
- [x] Executable discovery and configuration handle command paths containing spaces and report an actionable error when a selected CLI is missing, unavailable, or cannot be started.
- [x] A provider process that exits unsuccessfully or fails to produce a valid terminal card status does not falsely complete or advance the card, and the reason is surfaced to the user and recorded consistently.
- [x] Stopping the AI loop cancels any active CLI handoff and leaves the card and loop in a recoverable state.
- [x] Cursor's official CLI capability is verified against current documentation; if it supports equivalent non-interactive agent execution, a Cursor provider passes the same behavior checks, otherwise the unsupported limitation and verification source are documented.
- [x] Automated tests cover provider selection, command/prompt construction, successful completion, definition handoff, missing executables, unsuccessful exits, invalid or absent terminal status, and cancellation for every supported provider.
- [x] Focused tests, the full test suite, compilation, and lint all pass, and an end-to-end smoke test confirms the AI loop can process a card through each locally available supported CLI.

## Activity
### 2026-07-24T08:37:49.408Z - Definition requested from Codex (ChatGPT)
Asked Codex (ChatGPT) to fill in the Description and Acceptance criteria for this card.

### 2026-07-24T14:56:11.657Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.

### 2026-07-24T15:01:01.053Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.

### 2026-07-24T15:33:34.363Z - Implemented multi-provider CLI AI loop
Added one shared CLI discovery, process, evidence-validation, failure, and cancellation layer for GitHub Copilot, OpenAI Codex, Anthropic Claude Code, and Cursor Agent. Added provider settings, documentation, a repeatable isolated smoke harness, and provider-matrix coverage. Compilation, lint, 199 unit tests, and live isolated Codex and Claude Code flows into Verify passed; Copilot and Cursor were not installed locally. Cursor support was verified against its official headless CLI documentation.
STATUS: DONE
