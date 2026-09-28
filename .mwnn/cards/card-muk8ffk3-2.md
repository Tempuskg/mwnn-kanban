---
id: card-muk8ffk3-2
title: fix the effort dropdown on the mwnn kanban card to show all levels when a level is already selected
column: col-mqwk2njn-4
position: -40000
assignee: { kind: ai }
createdAt: 1790538560643
updatedAt: 1790549477773
---

## Description
The card editor's "Thinking" (effort) field in `media/board.js` (`renderPreferredModelControls`) is backed by a native `<datalist>`. Browsers filter a datalist's options against the input's current value, so when a card already has a thinking level set for the selected CLI (e.g. `high`), opening the dropdown shows only that one entry (or nothing) instead of the full level list for that provider. The model field already solved this same problem by replacing its datalist with a custom menu (`openModelPicker`) that always offers the whole list and narrows only on text typed after opening. Give the effort field the same behavior: whatever value the field holds, opening its list shows every configured level for the selected provider (from `thinkingLevelSuggestions`). The field stays free text, so levels that are not listed can still be typed and saved. Webview-only change; the extension-host message protocol is unchanged.

## Acceptance criteria
- [x] With a card whose `thinkingLevel.<provider>` is already set (e.g. `high`), opening the Thinking dropdown for that provider lists every level configured for it in `mwnn-kanban.agentCliThinkingLevels`, not just the matching one
- [x] With the Thinking field blank, the dropdown still lists every configured level for the selected provider
- [x] The list narrows only on text the user types after opening, never on the value already saved on the card
- [x] The currently saved level is visibly marked as selected in the list
- [x] Picking a level from the list sets the field and saves it as `thinkingLevel.<provider>` through the existing `setThinkingLevel` message; clearing the field still removes the key
- [x] Free text is still accepted: a level not in the list can be typed and is saved as typed
- [x] Switching the provider selector refreshes the list to that provider's levels; with no levels configured, the control explains that and does not show a broken or empty popup
- [x] The dropdown works from the keyboard (open, arrow through options, Enter to pick, Escape to close) and closes on outside click, matching the model picker
- [ ] `npm run compile`, `npm test`, and `npm run lint` pass, and a Development Host smoke test confirms the behavior on a card with and without a saved level

## Activity
### 2026-09-27T22:32:42.270Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.

### 2026-09-27T22:35:33.517Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-09-27 - Claude Code: implementation
Replaced the Thinking field's native `<datalist>` in `media/board.js` (`renderPreferredModelControls`) with a combo box (field + ▾ button) that opens the same custom menu as the model field. `openModelPicker` now takes an optional wording config (`MODEL_PICKER_COPY` / `THINKING_PICKER_COPY`), so the thinking menu always lists every level in `thinkingLevelSuggestions` for the selected provider, narrows only on text typed after opening, marks the saved level `aria-checked`, offers "Use <CLI>'s default effort" to clear it, and explains when no levels are configured (no settings link, because the only settings message opens the model setting). Picking or typing goes through the existing `captureThinkingInput` drafts, so saving still posts `setThinkingLevel` unchanged, and free text is still saved as typed. Toggling is per field, so opening one ▾ closes the other's menu. Keyboard behavior matches the model picker: ArrowDown opens, arrow keys move, Enter picks, Escape closes, and an outside click closes. Added CSS so the narrow thinking menu anchors to the right edge. Added 2 unit tests in `test/unit/cardModelSuggestions.test.ts`. `npm run compile-tests`, `npm run compile`, `npm test` (549 pass), `npm run lint`, and `node --check media/board.js` all pass. Not done: a Development Host smoke test. That needs someone to use the running UI, so the last criterion stays unchecked.
STATUS: BLOCKED: needs a human Development Host smoke test of the Thinking dropdown on a card with and without a saved level; all code checks pass
