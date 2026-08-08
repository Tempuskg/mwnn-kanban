---
id: card-mseqezrp-5
title: Wire the AI Verify option into the extension and settings
column: col-mqwk2njn-4
position: -17000
assignee: { kind: human }
createdAt: 1785852411541
updatedAt: 1786231673102
dependsOn: [card-mseqezrp-2, card-mseqezrp-3, card-mseqezrp-4]
---

## Description
Expose the option to users and connect the loop's `verifyCard` gateway to both execution channels.

`package.json` gains `mwnn-kanban.aiLoopVerifyCards`: boolean, default `false`, scope `resource`, described as letting the AI board loop verify cards in the Verify column and move them to Done when every acceptance criterion is confirmed, handing anything it cannot confirm back to a human, and assigning every card reaching Verify to a human when off.

`src/extension.ts` gains a `readAiLoopVerifyCards()` reader beside `readAiLoopReviewFreshDefinitions`, passes `verifyWithAi` into `runBoardLoop`, and implements `verifyCard` on both gateway objects: the chat gateway hands `buildCardVerificationPrompt` to the chat provider and records a handoff Activity entry the way `requestTriage` does, and the CLI gateway calls `runCliHandoff('verification', ...)`. `summarizeLoopRun` reports how many cards were verified into Done and how many were handed back for human verification.

## Acceptance criteria
- [x] `mwnn-kanban.aiLoopVerifyCards` is contributed with type boolean, default `false`, scope `resource`, and a description covering both the on and off behaviour
- [x] `readAiLoopVerifyCards()` reads the setting and its value reaches `runBoardLoop` as `verifyWithAi`
- [x] The chat gateway's `verifyCard` hands off `buildCardVerificationPrompt` and appends a verification-handoff entry to the card
- [x] The CLI gateway's `verifyCard` runs `runCliHandoff('verification', ...)` with the same prompt
- [x] `summarizeLoopRun` reports cards verified into Done and cards handed back for human verification
- [x] With the setting off, a full loop run behaves exactly as it does today
- [x] `npm run compile`, `npm test`, and `npm run lint` pass
- [ ] Smoke-tested in the Extension Development Host with the setting on: a passing card reaches Done and a failing one is assigned to Human

## Activity
### 2026-08-04T14:06:51.541Z - Imported from plan
Import key: `ai-verify-loop-plan#extension-wiring-and-setting` (source: AI Verify option plan, 2026-08-04 chat).

### 2026-08-04T19:52:02.141Z - AI loop advanced this card
Moved to "Ready".

### 2026-08-04T19:52:02.396Z - AI loop advanced this card
Moved to "Implement".

### 2026-08-04T19:52:02.661Z - OpenAI Codex CLI implementation handoff started
Started OpenAI Codex CLI in the active workspace and waiting for card-file completion evidence.

### 2026-08-04T20:00:39.114Z - Codex implementation and verification
Added the default-off resource setting, wired the AI verification prompt through both chat and CLI gateways, passed `verifyWithAi` into the board loop, and added verified/human-verification counts to the run summary. `npm run compile-tests`, `npm run compile`, focused verification tests, `npm test` (268 passed), and `npm run lint` passed. The default-off full-loop behavior is covered by the green regression suite.

The required live smoke remains unverified: Windows app control was not approved for the running VS Code window, and two isolated Extension Development Host launches exited before extension activation because their renderer/GPU process could not start (including a retry with `--disable-gpu`). The disposable smoke workspace was removed.

STATUS: BLOCKED: A human must smoke-test the setting-on pass/fail scenario in an Extension Development Host; VS Code UI control was not approved and isolated host renderers failed to launch.
