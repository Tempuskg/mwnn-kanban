---
id: card-mtmdt3o8-1
title: "When editing a card and you change the column and save it, the card should move to the top of that column"
column: col-mqwk2njn-4
position: -46000
assignee: { kind: ai }
preferredModel.copilot: gpt-5-mini
preferredModel.codex: gpt-5.5
preferredModel.claude-code: default
thinkingLevel.copilot: medium
thinkingLevel.codex: medium
thinkingLevel.claude-code: medium
createdAt: 1788491746520
updatedAt: 1791148804895
---

## Description
When a card is edited in the card editor and its column is changed before saving, the saved card should be placed at the top of the destination column. To do that, give it a `position` lower than the lowest existing position in that column. Today it keeps its old `position`, so it lands somewhere arbitrary in the new column. Saving without changing the column must not change the card's position.

## Acceptance criteria
- [x] Saving an edited card with a different column writes a `position` strictly lower than every other card's position in the destination column, so it shows first.
- [x] Saving an edited card whose column is unchanged keeps its existing `position`.
- [x] Moving into an empty column produces a valid integer position, and the card file still parses correctly on reload.
- [x] No other cards in the source or destination column are renumbered or rewritten.
- [x] A unit test covers the column-change case (top placement) and the unchanged-column case (position preserved).
- [x] `npm run compile-tests` and `npm test` pass.
- [x] Development Host smoke test: change a card's column in the editor, save it, and confirm the card appears at the top of the new column.

## Activity
### 2026-10-03T15:54:49.018Z - Anthropic Claude Code CLI definition handoff started
Started Anthropic Claude Code CLI in the active workspace and waiting for card-file completion evidence.
Workspace default model: default.
Workspace default thinking level: low.

### 2026-10-03T15:55:13.617Z - Run settings recommended by Jev
Jev (TypeSafe) judged this card's difficulty tier: **standard**.

- copilot: model `gpt-5-mini`, thinking level `medium`
- codex: model `gpt-5.5`, thinking level `medium`
- claude-code: model `default`, thinking level `medium`

### 2026-10-03T15:57:40.090Z - AI loop placed this card in Ready
The definition was just filled in; moved to "Ready" to continue through the board flow.

### 2026-10-03T15:57:41.278Z - Anthropic Claude Code CLI triage handoff started
Started Anthropic Claude Code CLI in the active workspace and waiting for card-file completion evidence.
Card preferred model: default.
Card thinking level: medium.

### 2026-10-03T15:57:46.124Z - Anthropic Claude Code CLI triage handoff cancelled
The active CLI process was stopped. The card was not advanced and remains assigned for a recoverable retry.

### 2026-10-04T20:59:54.053Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-10-04 - Claude Code (claude-sonnet-5-5; card asked for `default`)
The editor posted `moveCard` with `toIndex` equal to the destination column's card count, so the card landed at the bottom. It now posts `toIndex: 0` through a new `columnChangeMove` helper in media/board.js, which returns nothing when the column is unchanged. The store already gives a card moved to index 0 a position below its first neighbour and rewrites no other card file.
Tests added: `columnChangeMove` top placement and unchanged column (test/unit/webviewCardPath.test.ts), and a move into an empty column (test/unit/boardStore.test.ts). The existing store test for top placement was already in place. `npm run compile-tests`, `npm run compile` and `npm test` pass (577/577).
The user ran the installed build in VS Code and confirmed that changing a card's column in the editor and saving puts the card at the top of the new column.
STATUS: DONE
