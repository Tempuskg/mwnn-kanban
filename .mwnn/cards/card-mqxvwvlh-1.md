---
id: card-mqxvwvlh-1
title: allow user to zoom in and out on board
column: col-mqwk2njn-2
position: 2000
createdAt: 1782656936693
updatedAt: 1782744985957
---

## Description
Add the ability for the user to zoom the board view in and out so they can either fit more columns/cards on screen at once (zoom out) or enlarge content for readability (zoom in). Zoom scales the rendered board (columns and cards) without altering the underlying card data, layout logic, or stored positions.

Provide multiple ways to trigger zoom (e.g. on-screen zoom controls and/or Ctrl/Cmd + mouse wheel and keyboard shortcuts), enforce sensible min/max limits, and include a way to reset to 100%. The current zoom level should persist for the board so it is restored when the webview is reopened.

## Acceptance criteria
- [ ] On-screen zoom controls (zoom in, zoom out, and reset/100%) are visible on the board and clearly labelled.
- [ ] Clicking zoom in increases the board scale by a consistent step; clicking zoom out decreases it by the same step.
- [ ] Ctrl/Cmd + mouse wheel zooms the board in and out.
- [ ] Keyboard shortcuts zoom in (Ctrl/Cmd + "+"), zoom out (Ctrl/Cmd + "-"), and reset to 100% (Ctrl/Cmd + "0").
- [ ] Zoom is clamped to a minimum and maximum level (e.g. 50%–200%) so the board cannot be scaled to an unusable size.
- [ ] A reset action returns the board to 100% zoom.
- [ ] The current zoom percentage is displayed to the user.
- [ ] Zooming scales columns and cards visually but does not change card content, column membership, or stored card positions.
- [ ] All existing board interactions (drag-and-drop, opening/editing cards, column actions) continue to work correctly at non-100% zoom levels.
- [ ] The chosen zoom level persists and is restored when the board webview is closed and reopened.

## Activity
### 2026-06-29T14:56:25.853Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.
