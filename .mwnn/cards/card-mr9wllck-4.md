---
id: card-mr9wllck-4
title: change the card order design so that adding a card to a column doesn't change every card in the column
column: col-mqwk2njn-4
position: 2000
assignee: { kind: human }
createdAt: 1783383683924
updatedAt: 1783979839155
---

## Description
Redesign card ordering so a card can be added at any position in a column without rewriting the stored order value of every existing card in that column. The new ordering model must preserve the visible order across persistence and reloads while keeping routine insertions local to the added card.

## Acceptance criteria
- [ ] Adding a card to an empty column assigns it a valid order value and displays it in the intended position.
- [ ] Adding a card at the beginning, between two existing cards, or at the end of a column preserves the intended visible order after the board is saved and reloaded.
- [ ] A routine card insertion creates or updates the added card's persisted data without changing the persisted order values or files of the column's existing cards.
- [ ] Repeated insertions at the same location produce a deterministic order with no duplicate or ambiguous ordering values.
- [ ] Moving or reordering cards continues to work with the new ordering model and preserves the resulting order after reload.
- [ ] Existing persisted boards load with their current card order intact and can use the new insertion behavior without requiring a manual migration.
- [ ] Automated tests cover empty, beginning, middle, end, and repeated insertion cases and verify that unaffected cards are not rewritten during a routine insertion.

## Activity
### 2026-07-12T17:08:31.044Z - Definition requested from Codex (ChatGPT)
Asked Codex (ChatGPT) to fill in the Description and Acceptance criteria for this card.

### 2026-07-12T17:11:41.208Z - Definition requested from Codex (ChatGPT)
Asked Codex (ChatGPT) to fill in the Description and Acceptance criteria for this card.
