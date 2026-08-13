---
id: card-msrtb19y-1
title: When in AI Loop and moving a card to Done column have it move to the top of the Done column
column: col-mqwk2njn-4
position: -19000
assignee: { kind: ai }
createdAt: 1786643326006
updatedAt: 1786646401535
---

## Description
Change AI Loop completion handling so that when it moves a card into the column whose role is `done`, the completed card is placed at the top of that column. Preserve the relative order of cards already in Done and leave placement behavior for other card moves unchanged.

## Acceptance criteria
- [x] When AI Loop moves a card from a non-Done column into the column whose role is `done`, the moved card is ordered before every card already in that column.
- [x] Cards already in the Done column retain their relative order below the newly completed card.
- [x] Moving a card into an empty Done column succeeds and leaves that card as the only, topmost card.
- [x] The new Done-column order is persisted and remains the same after the board is reloaded or reopened.
- [x] Moves not initiated by AI Loop, and AI Loop moves whose destination is not the Done column, retain their existing placement behavior.
- [x] Automated tests cover AI Loop completion with both an empty and a populated Done column, including preservation of existing-card order.

## Activity
### 2026-08-13T17:48:59.258Z - OpenAI Codex CLI definition handoff started
Started OpenAI Codex CLI in the active workspace and waiting for card-file completion evidence.

### 2026-08-13 - Codex implementation
Changed AI Loop verification completion to insert the completed card at index 0 of Done, added empty and populated Done-order tests, and added persisted reload coverage. Local validation could not run because the workspace command runner failed before launching PowerShell with Windows error 1312.

STATUS: BLOCKED: The local command runner cannot launch PowerShell (Windows error 1312), so compile, tests, lint, and final acceptance verification could not be completed.

### 2026-08-13T17:50:45.258Z - AI loop placed this card in Ready
The definition was just filled in; moved to "Ready" to continue through the board flow.

### 2026-08-13T17:50:47.340Z - OpenAI Codex CLI triage handoff started
Started OpenAI Codex CLI in the active workspace and waiting for card-file completion evidence.

### 2026-08-13T17:52:09.260Z - Triage decision
AI can implement this autonomously because the behavior, persistence requirements, regression boundaries, and automated test cases are fully specified and require no external access or unresolved product decision.

### 2026-08-13T17:52:34.448Z - AI loop advanced this card
Moved to "Implement".

### 2026-08-13T17:52:35.519Z - OpenAI Codex CLI implementation handoff started
Started OpenAI Codex CLI in the active workspace and waiting for card-file completion evidence.

### 2026-08-13T17:59:13.390Z - OpenAI Codex CLI implementation handoff failed
OpenAI Codex CLI exited successfully, but no terminal `STATUS: DONE` or `STATUS: BLOCKED: <reason>` line was appended to the card Activity. The card was not advanced; rerun the implementation handoff after fixing the agent instructions or CLI.

### 2026-08-13T18:35:54.812Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.

### 2026-08-13T18:38:24.633Z - Codex implementation completed
Changed AI Loop verification completion to persist the completed card at index 0 of Done while preserving existing Done-card order. Added empty and populated Done-column coverage plus a persisted reload test. Verified with `npm run compile-tests`, `npm run compile`, focused Node tests (3 passed), `npm test` (309 passed), and `npm run lint`.

STATUS: DONE
