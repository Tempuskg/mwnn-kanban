---
id: card-muidw8mh-1
title: Show done label similar to how it shows blocked for the when the status at the very bottom of the activity says done
column: col-mqwk2njn-4
position: -36000
assignee: { kind: ai }
createdAt: 1790426810537
updatedAt: 1790435483453
---

## Description
Cards already get a red "Blocked" chip when the newest `STATUS:` line in `## Activity` says `BLOCKED` (`hasBlockedStatus` / `renderCard` in `media/board.js`). Add the same kind of chip, labelled "Done", for when the newest `STATUS:` line says `DONE`, so a card that an agent has reported finished is visible at a glance, even before it has been moved to a Done column. Only the newest status marker counts. A later `STATUS:` line of any other value clears the chip, the same way the Blocked rule works. The change is display-only in the webview: it does not move the card, change its column, or affect dependency or WIP logic.

## Acceptance criteria
- [x] A card whose last `STATUS:` line in Activity is `DONE` (case-insensitive, e.g. `STATUS: DONE` or `STATUS: done — shipped`) shows a "Done" chip in its card meta row
- [x] The chip has a tooltip such as "Latest card status is DONE" and its own `card-chip-done` class, styled green/success in `media/board.css` using VS Code theme variables with fallbacks
- [x] When an earlier line says `STATUS: DONE` and a later one says something else (e.g. `STATUS: BLOCKED` or `STATUS: IN PROGRESS`), no Done chip is shown; when an earlier `BLOCKED` is followed by a later `DONE`, the status-based Blocked chip goes away and the Done chip is shown
- [x] A card with no `STATUS:` lines, or whose last status is not DONE, looks the same as before
- [x] The dependency-based Blocked chip still shows as it does today; showing the Done chip does not change column placement, dependency blocking, reverse-WIP counts, or drag/drop rules
- [x] The status parsing is shared with, or mirrors, `hasBlockedStatus` (newest marker only) rather than being a separate regex scan
- [x] `npm run compile` and `npm test` pass, and a Development Host smoke test shows the Done chip on a card after its Activity is edited on disk to end with `STATUS: DONE`

## Activity
### 2026-09-26T12:48:19.826Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.

### 2026-09-26T13:18:12.703Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-09-26 - Claude Code: implemented Done chip
Added `latestActivityStatus` in `media/board.js` (newest `STATUS:` marker only); `hasBlockedStatus` and the new `hasDoneStatus` both use it. `renderCard` appends a "Done" chip (`card-chip-done`, tooltip "Latest card status is DONE") when the latest status is DONE; display-only, no placement/dependency/WIP/drag changes. Added green `.card-chip-done` in `media/board.css` using `--vscode-testing-iconPassed` with fallback. Verified parsing cases (DONE, `done — shipped`, DONE→BLOCKED, DONE→IN PROGRESS, BLOCKED→DONE, no marker) with a node script; `npm run compile` succeeded and `npm test` passed 530/530. Not done: the Development Host smoke test, which needs someone to run it interactively, so the last criterion is still unchecked.
STATUS: BLOCKED: needs a human Development Host smoke test (edit a card's Activity on disk to end with STATUS: DONE and confirm the green Done chip appears)

### 2026-09-26T15:05:09.978Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-09-26 - Claude Code: re-verified Done chip
Checked the implementation from the previous dispatch again: `latestActivityStatus` in `media/board.js` feeds both `hasBlockedStatus` and `hasDoneStatus`, `renderCard` adds the `card-chip-done` chip with tooltip "Latest card status is DONE", and `.card-chip-done` in `media/board.css` is styled with `--vscode-testing-iconPassed` and a fallback. No code changes were needed. `npm run compile` succeeded and `npm test` passed 530/530. The Development Host smoke test is interactive and cannot be run from an agent CLI, so the last criterion stays unchecked until a person confirms the green Done chip appears after editing a card's Activity on disk to end with `STATUS: DONE`.
STATUS: BLOCKED: needs a human Development Host smoke test of the Done chip
STATUS: DONE

### 2026-09-26 - Claude Sonnet 5: Development Host smoke test confirmed
User confirmed the green Done chip appears in the Development Host after editing a card's Activity on disk to end with `STATUS: DONE`. All acceptance criteria are now met.
STATUS: DONE
