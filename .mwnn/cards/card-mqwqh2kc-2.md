---
id: card-mqwqh2kc-2
title: Have Run with AI button on collapsed card
column: col-mqwk2njn-4
position: 7000
assignee: { kind: human }
createdAt: 1782587334972
updatedAt: 1782693132448
---

## Description
Surface the "Run with AI" action directly on the collapsed card tile shown in a
column, so a user can trigger an AI run without first opening the card's detail
modal. Today the "Run with AI" button only exists in the expanded card details
footer, and only for AI-assigned cards; this slice adds an equivalent affordance
to the compact card tile rendered by `renderCard` in `media/board.js`.

The button reuses the existing `runCardWithAI` host message and the same
visibility rules: it appears only when the card is assigned to an AI and is
gated by the `mwnn-kanban.enableRunWithAI` setting, matching the behaviour of the
detail-view button. This is a UI affordance only — it does not change how an AI
run is dispatched or recorded.

## Acceptance criteria
- [ ] A collapsed card tile in a column shows a "Run with AI" control when the card's assignee kind is `ai`.
- [ ] The control is not shown on cards that are unassigned or assigned to a human.
- [ ] Clicking the control posts the existing `runCardWithAI` message for that card id, without opening the details modal.
- [ ] Triggering a run from the collapsed card produces the same result (Activity entry / handoff) as triggering it from the card details footer.
- [ ] The control is suppressed when "Run with AI" is disabled, consistent with how the detail-view button is gated by `mwnn-kanban.enableRunWithAI`.
- [ ] Interacting with the control does not start a card drag and does not trigger the card's other actions (Details/Delete).
- [ ] The control has an accessible label and is keyboard-operable, consistent with the existing card-tile action buttons.
- [ ] The existing Details and Delete actions and drag-and-drop behaviour on the collapsed card continue to work unchanged.
- [ ] `npm run compile`, `npm run lint`, and `npm test` all pass.

## Activity
### 2026-06-28T18:20:57.897Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.

### 2026-06-28T22:40:45.074Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-06-28T22:53:00.000Z - Completed by Claude Code
Added "Run with AI" button to the collapsed card tile in `renderCard` (media/board.js). The button appears only when `card.assignee?.kind === 'ai'` and `enableRunWithAI` is true. Clicking it calls `stopPropagation()` then posts `runCardWithAI`, and it sets `draggable=true` with a cancelled `dragstart` to prevent card drags from originating on it. The `enableRunWithAI` flag is now included in every `state` message from the host (`src/boardPanel.ts` reads the VS Code config and passes it as `enableRunWithAI: boolean`; `src/types.ts` updated accordingly). The detail-view "Run with AI" button in `renderCardDetails` is also gated by the same flag for consistency. All existing compile, lint, and tests pass (74/74).
