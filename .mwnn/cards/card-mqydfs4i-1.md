---
id: card-mqydfs4i-1
title: allow dropping a card on column header and it adds to the top of the column unless it is a reverse-wip column then add to the bottom
column: col-mqwk2njn-4
position: 2000
assignee: { kind: human }
createdAt: 1782686372130
updatedAt: 1782788184693
---

## Description
Make a column's header (`.column-header`) act as a drop target during card drag-and-drop, in addition to the existing `.cards` container. Today a card can only be dropped into the cards list, where the insertion index is derived from the pointer's Y position (`indexFromDropEvent`). Dropping onto the header currently does nothing, which is a frustrating dead zone — the most natural "just put it in this column" gesture.

When a card is dropped on a column header, it should be placed at a fixed end of the column rather than at a pointer-derived index:

- For a normal column, insert the card at the **top** (index `0`).
- For a **reverse-WIP column** (a column that has a `reverseWip` minimum configured — currently the `ready` role column), insert the card at the **bottom** (the end of the column's card list).

The rationale: reverse-WIP columns are filled toward a minimum and consumed from the front, so a newly added card belongs at the back of the queue, whereas in a normal column a freshly dropped card should surface at the top.

The header drop must respect the same blocked-card rules as the existing cards-list drop (`canDropCardInColumn`), giving the same visual `drag-over` / `drop-blocked` feedback, and must dispatch the same `moveCard` message with the computed `toIndex`.

## Acceptance criteria
- [ ] The column header (`.column-header`) is wired as a drop target so a dragged card can be released anywhere over the header, not only over the `.cards` list.
- [ ] Dropping a card on the header of a normal (non-reverse-WIP) column inserts it at the top of that column (`toIndex` = 0).
- [ ] Dropping a card on the header of a reverse-WIP column (a column with a numeric `reverseWip` configured) inserts it at the bottom of that column (`toIndex` = current card count).
- [ ] The header drop reuses `canDropCardInColumn`: a blocked card that may not advance is rejected and snaps back, identical to the cards-list behavior.
- [ ] Dragging a card over a header shows the same hover feedback (`drag-over` when droppable, `drop-blocked` when not), and the feedback clears on `dragleave` and after `drop`.
- [ ] A successful header drop dispatches a `moveCard` message with the correct `cardId`, `toColumnId`, and `toIndex`, and the card persists in the new position after reload.
- [ ] Dropping into the `.cards` list continues to work as before, with the index still derived from pointer position (no regression).
- [ ] Dropping a card onto the header of the column it already belongs to reorders it to the top (normal) or bottom (reverse-WIP) of that same column rather than being treated as a no-op or duplicated.

## Activity
### 2026-06-29T21:01:34.695Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.

### 2026-06-30T02:46:26.190Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-06-29 - Implemented header drop target (Claude Code)
Generalized `wireDropTarget` in [media/board.js](../../media/board.js) to take a `resolveIndex(event)` callback instead of always deriving the index from the pointer. The `.cards` list keeps its pointer-based `indexFromDropEvent`, so the existing list-drop behaviour is unchanged. Wired the `.column-header` as a second drop target in `renderColumn`, resolving the index to `column.cards.length` (bottom) when the column has a numeric `reverseWip`, otherwise `0` (top). Both targets share the same `canDropCardInColumn` gate, `drag-over`/`drop-blocked` hover feedback, dragleave/drop cleanup, and `moveCard` dispatch. `moveCard` (src/utils.ts) splices the card out first then clamps `toIndex` to the post-removal length, so passing the full card count lands the card at the bottom in both same-column and cross-column drops. Added `.column-header.drag-over` / `.column-header.drop-blocked` selectors to [media/board.css](../../media/board.css) so the header shows identical feedback. All 79 unit tests pass.
