---
id: card-mqx01qy8-2
title: Add column switch in card details view
column: col-mqwk2njn-4
position: 5000
assignee: { kind: human }
createdAt: 1782603416240
updatedAt: 1782700313386
---

## Description
Let a user move a card to a different column directly from the card details modal,
instead of having to close the modal and drag the card across the board. Today the
details view only shows a static "Currently in {column}" subtitle; this slice replaces
or augments that with an interactive column selector (e.g. a dropdown listing every
column on the board). Choosing a different column moves the card to that column and the
change is persisted.

This reuses the existing `moveCard` host message and column-move logic — it adds a new
control in the webview, not a new persistence path. The card should land in a sensible
position within the target column (e.g. appended to the end). Scope is limited to the
single-card column switch from the details view; it does not change drag-and-drop
behaviour or column configuration.

## Acceptance criteria
- [ ] The card details modal shows a column control listing all columns on the board, with the card's current column selected.
- [ ] Choosing a different column from the control moves the card into that column.
- [ ] Selecting the card's current column is a no-op (does not create a spurious move or duplicate the card).
- [ ] The move is persisted (reflected in the card's stored column) and survives a reload of the board.
- [ ] After the switch, the board view shows the card in the target column and removed from its previous column.
- [ ] The column move uses the existing `moveCard` message/operation rather than introducing a parallel path.
- [ ] The moved card is placed at a defined position in the target column (e.g. appended at the end) rather than an undefined index.
- [ ] `npm run compile`, `npm run lint`, and `npm test` all pass.

## Activity
### 2026-06-29T00:35:44.572Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.

### 2026-06-29T00:56:59.529Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-06-28 - Completed by Claude Code
Added a column selector dropdown to the card details modal in `media/board.js`.

Changes made:
- Added `renderColumnSelectorField(currentColumnId)` helper that renders a `<label>` + `<select>` listing all board columns, with the card's current column pre-selected.
- Injected the column selector into the card details form (between Title and Assignee fields).
- Extended `saveCardDetails` to check `fields.columnSelect` / `fields.currentColumnId`: if the user picked a different column, it sends `{ type: 'moveCard', cardId, toColumnId, toIndex: targetColumn.cards.length }`, appending the card at the end of the target column.
- Selecting the card's current column is a no-op (guard on `nextColumnId !== fields.currentColumnId`).
- The existing `moveCard` host handler in `boardPanel.ts` is reused unchanged, including blocked-card validation and `maybeOfferDefinition`.
- `npm run compile`, `npm run lint`, and `npm test` (74/74) all pass.
