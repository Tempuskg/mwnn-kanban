---
id: card-mvmx6lp1-1
title: Add cursor agent CLI other to the preferred ai model drop-down list when you're editing a mwnn kanban card
column: col-mqxta6ho-4
position: -1000
assignee: { kind: human }
createdAt: 1792877853781
updatedAt: 1792879188672
---

## Description
When editing a card on the board, the Preferred AI model and thinking level per CLI control uses a hardcoded provider list that still stops at Cursor Agent CLI. Add **Cursor Agent CLI Other** (`cursor-other`) to that provider drop-down so a card can set `preferredModel.cursor-other` and `thinkingLevel.cursor-other` independently of `preferredModel.cursor` / `thinkingLevel.cursor`, matching the host’s first-class provider ids and the model/thinking suggestion maps already pushed with board state.

## Acceptance criteria
- [x] Opening a card for edit shows **Cursor Agent CLI Other** in the agent-CLI provider drop-down beside **Cursor Agent CLI** (and the other CLIs), labeled consistently with the host.
- [x] Choosing Cursor Agent CLI Other and setting a model (typed or from that provider’s suggestion menu) persists as `preferredModel.cursor-other` on the card file and does not change `preferredModel.cursor`.
- [x] Choosing Cursor Agent CLI Other and setting a thinking level persists as `thinkingLevel.cursor-other` and does not change `thinkingLevel.cursor`.
- [x] Clearing the model or thinking field for Cursor Agent CLI Other removes only that provider’s key; other providers’ values stay intact.
- [x] Model and thinking suggestion menus for Cursor Agent CLI Other use the `cursor-other` entries from the board state’s suggestion maps (same pattern as the other CLIs).
- [ ] Focused coverage (or an equivalent board/webview assertion) verifies the provider list includes `cursor-other`; `npm run compile-tests`, `npm run compile`, and relevant tests pass. A Development Host smoke confirms the drop-down and independent save behavior above.

## Activity
### 2026-10-24T21:39:21.161Z - Cursor Agent CLI Other definition handoff started
Started Cursor Agent CLI Other in the active workspace and waiting for card-file completion evidence.

### 2026-10-24T21:40:04.605Z - Run settings recommended by Jev
Jev (TypeSafe) judged this card's difficulty tier: **standard**.
No provider had a choice to make, so no run settings were changed.

### 2026-10-24T21:51:02.015Z - Auto-started in Implement
Assigned to AI in Ready; moved to Implement automatically.

### 2026-10-24T21:51:16.602Z - Usage Orchestrator chose OpenAI Codex CLI
Stage: implementation. OpenAI Codex CLI reports 91% remaining, resetting 2026-10-31T13:48:55.000Z - the soonest reset among the CLIs with usage left, so it is spent before it is lost.

### 2026-10-24T21:51:16.876Z - Usage Orchestrator dispatch dispatch-mvmxo8ss-1 started
Card: card-mvmx6lp1-1 ("Add cursor agent CLI other to the preferred ai model drop-down list when you're editing a mwnn kanban card"). CLI: OpenAI Codex CLI. Stage: implementation.
Requested model: none (source: CLI default; no model argument was supplied).
Actual model: awaiting authoritative CLI/session metadata.
Started OpenAI Codex CLI in the active workspace and waiting for card-file completion evidence.

### 2026-10-24T21:51:20.598Z - Usage Orchestrator dispatch dispatch-mvmxo8ss-1 model observed
Card: card-mvmx6lp1-1. CLI: OpenAI Codex CLI. Stage: implementation.
Actual model: "gpt-6.1-sol" (source: Codex rollout turn_context.payload.model; attempt: dispatch-mvmxo8ss-1).

### 2026-10-24 - Codex implementation and verification
- Added `cursor-other` beside `cursor` in `media/board.js`, using the host label **Cursor Agent CLI Other**. Exported the actual editor provider list for regression assertions; existing provider-scoped draft/save and suggestion paths now include it. No protocol change was needed.
- Added coverage in `test/unit/cardModelSuggestions.test.ts` for exact host/provider label parity, typed and suggested Cursor Other model/level edits, serialized `preferredModel.cursor-other` / `thinkingLevel.cursor-other` keys, and clearing only those keys while preserving Cursor and Codex values. Updated the Unreleased changelog.
- Verified `node --check media/board.js`, `npm run compile-tests`, `npm run compile`, focused `node --test dist-test/test/unit/cardModelSuggestions.test.js dist-test/test/unit/cardPreferredModel.test.js dist-test/test/unit/cardThinkingLevel.test.js` (83 passed), `npm test` (986 passed), `npm run lint`, and scoped `git diff --check`.
- The first five criteria are supported by code and automated assertions. The final combined criterion remains unchecked solely because a real Development Host smoke has not been performed. Native VS Code UI control is unavailable in this session. The card column is unchanged.
- Human smoke steps: launch this working tree in a VS Code Extension Development Host (F5), open MWNN Kanban, and edit a disposable card. Confirm **Cursor Agent CLI Other** appears immediately after **Cursor Agent CLI**. Set distinct Cursor model/level values and save. Reopen, select Cursor Agent CLI Other, type distinct model/level values, save, and inspect the card markdown for both independent pairs of keys. Configure distinct model/thinking suggestions for both providers via Agent CLI Models; reopen the card and verify each provider's menus use its own suggestions, then choose Cursor Other suggestions and save. Finally clear each Cursor Other field, save and reopen; verify only its corresponding key disappears and Cursor/other-provider values remain. Record the result here and check the final criterion when successful.
- A working-tree VSIX can be packaged and installed for the human smoke if desired, following `.github/instructions/vscode-extension-release.instructions.md` (include dependencies, confirm the Pro package is in the archive, preserve the version, and reload VS Code after installation).
STATUS: BLOCKED: Human Development Host smoke required to confirm the dropdown and independent save/clear behavior.
