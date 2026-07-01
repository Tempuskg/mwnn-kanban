---
id: card-mr215jfc-1
title: Open Board when board is already open
column: col-mqwk2njn-2
position: 1000
createdAt: 1782907603608
updatedAt: 1782918520179
---

## Description

Make the sidebar's "Open Board" button reflect the board panel's current state
instead of always reading "Open Board". Today the button is static HTML
([sidebarView.ts](../../src/sidebarView.ts)) and its label is misleading when a
board is already open. The button should have three states driven by whether the
`BoardPanel` singleton exists and whether it is the active/focused panel:

- **Board closed** (no `BoardPanel.current`): show "Open Board"; clicking opens
  the board.
- **Board open but not focused**: relabel to "Focus Board"; clicking reveals
  the existing panel.
- **Board open and focused**: hide the button entirely (there is nothing useful
  to open or focus).

This requires the sidebar view to learn about board state changes — open, close
(dispose), and focus/blur — and update its button accordingly. The extension
host can observe these via the `BoardPanel` singleton lifecycle and the panel's
`onDidChangeViewState`, then post a message to the sidebar webview to re-render
the button. The "Import plan" button is unaffected and must remain visible in
all states. Clicking the button must still route through the existing
`openBoard()` path so the board stays a singleton (no duplicate panels).

## Acceptance criteria

- [ ] When no board panel is open, the sidebar button reads "Open Board" and
      clicking it opens the board.
- [ ] When a board panel is open but not the focused/active panel, the button
      reads "Focus Board" and clicking it reveals/focuses the existing panel
      without creating a duplicate.
- [ ] When the board panel is open and focused/active, the button is hidden.
- [ ] The button updates live as state changes: opening the board, closing
      (disposing) it, and switching focus to/away from the board all update the
      label/visibility without needing to reload the sidebar.
- [ ] The "Import plan" button remains visible and functional in every board
      state.
- [ ] Clicking the button in any state routes through the existing
      `openBoard()` singleton path (no second board webview is created).
- [ ] Sidebar layout stays stable when the button is hidden (no broken spacing
      or leftover empty control).
- [ ] Behaviour is covered by test(s) exercising the closed / open-unfocused /
      open-focused label and visibility transitions.

## Activity
### 2026-07-01T15:08:40.079Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.
