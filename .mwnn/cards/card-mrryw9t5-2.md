---
id: card-mrryw9t5-2
title: "get ai loop to work with all the copilot, codex, and claude cli's. If Cursor has a cli do that one too."
column: col-mqwk2njn-2
position: 1000
assignee: { kind: ai }
createdAt: 1784475932585
updatedAt: 1784904831061
---

## Description
Extend the AI loop's agent handoff layer so card-definition and card-implementation work can run through locally installed GitHub Copilot CLI, OpenAI Codex CLI, or Anthropic Claude Code CLI. Keep prompt delivery, workspace context, card status detection, board transitions, cancellation, and failure handling consistent across providers. Also investigate Cursor's current official CLI and add it only if it supports equivalent non-interactive agent execution.

## Acceptance criteria
- [ ] The AI loop exposes GitHub Copilot CLI, OpenAI Codex CLI, and Anthropic Claude Code CLI as supported agent providers without duplicating provider-specific logic in the board-processing algorithm.
- [ ] For each supported provider, the loop launches the configured CLI in the active workspace, supplies the existing definition or implementation handoff prompt, waits for completion evidence in the card file, and applies the same subsequent board transition.
- [ ] Executable discovery and configuration handle command paths containing spaces and report an actionable error when a selected CLI is missing, unavailable, or cannot be started.
- [ ] A provider process that exits unsuccessfully or fails to produce a valid terminal card status does not falsely complete or advance the card, and the reason is surfaced to the user and recorded consistently.
- [ ] Stopping the AI loop cancels any active CLI handoff and leaves the card and loop in a recoverable state.
- [ ] Cursor's official CLI capability is verified against current documentation; if it supports equivalent non-interactive agent execution, a Cursor provider passes the same behavior checks, otherwise the unsupported limitation and verification source are documented.
- [ ] Automated tests cover provider selection, command/prompt construction, successful completion, definition handoff, missing executables, unsuccessful exits, invalid or absent terminal status, and cancellation for every supported provider.
- [ ] Focused tests, the full test suite, compilation, and lint all pass, and an end-to-end smoke test confirms the AI loop can process a card through each locally available supported CLI.

## Activity
### 2026-07-24T08:37:49.408Z - Definition requested from Codex (ChatGPT)
Asked Codex (ChatGPT) to fill in the Description and Acceptance criteria for this card.
