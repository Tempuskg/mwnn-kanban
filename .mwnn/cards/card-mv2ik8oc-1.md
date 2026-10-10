---
id: card-mv2ik8oc-1
title: Add a per-card Stop AI run button to the board webview
column: col-mqwk2njn-1
position: 2000
assignee: { kind: ai }
createdAt: 1791643972377
updatedAt: 1791643972377
---

## Description
Today `mwnn-kanban.stopCardRun` (Stop Card AI Run) can only be reached from the palette, even though the board already shows a "<provider> running" chip on the card whose CLI run is live. Add a Stop control to that running card in `media/board.js`. It should post a new `stopCardRun` message with `cardId`, and `src/boardPanel.ts` should abort only that card's entry in `activeCardCliRuns`; the palette command still aborts all runs. Update the shared message-protocol types on both sides. Decision record: wiki/command-ui-surfaces.md (from card-mv2h1yip-1).

## Acceptance criteria
- [ ] A Stop button appears on a card only while that card has a live CLI run and `mwnn-kanban.enableRunWithAI` is on
- [ ] Clicking it aborts only that card's run and leaves other active card runs and the AI loop untouched
- [ ] The palette command `mwnn-kanban.stopCardRun` behaves as before
- [ ] Message types are updated on both the host and webview sides, and a unit test covers per-card abort routing
- [ ] Development Host smoke test: start a card run, stop it from the card, and see the running chip clear

## Activity
- 2026-10-10 Claude Code: created from the command UI audit (card-mv2h1yip-1)
