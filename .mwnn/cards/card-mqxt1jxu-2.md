---
id: card-mqxt1jxu-2
title: Remove ai name from card details
column: col-mqwk2njn-4
position: 2000
assignee: { kind: human }
createdAt: 1782652116018
updatedAt: 1782744955992
---

## Description
The card details modal currently exposes a free-text name input next to the Assignee kind selector. When the kind is set to "AI", the input shows with placeholder "AI name (optional)" and that name is persisted to the card's `assignee.name` field and displayed on the card badge as `AI: <name>`. Because AI assignees don't need a distinguishing name (the system knows which AI runs the card), this name field should be removed from the UI for AI assignees. Human assignees retain their name input unchanged.

## Acceptance criteria
- [ ] Opening a card's detail modal and selecting "AI" as the assignee kind does not show the name text input.
- [ ] Selecting "Human" as the assignee kind still shows the name text input as before.
- [ ] Saving an AI-assigned card no longer persists a name on the `assignee` object (or clears any previously stored name).
- [ ] The assignee badge on the board card shows "AI" (not "AI: <name>") for AI-assigned cards, regardless of any previously stored name value.
- [ ] Existing cards that have `assignee.kind = "ai"` with a stored `name` do not display the name in the badge or the details modal.
- [ ] No TypeScript type errors are introduced (the `name` field on `Assignee` may remain optional for Human use; no schema migration is required).

## Activity
### 2026-06-29T00:49:41.052Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.

### 2026-06-29T14:41:38.225Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-06-29 - Completed by Claude Code
Made three targeted edits to `media/board.js`:
1. **Badge** (`renderAssigneeBadge`): AI assignees now always display `'AI'` — removed the `AI: <name>` conditional.
2. **Modal controls** (`renderAssigneeControls`): `syncNameVisibility` now hides the name input when kind is `'ai'` (in addition to `'unassigned'`), and the placeholder no longer varies by kind.
3. **Save path** (`readAssignee`): When kind is `'ai'`, returns `{ kind: 'ai' }` unconditionally — no name is ever persisted for AI assignees. Human assignees are unchanged.
