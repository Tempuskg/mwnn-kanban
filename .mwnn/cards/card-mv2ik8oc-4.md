---
id: card-mv2ik8oc-4
title: Make My Work timer and focus controls state-aware and surface Stop Focus Session
column: col-mqwk2njn-1
position: 5000
assignee: { kind: ai }
createdAt: 1791643972377
updatedAt: 1791643972377
---

## Description
Right now, Start Timer and Stop Timer both appear inline on every My Work card, whatever the timer state. Stop Focus Session can be reached only from the palette, even though Start Focus Session is one click away. This card fixes both, as decided in wiki/command-ui-surfaces.md (from card-mv2h1yip-1):
- The Pro module should give a card's tree item a state-specific `contextValue`, for example `mwnn-kanban.card` or `mwnn-kanban.card.timing`. Then key `startTimer` and `stopTimer` inline `when` clauses on it.
- The Pro module should set a `mwnn-kanban-pro.focusSessionActive` context key. Add `mwnn-kanban-pro.stopFocusSession` to the My Work `view/title` at `navigation@0`, when `view == mwnn-kanban.myWork && mwnn-kanban.hasProLicense && mwnn-kanban-pro.focusSessionActive`.

The Pro module is loaded from outside this repo (`src/pro/loader.ts`). If its source is not accessible, report BLOCKED with the required context-key contract rather than editing only the menus.

## Acceptance criteria
- [ ] A card without a running timer shows Start Timer but not Stop Timer, and a timing card shows Stop Timer but not Start Timer
- [ ] A Stop Focus Session icon appears in the My Work title only while a focus session is active
- [ ] Any existing `viewItem == mwnn-kanban.card` clauses still match the base contextValue, so nothing loses its menu
- [ ] Development Host smoke test: start and stop a timer, and start and stop a focus session, entirely from the My Work view

## Activity
- 2026-10-10 Claude Code: created from the command UI audit (card-mv2h1yip-1)
