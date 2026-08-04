---
id: card-mseqezrp-2
title: Add the AI card verification prompt builder
column: col-mqwk2njn-1
position: 2000
assignee: { kind: ai }
createdAt: 1785852411541
updatedAt: 1785852411541
---

## Description
Add `buildCardVerificationPrompt(card, cardFilePath)` to `src/aiCards.ts`, alongside `buildCardHandoffPrompt` and `buildCardDefinitionPrompt`.

The prompt tells the agent to verify a finished card rather than work on it: check each acceptance criterion against the actual workspace state (read the files, run the build and tests), do not implement or fix anything, uncheck any criterion that is not genuinely met, append its findings to the card's Activity section, and end with exactly one `VERIFY: PASS` / `VERIFY: FAIL: <reason>` / `VERIFY: HUMAN: <reason>` marker on its own line.

It must steer the agent to `VERIFY: HUMAN` for anything it cannot confirm itself: visual or UX judgement, external services, credentials, and ambiguous or subjective criteria.

## Acceptance criteria
- [ ] `buildCardVerificationPrompt(card, cardFilePath)` is exported from `src/aiCards.ts`
- [ ] The prompt names the card file path and instructs the agent to verify without implementing or fixing anything
- [ ] The prompt asks the agent to uncheck acceptance criteria that are not actually met
- [ ] The prompt specifies exactly one terminal marker: `VERIFY: PASS`, `VERIFY: FAIL: <reason>`, or `VERIFY: HUMAN: <reason>`
- [ ] The prompt lists the cases that call for `VERIFY: HUMAN` (visual/UX checks, external services, credentials, ambiguous criteria)
- [ ] `test/unit/aiCards.test.ts` asserts the marker instructions and the no-implementation instruction, and `npm test` passes

## Activity
### 2026-08-04T14:06:51.541Z - Imported from plan
Import key: `ai-verify-loop-plan#verification-prompt-builder` (source: AI Verify option plan, 2026-08-04 chat).
