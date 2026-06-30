---
id: card-mqxtem66-5
title: Remove Column subtitle
column: col-mqwk2njn-3
position: 1000
assignee: { kind: ai }
createdAt: 1782652725438
updatedAt: 1782778390809
---

## Description
The column detail modal renders a subtitle line beneath the column title (e.g. "3 cards in active flow"), built in `renderColumnDetails` in [media/board.js](media/board.js#L966-L968) as a `<p class="card-modal-subtitle">`. This slice removes that subtitle from the column modal so only the column title is shown in the header.

Scope is the column modal only — the unrelated card detail modal subtitle ("Currently in …") at [board.js:579-581](media/board.js#L579-L581) must be left untouched, along with its shared `.card-modal-subtitle` style if still used elsewhere.

## Acceptance criteria
- [ ] The `subtitle` `<p>` element and its append to `titleBlock` are removed from the column detail modal in [media/board.js](media/board.js#L966-L970).
- [ ] The column detail modal renders with only the column title in the header; no "N card(s) in … flow" line appears.
- [ ] The card detail modal still shows its "Currently in {column}" subtitle (unaffected by this change).
- [ ] The `.card-modal-subtitle` CSS rule is left in place if still referenced by the card modal; if no longer referenced anywhere, it is removed.
- [ ] No console errors occur when opening and closing the column detail modal.

## Activity
### 2026-06-29T14:19:17.417Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.
