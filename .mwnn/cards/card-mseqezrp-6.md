---
id: card-mseqezrp-6
title: Correct the triage prompt wording about who verifies a card
column: col-mqwk2njn-1
position: 6000
assignee: { kind: ai }
createdAt: 1785852411541
updatedAt: 1785852411541
---

## Description
`buildDoabilityPrompt` and `buildTriagePrompt` in `src/boardLoop.ts` both tell the model that "every card is verified by a human in the Verify column after implementation". Once AI verification can be enabled that claim is no longer always true.

Reword both to something true under either setting, such as "every card is verified in the Verify column before Done". The point the sentence supports is unchanged: a card must not be routed to a person merely because it will need verification, testing sign-off, or review.

## Acceptance criteria
- [ ] Neither prompt asserts that a human specifically performs Verify-column verification
- [ ] Both prompts still instruct the model not to route a card to a human merely because it needs verification, testing sign-off, or review
- [ ] Existing triage and doability tests still pass, with any wording assertions updated

## Activity
### 2026-08-04T14:06:51.541Z - Imported from plan
Import key: `ai-verify-loop-plan#triage-prompt-wording` (source: AI Verify option plan, 2026-08-04 chat).
