---
id: card-mv3rxfdn-2
title: In the open card View show the cards that are depending on this card
column: col-mqwk2njn-2
position: 1000
preferredModel.copilot: claude-haiku-4.5
preferredModel.codex: gpt-6-luna
preferredModel.claude-code: haiku
preferredModel.cursor: Gemini 3.8 Flash
thinkingLevel.copilot: medium
thinkingLevel.codex: medium
thinkingLevel.claude-code: medium
createdAt: 1791720170267
updatedAt: 1791726072387
---

## Description
The card details modal already shows a card's own **Dependencies** (the cards it is blocked by, via `renderDependencyControls` in `media/board.js`). It does not show the reverse: the cards that list this card in their `dependsOn`, i.e. the work this card is blocking. Add a read-only **Dependent cards** field to the modal, next to Dependencies, listing every card on the board whose `dependsOn` contains this card's id. Each entry is a chip with the dependent card's title. Clicking the title opens that card's details, using the same unsaved-changes guard (`requestLeave`) as the clickable dependency chips. This is display only: the list has no add or remove controls, because a dependency is edited on the card that owns it.

Scope: webview only (`media/board.js` and `media/board.css`). The data is already in the webview's `board` state, so there is no change to the message protocol or the extension host.

## Acceptance criteria
- [ ] The card details modal shows a "Dependent cards" field directly after the Dependencies field.
- [ ] It lists every card on the board, in any column including Done, whose `dependsOn` contains the open card's id, and no other cards.
- [ ] When no card depends on the open card, the field shows a short empty message (e.g. "No cards depend on this card.") rather than being hidden.
- [ ] Each entry shows the dependent card's title. Clicking it opens that card's details. If the open card has unsaved edits, the existing unsaved-changes prompt runs first. If the target card was deleted by an external edit, nothing happens.
- [ ] The field is read-only: it has no picker and no remove (×) buttons, and saving the open card never changes another card's `dependsOn`.
- [ ] The list reflects the board after an external edit to `.mwnn/cards/*.md` (for example, adding `dependsOn: [<this id>]` to another card), the next time the modal is rendered.
- [ ] Chips use the existing chip styling and stay readable in light, dark, and high-contrast themes.
- [ ] `npm run compile`, `npm test`, and `npm run lint` pass.
- [ ] Development Host smoke test: with the sample cards A ← B ← C (B depends on A, C depends on B), opening A lists B, opening B lists C, opening C shows the empty message, and clicking B in A's modal opens B.

## Activity
### 2026-10-11T13:40:35.829Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.

### 2026-10-11T13:41:12.094Z - Run settings recommended by Jev
Jev (TypeSafe) judged this card's difficulty tier: **standard**.

- copilot: model `claude-haiku-4.5`, thinking level `medium`
- codex: model `gpt-6-luna`, thinking level `medium`
- claude-code: model `haiku`, thinking level `medium`
- cursor: model `Gemini 3.8 Flash`
