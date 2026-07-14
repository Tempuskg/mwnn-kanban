---
id: card-mqz5b58o-1
title: On card details screen have the dependenccy dropdown select auto add the dependency. Remove the add dependency button.
column: col-mqwk2njn-4
position: 8000
assignee: { kind: human }
createdAt: 1782733185096
updatedAt: 1782823731985
---

## Description
On the card details screen, the Dependencies editor currently requires two steps to add a dependency: pick a card from the dropdown, then click a separate "Add" button. This card streamlines that interaction so that choosing a card from the dropdown immediately adds it as a dependency, and removes the now-redundant "Add" button.

The change is confined to the dependency editor in `renderDependencyControls` in [board.js](media/board.js#L831). When the user selects a card option from the `select` element, the card should be added to the working dependency list (the same logic the "Add" button currently performs), the list and the dropdown options should re-render, and the dropdown should reset back to its placeholder so it is ready for the next selection. The "Add" button element and its related CSS should be removed. Existing behavior must be preserved: a card cannot depend on itself, the same dependency cannot be added twice, already-selected cards are filtered out of the dropdown, and changes are only persisted when the card is saved.

## Acceptance criteria
- [ ] Selecting a card from the Dependencies dropdown immediately adds it to the card's dependency list (no extra click required).
- [ ] The "Add" dependency button is removed from the dependency editor UI.
- [ ] After a selection is added, the dropdown resets to its placeholder ("Choose a card…") so the next card can be selected.
- [ ] After a selection is added, the dependency list and the dropdown options re-render so the newly added card no longer appears in the dropdown.
- [ ] A card still cannot be added as a dependency of itself, and a card cannot be added as a dependency more than once.
- [ ] Selecting the disabled placeholder option does not add a dependency or otherwise change the list.
- [ ] When no other cards are available, the dropdown is disabled and shows "No other cards available".
- [ ] Existing dependencies can still be removed via the × button on each dependency chip.
- [ ] Dependency changes are still only committed when the card is saved (a `setDependencies` message is posted only on save when the dependency set has changed).
- [ ] Any CSS rules specific to the removed Add button (e.g. `.card-dep-add`) are cleaned up in [board.css](media/board.css) and no leftover/broken layout remains in the dependency controls.

## Activity
### 2026-06-30T11:44:30.926Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.

### 2026-06-30T12:36:10.364Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-06-30 - Completed by Claude Code
Reworked the dependency editor in `renderDependencyControls` (media/board.js) so selecting a card from the dropdown immediately adds it as a dependency. Removed the separate "Add" button element and its `click` handler, moving that logic into a `change` listener on the `select`. The guard logic (no self-dependency, no duplicates) is preserved; `renderList()`/`renderOptions()` still re-render after a selection, and `renderOptions()` resets the dropdown to its placeholder. The empty-state still disables the select and shows "No other cards available". Removed the now-unused `.card-dep-add` CSS rules (base, hover, disabled) from media/board.css; the `.card-deps-controls` flex layout remains intact with the single full-width select. Dependency changes are still only committed on save. No remaining references to `addButton`/`card-dep-add`.
