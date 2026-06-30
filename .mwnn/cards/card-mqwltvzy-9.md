---
id: card-mqwltvzy-9
title: Have needs acceptance criteria
column: col-mqwk2njn-4
position: 15000
assignee: { kind: human }
createdAt: 1782579534910
updatedAt: 1782666941380
---

## Description
A card is currently treated as "defined" based only on having a non-empty Description: the Ready reverse-WIP "Defined x/y" badge counts cards by description alone (`media/board.js`), and the drag-to-Ready definition offer only triggers when the Description is empty (`src/boardPanel.ts`). This means a card with a Description but no Acceptance criteria still counts as ready, even though it has no testable completion signal.

This slice makes Acceptance criteria a required part of a card's definition. A card should only be considered defined when it has **both** a non-empty Description and non-empty Acceptance criteria. The reverse-WIP "Defined" count, the drag-to-Ready "needs a definition" offer, and the in-detail "Fill in with AI" affordance should all use this shared, consistent notion of being defined. The work is limited to the definition/readiness check and its surfacing; the AI fill behaviour itself already populates both sections and does not need to change.

## Acceptance criteria
- [x] The "defined" check treats a card as defined only when both its Description and Acceptance criteria are non-empty (after trimming whitespace).
- [x] The Ready column "Defined x/y" badge in `media/board.js` counts a card only when it has both a non-empty Description and non-empty Acceptance criteria.
- [x] Dragging a card into a Ready column offers the AI definition prompt when either the Description or the Acceptance criteria is empty (not just when the Description is empty) in `src/boardPanel.ts`.
- [x] The "Fill in with AI" affordance is available whenever the card is not fully defined (Description or Acceptance criteria empty), consistent with the same check.
- [x] The defined/needs-definition logic is implemented once (a shared helper) rather than duplicated across the host and webview checks.
- [x] A card that has a Description but empty Acceptance criteria is reported as not defined and does not increase the Ready "Defined" count.
- [x] A card with both sections populated is reported as defined and is not offered AI definition on entering Ready.
- [x] Unit tests cover the defined check for all combinations of empty/non-empty Description and Acceptance criteria.
- [x] `npm run lint`, `npm run compile`, and `npm test` all pass.

## Activity
### 2026-06-28T01:54:49.383Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.

### 2026-06-28T13:10:36.723Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-06-28 - Completed by Claude Code
Made Acceptance criteria a required part of a card's definition.
- Added `src/cardDefinition.ts` with `isCardDefined`/`cardNeedsDefinition` — the single source of truth: a card is defined only when both Description and Acceptance criteria are non-empty after trimming.
- `src/boardPanel.ts` now uses `cardNeedsDefinition`, so the drag-to-Ready offer fires when *either* section is empty (previously only when Description was empty).
- `media/board.js` collapses its three previously-duplicated inline checks into one mirroring `isCardDefined` helper: the Ready "Defined x/y" badge count, the per-card "Needs definition" chip, and the "Fill in with AI" affordance (now shown whenever the card is not fully defined, not only when both sections are empty). The webview can't import the TS module (rootDir is `./src`, board.js is served as plain JS), so it mirrors the helper per the repo's existing convention.
- Added `test/unit/cardDefinition.test.ts` covering all combinations of empty/non-empty/whitespace/undefined Description and Acceptance criteria.
- `npm run lint`, `npm run compile`, and `npm test` (63 tests) all pass.
