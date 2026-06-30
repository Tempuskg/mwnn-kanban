---
id: card-mqwtffhq-3
title: have delete only on details screen
column: col-mqwk2njn-4
position: 9000
assignee: { kind: human }
createdAt: 1782592297262
updatedAt: 1782694120875
---

## Description
Today every card on the board shows an inline "Delete" button on its face,
which makes accidental deletion easy and clutters the card. Move card deletion
so it lives only on the card details screen.

Remove the inline "Delete" button from the card face in the board view, then
add a delete control to the footer of the card details modal. Deleting from
details should confirm before removing (matching the existing column-delete
flow), reuse the existing `deleteCard` message, and close the modal once the
card is removed. The board's keyboard, drag, and other card actions should be
unaffected — only the delete entry point moves.

## Acceptance criteria
- [ ] The inline "Delete" button no longer appears on any card on the board face.
- [ ] Opening a card's details screen shows a clearly styled (danger) "Delete" button in the modal footer.
- [ ] Clicking "Delete" in details prompts for confirmation before deleting.
- [ ] Confirming the prompt deletes the card via the existing `deleteCard` message and the card is removed from the board.
- [ ] Cancelling the prompt leaves the card unchanged and keeps the details modal open.
- [ ] After a successful delete the details modal closes automatically.
- [ ] The delete button has an accessible label (e.g. `aria-label`) identifying the card it deletes.
- [ ] Remaining card-face actions (Details, drag/drop, assignee picker) continue to work unchanged.
- [ ] Existing tests pass and any tests asserting an inline card delete button are updated to reflect the new location.

## Activity
### 2026-06-28T22:35:47.240Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.

### 2026-06-29T00:43:59.201Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-06-29T01:04:00.000Z - Completed by Claude Code
Removed the inline "Delete" button from `renderCard` in `media/board.js` — the button element and its `actions.append(details, del)` were replaced with `actions.append(details)`. Added a `card-modal-danger`-styled "Delete" button to the `renderCardDetails` footer that prompts `window.confirm()` before posting `deleteCard` and calling `closeCardDetails()`. The button carries an `aria-label` identifying the card by title. All 74 existing tests continue to pass.
