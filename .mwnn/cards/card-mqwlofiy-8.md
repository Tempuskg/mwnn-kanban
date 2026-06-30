---
id: card-mqwlofiy-8
title: have ai fill in definition
column: col-mqwk2njn-4
position: 9000
assignee: { kind: ai }
createdAt: 1782579280282
updatedAt: 1782649410394
---

## Description
when you drag a card that needs definition to the Ready column ask the user if they want ai to create definition if yes then open the card details and have the ai fill in Description/Acceptance critiera

Or when editing a card and the description and acceptance criteria are empty have a button for the AI to fill in details

## Acceptance criteria

## Activity
### 2026-06-28T00:00:49.255Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-06-27 - Implemented AI definition fill (Claude Code)
Added an AI "fill in definition" flow that reuses the existing chat-handoff infrastructure:
- `src/aiCards.ts`: new `buildCardDefinitionPrompt` (instructs the agent to write Description + Acceptance criteria into the card file without implementing) and `formatDefinitionHandoffEntry` (activity log note).
- `src/types.ts`: new webview→host `fillCardDefinition` message (+ guard) and host→webview `openCard` message.
- `src/boardPanel.ts`: handles `fillCardDefinition`; after a `moveCard` into a `ready`-role column for a card with no Description, prompts "Have AI fill in the Description and Acceptance criteria?" — accepting opens the card details (`openCard`) and triggers the fill.
- `src/extension.ts`: new `fillCardDefinitionWithAI` (gated by `enableRunWithAI`), picks a chat provider, hands off the definition prompt, and records the dispatch in Activity; wired into `BoardPanel` deps via new `findCardById` helper.
- `media/board.js`: handles `openCard`; card detail panel shows a "Fill in with AI" button when both Description and Acceptance criteria are empty.
- Tests added in `test/unit/aiCards.test.ts` and `test/unit/protocol.test.ts`; updated `CHANGELOG.md` and `README.md`.
- Validation: `npm run compile-tests` + `npm test` (59 pass), `npm run compile`, `npm run lint`, and `node --check media/board.js` all green.
