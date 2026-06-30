---
id: card-mqxtem66-5
title: Remove Column subtitle
column: col-mqwk2njn-4
position: 2000
assignee: { kind: human }
createdAt: 1782652725438
updatedAt: 1782787401154
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

### 2026-06-30T00:13:55.265Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-06-30 - Completed by Claude Code
Removed the `subtitle` `<p>` element and its append from `renderColumnDetails` in [media/board.js](media/board.js) (lines 994–998 → replaced with a single `titleBlock.append(title)`). The card detail modal subtitle at line 583–585 is untouched, and `.card-modal-subtitle` remains in CSS since it is still referenced there.
