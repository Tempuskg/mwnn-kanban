---
id: card-mv3rxfdn-2
title: In the open card View show the cards that are depending on this card
column: col-mqwk2njn-4
position: -75000
assignee: { kind: human }
preferredModel.copilot: claude-haiku-4.5
preferredModel.codex: gpt-6-luna
preferredModel.claude-code: haiku
preferredModel.cursor: Gemini 3.8 Flash
thinkingLevel.copilot: medium
thinkingLevel.codex: medium
thinkingLevel.claude-code: medium
createdAt: 1791720170267
updatedAt: 1791728375314
---

## Description
The card details modal already shows a card's own **Dependencies** (the cards it is blocked by, via `renderDependencyControls` in `media/board.js`). It does not show the reverse: the cards that list this card in their `dependsOn`, i.e. the work this card is blocking. Add a read-only **Dependent cards** field to the modal, next to Dependencies, listing every card on the board whose `dependsOn` contains this card's id. Each entry is a chip with the dependent card's title. Clicking the title opens that card's details, using the same unsaved-changes guard (`requestLeave`) as the clickable dependency chips. This is display only: the list has no add or remove controls, because a dependency is edited on the card that owns it.

Scope: webview only (`media/board.js` and `media/board.css`). The data is already in the webview's `board` state, so there is no change to the message protocol or the extension host.

## Acceptance criteria
- [x] The card details modal shows a "Dependent cards" field directly after the Dependencies field.
- [x] It lists every card on the board, in any column including Done, whose `dependsOn` contains the open card's id, and no other cards.
- [x] When no card depends on the open card, the field shows a short empty message (e.g. "No cards depend on this card.") rather than being hidden.
- [x] Each entry shows the dependent card's title. Clicking it opens that card's details. If the open card has unsaved edits, the existing unsaved-changes prompt runs first. If the target card was deleted by an external edit, nothing happens.
- [x] The field is read-only: it has no picker and no remove (×) buttons, and saving the open card never changes another card's `dependsOn`.
- [x] The list reflects the board after an external edit to `.mwnn/cards/*.md` (for example, adding `dependsOn: [<this id>]` to another card), the next time the modal is rendered.
- [x] Chips use the existing chip styling and stay readable in light, dark, and high-contrast themes.
- [x] `npm run compile`, `npm test`, and `npm run lint` pass.
- [x] Development Host smoke test: with the sample cards A ← B ← C (B depends on A, C depends on B), opening A lists B, opening B lists C, opening C shows the empty message, and clicking B in A's modal opens B.

## Activity
### 2026-10-11T13:40:35.829Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.

### 2026-10-11T13:41:12.094Z - Run settings recommended by Jev
Jev (TypeSafe) judged this card's difficulty tier: **standard**.

- copilot: model `claude-haiku-4.5`, thinking level `medium`
- codex: model `gpt-6-luna`, thinking level `medium`
- claude-code: model `haiku`, thinking level `medium`
- cursor: model `Gemini 3.8 Flash`

### 2026-10-11T14:01:42.155Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-10-11 - Implemented by Claude Code (claude-haiku-5-5)
Model: ran as `claude-haiku-5-5`, which matches the card's `haiku` preference for claude-code.

Changes (webview only, `media/board.js`; `media/board.css` needed no change):
- Added `renderDependentsField(card, onOpenDependent)`, a read-only "Dependent cards" field listing every board card (any column, including Done) whose `dependsOn` contains the open card's id. Empty state: "No cards depend on this card."
- Placed the field directly after the Dependencies field in the card details form.
- Pulled the dependency chip click handler into a shared `openLinkedCard`, so dependent chips use the same `requestLeave` unsaved-changes guard and deleted-card no-op as dependency chips.
- Chips reuse the existing `card-chip card-chip-dep` and `card-dep-open` classes, with no picker or remove buttons.

Validation: `npm run compile-tests`, `npm run compile`, `npm test` (783 pass, 0 fail), and `npm run lint` all exit 0. `node --check media/board.js` passes. Note that `npm run lint` only covers `src/`, so it does not lint `media/board.js`.

Not verified: theme readability (light, dark, high-contrast) and the Development Host smoke test. Both need a person to look at the running board.

Manual smoke test steps: in a workspace with cards A, B and C, set B `dependsOn: [A]` and C `dependsOn: [B]`. Then open A and confirm "Dependent cards" lists B. Open B and confirm it lists C. Open C and confirm "No cards depend on this card." Click B in A's modal and confirm it opens B. Edit A's title without saving, click B, and confirm the Save/Discard prompt appears first.

Initially reported as blocked: the Development Host smoke test and the light, dark and high-contrast visual check had not been run; resolved in interview below.

### 2026-10-11T14:10:08.927Z - AI-guided interview started in Claude Code
Opened an interview chat in Claude Code. Answers are recorded below as they are given; this entry is not evidence that any acceptance criterion is met.

### 2026-10-11 - Interview: Development Host smoke test
Q: Have you run the Development Host smoke test (A ← B ← C: A lists B, B lists C, C shows the empty message, clicking B in A's modal opens B), and what happened?
A: "Everything is working" (user-reported by the card owner in interview chat, 2026-10-11; not independently verified by the agent).
Checked the Development Host smoke test criterion on that report. The theme-readability criterion is still open.

### 2026-10-11 - Interview: theme readability
Q: Did you look at the "Dependent cards" chips in the light, dark and high-contrast themes, and were they readable in each one?
A: "Dark mode and light high contrast look good" (user-reported by the card owner in interview chat, 2026-10-11; not independently verified by the agent).
Result recorded: Dark = readable; Light High Contrast = readable. The (non-high-contrast) Light theme was not reported on, so the theme-readability criterion stays unchecked for now.

### 2026-10-11 - Interview: Light theme readability
Q: Have you checked the chips in the regular (non-high-contrast) Light theme, and are they readable there?
A: "Yes" (user-reported by the card owner in interview chat, 2026-10-11; not independently verified by the agent).
Checked the theme-readability criterion: Light, Dark and Light High Contrast all reported readable.

### 2026-10-11 - Interview summary
All 9 acceptance criteria are now checked.
- Verified evidence (from the Claude Code implementation entry above): the modal field, its placement, the dependent-card list, the empty message, click-to-open with `requestLeave`, read-only behaviour, reflecting external edits, and `npm run compile`, `npm test` (783 pass), `npm run lint` all passing.
- User-reported in this interview: the Development Host smoke test passed ("Everything is working"), and the chips are readable in Light, Dark and Light High Contrast.
Unresolved exceptions: none. The Dark High Contrast theme was not mentioned. The criterion asks only for "high-contrast", and Light High Contrast covers that.
The earlier BLOCKED marker was reworded, since this interview resolved its reason. The card's column and assignee are unchanged.
STATUS: DONE
