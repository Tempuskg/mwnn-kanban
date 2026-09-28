---
id: card-muk8egcq-1
title: the model selection drop down on the mwnn kanban card isn't working
column: col-mqwk2njn-4
position: -38000
assignee: { kind: ai }
createdAt: 1790538515018
updatedAt: 1790542850382
---

## Description
The "Preferred AI model and thinking level per CLI" control in the card details form (`renderPreferredModelControls` / `openModelPicker` in `media/board.js`) does not work as a dropdown. The ▾ suggest button is the only way to open the model list, and it disables itself when `modelSuggestionsFor` returns nothing for the selected CLI. `mwnn-kanban.agentCliModels` defaults to `{}`, so on a default install every CLI has an empty list and the button can never open. Where models are configured, the menu is appended to `document.body` and placed from `input.getBoundingClientRect()` plus the window scroll. That can put it in the wrong place or hide it behind the details panel when the board is zoomed or the form is scrolled. It is also left orphaned when a `state` push re-renders the open card.

Reproduce the reported failure in a Development Host, both with and without configured models, and fix the root cause. Opening the dropdown should always show a usable list, and picking an entry should update the card's per-provider model. The field must stay free-form: typed names are still saved unvalidated.

## Acceptance criteria
- [x] The root cause is identified and recorded in Activity (empty default catalog, picker positioning/stacking, re-render orphaning, or something else found while reproducing).
- [ ] With `mwnn-kanban.agentCliModels` configured for a CLI, clicking ▾ (or pressing ArrowDown in the model field) opens a visible menu anchored directly below the model input, at 100% zoom and at non-default board zoom, and with the details form scrolled.
- [x] Picking a model in the menu fills the input, updates the provider selector's summary text, and after Save the card file gets the matching `preferredModel.<provider>` key. Picking "Use <CLI>'s default" removes the key.
- [x] With no models configured for the selected CLI, the control no longer looks broken: either a built-in default suggestion list is offered, or the disabled state clearly tells the user to type a name or configure `mwnn-kanban.agentCliModels`, as the chosen fix requires.
- [x] Changing the provider selector closes any open menu and shows that provider's own model and thinking-level drafts, and switching back keeps unsaved edits.
- [x] A board `state` push while the menu is open leaves no orphaned or stale menu in the DOM.
- [x] Typing a model name that is not in the list is still saved exactly as typed.
- [x] Focused unit tests cover any changed pure helpers (e.g. `modelSuggestionsFor`, or suggestion defaults from `agentCliModelSuggestions`). `npm run compile-tests`, `npm run compile`, `npm test` and `npm run lint` pass.
- [ ] A Development Host smoke test confirms the dropdown opens, a pick saves, and a reload shows the saved model.

## Activity
### 2026-09-27T20:21:18.653Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.

### 2026-09-27T20:29:59.873Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-09-27 - Claude Code: model picker fixed; Dev Host smoke pending
Root cause (found by reading the code and reproducing in a jsdom harness that drives the real `media/board.js`):
1. The ▾ button was disabled whenever `modelSuggestionsFor` returned `[]`. `mwnn-kanban.agentCliModels` defaults to `{}`, so on a default install the only way to open the list was dead.
2. The menu was appended to `document.body` at absolute document coordinates, but the details form scrolls inside `.card-modal` (overflow:auto). The menu therefore stayed put while the field scrolled away. Board zoom only scales `.board-columns`, so zoom was not the cause.
3. The outside-mousedown handler treated ▾ as "outside", so clicking ▾ while the menu was open closed it and the same click reopened it.
The `state` re-render already called `closeModelPicker()`. The menu now lives inside the dialog, so it is also removed along with it.

Fix:
- `media/board.js`: the menu is now appended inside `.card-model-combo` (CSS `position: relative`, menu `top: calc(100% + 4px)`), so it scrolls with the form and ignores zoom. It calls `scrollIntoView({block:'nearest'})` when it opens.
- ▾ is never disabled. For a CLI with no configured models, the menu explains that and offers "Configure model lists in settings…". That option posts the new `openModelSettings` message (`src/types.ts`, `src/boardPanel.ts`), and the host opens settings on `mwnn-kanban.agentCliModels`.
- ▾ toggles the menu. ArrowDown with the menu open focuses the menu.
- Menu contents come from the new pure helper `modelPickerContent`. Typed names are still saved unvalidated.
- `media/board.css`: combo and menu positioning.

Tests:
- `test/unit/cardModelSuggestions.test.ts` has 5 new `modelPickerContent` tests.
- `test/unit/protocol.test.ts` now covers `openModelSettings`.

Validation:
- `npm run compile-tests`, `npm run compile`, `npm test` (535/535), `npm run lint` and `npm run smoke:card-model-picker` all pass.
- A scratchpad jsdom harness drove the real webview. It verified that ▾ and ArrowDown open the menu inside the combo and dialog, and that ▾ toggles it closed. It verified that a pick fills the field, updates the selector summary and closes the menu. It verified that changing the provider closes the menu and that per-provider model and thinking drafts survive switching back. It verified that a `state` push leaves 0 menus. On Save, "Use default" posted `setPreferredModel` with no model (the key is removed) and the typed `my-custom-byok` was posted exactly as typed. With nothing configured, ▾ is enabled, the menu explains the setting, and "Configure…" posts `openModelSettings`.

Not verified (needs a human in an Extension Development Host):
- jsdom does no layout, so the on-screen placement at non-default zoom and with the form scrolled is not visually confirmed.
- The live pick, Save and reload round trip has not been run in the Dev Host.
STATUS: BLOCKED: needs a human Extension Development Host smoke test (dropdown visible below the field at 100%/zoomed/scrolled; pick → Save → reload shows the model); all code, tests, lint and the headless DOM checks pass.
