---
id: card-mqxsv6jq-1
title: Keep a blocked card on the Backlog column
column: col-mqwk2njn-4
position: 21000
assignee: { kind: human }
createdAt: 1782651818726
updatedAt: 1782686093192
dependsOn: [card-mqwqg1y4-1]
---

## Description
Enforce the dependency relationship introduced in "Have the option to have a card
dependent on 1 or more cards" so that a blocked card cannot leave the Backlog
column. A card is "blocked" when it has one or more dependencies that are not yet
in a "done" column. While a card is blocked, any attempt to move it to another
column (Ready, In Progress, Done, or any custom column) is rejected and the card
stays in Backlog; once all of its dependencies are complete, it can be moved
freely again.

This slice is enforcement only: it builds on the existing dependency data model
and blocked indicator and adds the move guard plus user-visible feedback when a
move is refused. Cards with no dependencies, and cards whose dependencies are all
done, are unaffected. The guard must hold for both drag-and-drop in the webview
and the `moveCard` message handled on the extension host, so the rule cannot be
bypassed by either path.

## Acceptance criteria
- [ ] A card with one or more dependencies not in a "done" column is treated as blocked and cannot be moved out of the Backlog column.
- [ ] Attempting to drag a blocked card from Backlog to any other column leaves the card in Backlog (the move is not applied to the board state).
- [ ] The `moveCard` host handler rejects a move of a blocked card to a non-Backlog column even if the message is sent directly, so the webview and host both enforce the rule.
- [ ] Reordering a blocked card within the Backlog column is still allowed.
- [ ] When all of a card's dependencies are in a "done" column, the card is no longer blocked and can be moved to any column normally.
- [ ] A card with no dependencies can be moved between columns without restriction.
- [ ] When a move is refused because the card is blocked, the user receives clear feedback (e.g. a notification or message) explaining that the card is blocked by unfinished dependencies.
- [ ] The refused move does not corrupt board state or position ordering, and the board reflects the unchanged positions after a reload.
- [ ] `npm run compile`, `npm run lint`, and `npm test` all pass, with test coverage for a blocked card being kept on Backlog and an unblocked card moving freely.

## Activity
### 2026-06-28T13:03:58.627Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.
