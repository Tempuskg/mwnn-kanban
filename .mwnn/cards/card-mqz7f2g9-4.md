---
id: card-mqz7f2g9-4
title: Filter out cards that are Done from the add Card dependency dropdown
column: col-mqwk2njn-4
position: 3000
assignee: { kind: human }
createdAt: 1782736727337
updatedAt: 1782841978427
---

## Description
When editing a card's dependencies, the "add dependency" dropdown currently lists every other card on the board regardless of which column it sits in. Adding a dependency on a card that is already finished is pointless: a dependency only blocks a card until its target reaches a Done-role column, so a card already in a Done column is immediately satisfied and adds clutter and confusion to the picker.

This slice changes the dropdown that builds the list of selectable dependency targets (the `renderOptions` / `otherCards` logic in `renderDependencyControls`) so that cards living in a column whose `role === 'done'` are excluded from the available options. Cards that are already listed as existing dependencies continue to be excluded as they are today, and the card being edited is still excluded from its own list. Existing dependencies that happen to point at a Done card remain displayed in the current-dependencies list (this only affects what can be newly added).

## Acceptance criteria
- [ ] The add-dependency dropdown in the card editor excludes any card whose column has `role === 'done'`.
- [ ] Cards in non-Done columns (e.g. Backlog, In Progress) still appear as selectable options.
- [ ] The card currently being edited is still excluded from its own dependency dropdown.
- [ ] Cards already added as dependencies remain excluded from the dropdown (existing behaviour preserved).
- [ ] When no eligible (non-Done, not-yet-added) cards remain, the dropdown shows the existing "No other cards available" placeholder and is disabled.
- [ ] If a card already depends on a card that is in a Done column, that dependency still shows in the current-dependencies list and can still be removed.
- [ ] Moving a card into or out of a Done column updates whether it appears in the dropdown the next time the dependency controls are rendered.
- [ ] No regression: selecting an option still adds the dependency, and the dependency list and dropdown re-render correctly afterward.

## Activity
### 2026-06-30T12:49:11.998Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.

### 2026-06-30T14:20:54.124Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-06-30 - Completed by Claude Code
Updated `otherCards()` inside `renderDependencyControls` in [media/board.js](media/board.js) to skip any column whose `role === 'done'`, so cards in Done columns are no longer offered in the add-dependency dropdown. Cards in non-Done columns, self-exclusion, and already-added dependency exclusion are all preserved (the latter via the existing `deps.includes()` filter in `renderOptions`). Because `otherCards()` is re-evaluated on every `renderOptions()` call, moving a card in/out of a Done column updates the dropdown on the next render, and the "No other cards available" placeholder/disabled state still applies when no eligible cards remain. Existing dependencies are tracked separately in the `deps` array and rendered by `renderList()`, so a dependency pointing at a Done card still shows and can be removed.
