---
id: card-mseqezrp-5
title: Wire the AI Verify option into the extension and settings
column: col-mqwk2njn-1
position: 5000
assignee: { kind: ai }
dependsOn: [card-mseqezrp-2, card-mseqezrp-3, card-mseqezrp-4]
createdAt: 1785852411541
updatedAt: 1785852411541
---

## Description
Expose the option to users and connect the loop's `verifyCard` gateway to both execution channels.

`package.json` gains `mwnn-kanban.aiLoopVerifyCards`: boolean, default `false`, scope `resource`, described as letting the AI board loop verify cards in the Verify column and move them to Done when every acceptance criterion is confirmed, handing anything it cannot confirm back to a human, and assigning every card reaching Verify to a human when off.

`src/extension.ts` gains a `readAiLoopVerifyCards()` reader beside `readAiLoopReviewFreshDefinitions`, passes `verifyWithAi` into `runBoardLoop`, and implements `verifyCard` on both gateway objects: the chat gateway hands `buildCardVerificationPrompt` to the chat provider and records a handoff Activity entry the way `requestTriage` does, and the CLI gateway calls `runCliHandoff('verification', ...)`. `summarizeLoopRun` reports how many cards were verified into Done and how many were handed back for human verification.

## Acceptance criteria
- [ ] `mwnn-kanban.aiLoopVerifyCards` is contributed with type boolean, default `false`, scope `resource`, and a description covering both the on and off behaviour
- [ ] `readAiLoopVerifyCards()` reads the setting and its value reaches `runBoardLoop` as `verifyWithAi`
- [ ] The chat gateway's `verifyCard` hands off `buildCardVerificationPrompt` and appends a verification-handoff entry to the card
- [ ] The CLI gateway's `verifyCard` runs `runCliHandoff('verification', ...)` with the same prompt
- [ ] `summarizeLoopRun` reports cards verified into Done and cards handed back for human verification
- [ ] With the setting off, a full loop run behaves exactly as it does today
- [ ] `npm run compile`, `npm test`, and `npm run lint` pass
- [ ] Smoke-tested in the Extension Development Host with the setting on: a passing card reaches Done and a failing one is assigned to Human

## Activity
### 2026-08-04T14:06:51.541Z - Imported from plan
Import key: `ai-verify-loop-plan#extension-wiring-and-setting` (source: AI Verify option plan, 2026-08-04 chat).
