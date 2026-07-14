---
id: card-mqwlnvup-7
title: on board allow clicking on Unassigend choose to assign it to human or ai
column: col-mqwk2njn-4
position: 23000
assignee: { kind: human }
createdAt: 1782579254785
updatedAt: 1782670770284
---

## Description
On the board, the assignee badge on each card currently shows a static "Unassigned" chip when no assignee is set, and the only way to assign a card is by opening the Details modal. This slice makes the "Unassigned" chip directly actionable: clicking it from the board surfaces a quick choice to assign the card to a Human or to AI without opening Details.

Clicking the chip opens a lightweight inline menu/picker offering "Human" and "AI". Selecting one sends the existing `setAssignee` message (`assignee.kind` = `human` or `ai`, with no name required) so the card is persisted and the board re-renders showing the new Human/AI badge. This reuses the current assignee data model and message protocol — no new card fields are introduced. The interaction only applies to cards that are currently unassigned; already-assigned cards continue to be edited via Details (out of scope here).

## Acceptance criteria
- [ ] The "Unassigned" chip on a board card is rendered as an interactive control (clickable, keyboard-focusable, with an accessible label such as "Assign card").
- [ ] Clicking/activating the "Unassigned" chip opens an inline picker offering exactly two choices: "Human" and "AI".
- [ ] Choosing "Human" assigns the card with `assignee.kind === 'human'`; choosing "AI" assigns it with `assignee.kind === 'ai'`.
- [ ] Assignment is performed by sending the existing `setAssignee` message (`{ type: 'setAssignee', cardId, assignee }`); no new message type or card field is added.
- [ ] After choosing, the board re-renders so the chip shows the correct Human/AI badge (`card-chip-human` / `card-chip-ai`) and the change is persisted to the card markdown file.
- [ ] The picker can be dismissed without making a change (e.g. clicking outside or pressing Escape), leaving the card unassigned.
- [ ] The picker is reachable and operable via keyboard, and the chip control does not trigger card drag or open the Details modal when activated.
- [ ] Existing assigned badges are unaffected, and the Details modal assignee controls continue to work as before.

## Activity
### 2026-06-28T12:24:58.963Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.

### 2026-06-28T17:17:11.266Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-06-28 - Implemented by Claude Code
Made the board's "Unassigned" chip directly actionable (webview-only change; no new message types or card fields).
- `media/board.js`: `renderAssigneeBadge` now takes the whole card; when unassigned it renders `renderUnassignedControl`, a focusable `<button>` chip (class `card-chip-assign`, `aria-label="Assign card"`, `aria-haspopup="menu"`). Activating it opens `openAssignPicker`, an inline `role="menu"` with exactly two items, Human and AI. Choosing one posts the existing `{ type: 'setAssignee', cardId, assignee: { kind } }` and the board re-renders into the `card-chip-human` / `card-chip-ai` badge. The picker dismisses on outside click or Escape (restoring focus to the chip) and supports Arrow/Escape keyboard nav; `render()` closes any open picker to avoid leaks. The chip is its own cancelled drag source so activating it never starts a card drag or opens Details. Assigned badges and the Details modal assignee controls are untouched.
- `media/board.css`: styling for `.card-chip-assign` (hover/focus) and the `.assign-picker` / `.assign-picker-option` popover.
Validation: `npm test` (63/63 pass) and `npm run build:production` both green.

### 2026-06-28 - Follow-up: re-assignment from the board
Extended the chip so already-assigned cards are also clickable to switch assignee. `renderAssigneeBadge` now always renders the interactive `card-chip-assign` button (muted/AI/Human variants) with an accessible "Change assignee (currently …)" label. The inline picker offers Human and AI, plus an "Unassigned" option when the card is already assigned; options use `role="menuitemradio"` with `aria-checked`, the current choice is marked with a ✓ and gets initial focus, and selecting the current assignee is a no-op that just dismisses. Switching kind reuses the same `setAssignee` message (clearing posts `setAssignee` with no assignee). CSS keeps colored chip hues on hover and styles the checked option. `npm test` (63/63) and production build both pass.
