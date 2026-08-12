---
id: card-msq6wn4r-1
title: Add a copy card path to the card details ui
column: col-mqwk2njn-2
position: 1000
createdAt: 1786545236763
updatedAt: 1786545259236
---

## Description

Add a copy-path action to the card details UI so users can copy the workspace-relative path of the current card's backing Markdown file. The copied path must use the configured board folder and the card's id, making it easy to reference the card file elsewhere without affecting existing card-detail editing behavior.

## Acceptance criteria

- [ ] The card details UI presents a clearly labeled copy-path action for the open card.
- [ ] Activating the action copies the workspace-relative path `<configured board folder>/cards/<card-id>.md` for that card to the system clipboard.
- [ ] The copied path reflects a non-default `mwnn-kanban.boardFolder` configuration and is not hard-coded to `.mwnn/`.
- [ ] The action is operable by mouse and keyboard and exposes an accessible name.
- [ ] The UI provides observable success feedback after copying and a clear error message if clipboard access fails.
- [ ] Automated tests cover path construction, the copy action, and the success and failure feedback without regressing existing card-details behavior.

## Activity
### 2026-08-12T14:34:19.194Z - Definition requested from Codex (ChatGPT)
Asked Codex (ChatGPT) to fill in the Description and Acceptance criteria for this card.
