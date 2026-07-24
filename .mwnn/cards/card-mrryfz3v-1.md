---
id: card-mrryfz3v-1
title: When pressing close button and there are changes to the card ask to save the changes
column: col-mqwk2njn-4
position: -3000
assignee: { kind: human }
createdAt: 1784475172219
updatedAt: 1784475953802
---

## Description
When a card has unsaved edits, pressing its close button should prompt the user to save, discard, or cancel before the card is closed. Closing an unchanged card should continue without a prompt.

## Acceptance criteria
- [ ] Pressing the close button for a card with unsaved changes displays a save-changes prompt.
- [ ] Choosing Save persists the card changes and then closes the card.
- [ ] Choosing Discard closes the card without persisting the unsaved changes.
- [ ] Choosing Cancel, or dismissing the prompt, leaves the card open with its unsaved changes intact.
- [ ] Pressing the close button when the card has no unsaved changes closes it without displaying a prompt.

## Activity
### 2026-07-19T15:33:09.758Z - Definition requested from Codex (ChatGPT)
Asked Codex (ChatGPT) to fill in the Description and Acceptance criteria for this card.

### 2026-07-19T15:34:19.476Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.

### 2026-07-19T15:40:14.897Z - Implemented by Codex (ChatGPT)
Added a webview unsaved-changes prompt for card Close and backdrop actions with Save, Discard, Cancel, Escape, and outside-click dismissal. Save reuses the existing card persistence flow; Discard and dismissal keep edits local or intact, and unchanged cards close directly. Removed eager AI-assignee persistence so it also respects Save/Discard. Validation: `node --check media/board.js`, `npm.cmd run compile`, `npm.cmd run compile-tests`, and `npm.cmd run lint` passed; `npm.cmd test` passed 152/153 tests with one unrelated existing `planImporter` failure (`utils.importCards` is missing).
### 2026-07-19T18:14:36.658Z - Updated AI loop WIP admission
Updated the AI loop to honor destination WIP limits, replenish Ready until its reverse-WIP minimum is met, and defer implementation while workable backlog cards remain. Human-owned and dependency-blocked backlog cards do not count as available work. Added focused regression coverage; compile, focused tests, and lint pass, with the existing unrelated `planImporter` failure remaining in the full suite.
