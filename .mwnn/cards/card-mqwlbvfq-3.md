---
id: card-mqwlbvfq-3
title: Move column movement arrows to Column edit screen
column: col-mqwk2njn-4
position: 20000
assignee: { kind: ai }
createdAt: 1782578694374
updatedAt: 1782604189540
---

## Description
Move column movement arrows to Column edit screen

## Acceptance criteria
Column movement arrows are on the Column edit screen

## Activity
### 2026-06-27T23:40:03.807Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-06-27 - Completed by Claude Code
Moved the column movement arrows out of the column header and into the Column edit screen.
- Removed the ← / → buttons from `renderColumnActions` in [media/board.js](media/board.js); the header now only shows the "Column" edit button.
- Added a new `renderColumnMoveControls` helper that renders "← Move left" / "Move right →" buttons (plus a "Column N of M" position hint) inside the Column edit dialog (`renderColumnDetails`). Buttons are disabled at the ends and post the existing `reorderColumn` message; the dialog stays open and reflects the new position after reordering.
- Added `.column-move-row` styling in [media/board.css](media/board.css).
- Verified: `npm run compile` succeeds and all 57 unit tests pass.
