---
id: card-mqxt3t4a-3
title: On card details screen when assign to ai have it auto save so run with ai appears right away
column: col-mqwk2njn-2
position: 2000
createdAt: 1782652221226
updatedAt: 1782741413704
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
