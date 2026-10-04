---
id: card-mukh8zym-1
title: When clicking on the needs definition have the fill with AI come up
column: col-mqwk2njn-4
position: -50000
assignee: { kind: ai }
preferredModel.copilot: claude-haiku-4.5
preferredModel.codex: gpt-5.5
preferredModel.claude-code: sonnet
thinkingLevel.copilot: high
thinkingLevel.codex: medium
thinkingLevel.claude-code: medium
createdAt: 1790553377038
updatedAt: 1791156417056
---

## Description
Make the "Needs definition" chip on a board card (rendered in `media/board.js` via `renderChip('Needs definition', 'card-chip-warning')`) clickable, so clicking it offers the existing "Fill with AI" definition flow instead of doing nothing. Today the only entry points are the "Fill in with AI" button in the card details modal and the host-side prompt shown when a card lands in Ready (`maybeOfferDefinition` in `src/boardPanel.ts`).

Clicking the chip should open the card details and surface the Fill-with-AI action, reusing the existing `fillCardDefinition` webview→host message and `deps.fillCardDefinition` handler — no new definition pipeline. Because webviews block `window.confirm`, any confirmation prompt must be shown on the extension host (e.g. a `showInformationMessage` with "Fill with AI" / "Not now", like `maybeOfferDefinition`). If a new message type is needed, update the shared protocol in `src/types.ts` (union + validator) on both sides.

## Acceptance criteria
- [x] The "Needs definition" chip is rendered as an interactive control (button or `role="button"` with `tabindex="0"`), shows a pointer cursor and a tooltip such as "Fill in Description and Acceptance criteria with AI", and is keyboard-activatable with Enter/Space.
- [x] Clicking the chip does not start a card drag and does not trigger the card's own click/double-click handlers (event propagation is stopped).
- [x] Clicking the chip opens the card details for that card and presents the Fill-with-AI choice; accepting it invokes the same `fillCardDefinition` handler used by the modal's "Fill in with AI" button, and declining leaves the card unchanged.
- [x] Any confirmation is shown via a VS Code host notification/quick pick, not `window.confirm`/`alert`/`prompt` in the webview.
- [x] Cards that are already defined show no chip and are unaffected; the existing modal "Fill in with AI" button and Ready-column offer keep working.
- [x] Any new or changed webview↔host message is added to `src/types.ts` and accepted by its message validator, with a unit test covering it.
- [x] `npm run compile-tests`, `npm run compile`, `npm test`, and `npm run lint` pass.
- [x] Development Host smoke test: clicking "Needs definition" on an undefined card brings up Fill with AI, and accepting it hands the card off for definition.

## Activity
### 2026-10-04T23:07:18.642Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.

### 2026-10-04T23:07:54.165Z - Run settings recommended by Jev
Jev (TypeSafe) judged this card's difficulty tier: **standard**.

- copilot: model `claude-haiku-4.5`, thinking level `high`
- codex: model `gpt-5.5`, thinking level `medium`
- claude-code: model `sonnet`, thinking level `medium`

### 2026-10-04T23:09:49.260Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-10-04 Claude Code
Ran as `sonnet` (Sonnet 5.5). Made the "Needs definition" chip a `role="button"`, `tabindex=0` control with pointer cursor, tooltip, Enter/Space activation, and stopped propagation (`media/board.js`, `media/board.css`). It posts a new `offerCardDefinition` message (`src/types.ts` union + validator, covered in `test/unit/protocol.test.ts`). The host (`src/boardPanel.ts` `offerDefinition`, now shared with `maybeOfferDefinition`) opens the card details and shows a "Fill with AI" / "Not now" notification, then calls the existing `deps.fillCardDefinition`. `compile-tests`, `compile`, `npm test` (594 pass), and `lint` pass. The Development Host smoke test was not run (no interactive host available), so that criterion stays unchecked.
STATUS: BLOCKED: Development Host smoke test needs a human to run it; all code and automated checks are done.

### 2026-10-04 Claude Code
The user confirmed the Development Host smoke test: clicking "Needs definition" brings up Fill with AI and accepting it hands the card off for definition. All acceptance criteria are now met.
STATUS: DONE
