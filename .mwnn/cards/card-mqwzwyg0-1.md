---
id: card-mqwzwyg0-1
title: Don't wrap columns
column: col-mqwk2njn-4
position: 14000
assignee: { kind: human }
createdAt: 1782603192672
updatedAt: 1782666276164
---

## Description
The board renders its columns in a flex row (`.board-columns` in `media/board.css`) that
currently uses `flex-wrap: wrap`. When the combined width of the columns exceeds the webview
width, columns wrap onto a second (and third) row instead of staying on a single horizontal
track. This breaks the expected Kanban left-to-right flow: a "Done" column can end up sitting
below "Backlog", and the relative ordering of the pipeline becomes visually ambiguous.

This slice changes the layout so columns never wrap. Instead, the column row stays on a single
line and the board scrolls horizontally when there are more columns than fit. Each column keeps
its fixed width so it does not shrink, and the existing horizontal-scroll affordance
(`overflow-x: auto`) is what surfaces the off-screen columns. The narrow-viewport responsive
behaviour (stacking columns vertically below the small-screen breakpoint) should be preserved so
the board remains usable on a narrow sidebar.

Scope is CSS/layout only — no changes to column data, ordering logic, or the message protocol.

## Acceptance criteria
- [ ] `.board-columns` no longer wraps columns onto multiple rows (i.e. `flex-wrap: wrap` is removed or replaced with a no-wrap behaviour).
- [ ] When the total column width exceeds the available width, the board scrolls horizontally rather than wrapping, using the existing `overflow-x: auto`.
- [ ] Each column retains its fixed width and does not shrink to fit when many columns are present (columns keep `flex: 0 0` sizing / do not collapse).
- [ ] With enough columns to overflow the viewport, all columns remain on a single horizontal row and the first column stays left-aligned.
- [ ] The narrow-viewport / small-screen breakpoint still stacks columns vertically (full-width) and is not regressed by the change.
- [ ] Card drag-and-drop between columns continues to work, including dropping onto a column that is only reachable after horizontal scrolling.
- [ ] No changes to column data, ordering, or the webview message protocol; the change is limited to styling/layout.
- [ ] The existing test suite passes (`npm test`).

## Activity
### 2026-06-28T14:30:12.376Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.

### 2026-06-28T14:32:56.346Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-06-28 - Completed by Claude Code
Changed `.board-columns` in `media/board.css` from `flex-wrap: wrap` to `flex-wrap: nowrap` and
added `justify-content: flex-start` so columns stay on a single row, left-aligned, and overflow
horizontally via the existing `overflow-x: auto`. Columns already had `flex: 0 0 280px` (fixed
width, no shrink) and the small-screen breakpoint already overrides with `flex-direction: column`
+ full-width columns, so the narrow-viewport stacking is preserved. No changes to column data,
ordering, or the message protocol. All 63 tests pass via `npm test`.
