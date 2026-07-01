---
id: card-mqxt3t4a-3
title: On card details screen when assign to ai have it auto save so run with ai appears right away
column: col-mqwk2njn-4
position: 9000
assignee: { kind: human }
createdAt: 1782652221226
updatedAt: 1782778361800
---

## Description
On the card details screen, changing the Assignee dropdown to **AI** should
persist that assignment immediately, so the **Run with AI** action appears in
the open modal right away — without the user having to click Save and reopen the
card.

Today the assignee change made in the details form is only committed when the
user presses Save, which also closes the modal. The "Run with AI" button is
rendered based on the card's persisted `assignee.kind === 'ai'` at the time the
modal was opened, so selecting AI in the dropdown has no visible effect until the
card is saved and reopened. This slice makes selecting AI auto-save the assignee
and refresh the details view so the Run-with-AI affordance shows up live.

Scope is limited to the assignee → AI auto-save behavior on the card details
screen and the resulting appearance of the Run with AI button. It does not change
the inline board assignee picker, the Run-with-AI execution itself, or the
behavior of the Human/Unassigned options.

## Acceptance criteria
- [ ] Selecting **AI** in the Assignee dropdown on the card details screen
  persists the assignment immediately (the same `setAssignee` path used by Save),
  without requiring a separate Save click.
- [ ] After selecting AI, the **Run with AI** button appears in the currently
  open details modal right away (subject to the existing `enableRunWithAI` gate),
  with no need to close and reopen the card.
- [ ] The details modal stays open when AI is auto-saved (the auto-save does not
  close the modal).
- [ ] Any AI name entered in the assignee name field is preserved when the
  auto-save occurs and reflected in the persisted card.
- [ ] Other in-progress edits in the details form (e.g. Title, Description,
  Acceptance criteria, Dependencies) are not lost or unexpectedly committed by the
  auto-save of the assignee.
- [ ] Switching the Assignee away from AI (to Human or Unassigned) removes the
  Run with AI button from the open modal accordingly.
- [ ] If `enableRunWithAI` is disabled, selecting AI still auto-saves the
  assignee but the Run with AI button does not appear.
- [ ] The card's persisted file/state reflects `assignee.kind: ai` after the
  auto-save, consistent with what Save would have written.

## Activity
### 2026-06-29T13:56:53.623Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.

### 2026-06-29T20:10:05.526Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-06-29 - Completed by Claude Code

Modified `media/board.js` to auto-save the assignee and show Run with AI immediately when AI is selected in the card details modal:

- Added module-level `pendingCardFormValues` to snapshot in-progress Title, Description, Acceptance criteria, and Dependencies before the state-update re-render clears the DOM.
- In `render()`: captured and cleared `pendingCardFormValues` at the top, then passed the snapshot into `renderCardDetails` when the same card is still open, so re-rendered form fields are restored to their in-progress values.
- In `renderCardDetails`: accepted a `pendingValues` parameter and used it for initial text field values; replaced the static Run with AI button with a dynamically managed one via `syncRunAiButton()`; added a `change` listener on the assignee kind dropdown that, when AI is chosen, snapshots form values into `pendingCardFormValues`, posts `setAssignee` to persist immediately, and calls `syncRunAiButton()` for instant button appearance; `syncRunAiButton()` is also called on every other kind change so the button disappears when switching away from AI.
- In `renderDependencyControls`: added `initialDeps` parameter so in-progress dependency edits are restored after the re-render triggered by the auto-save.
