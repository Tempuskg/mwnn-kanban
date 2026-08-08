---
id: card-mseqezrp-6
title: Correct the triage prompt wording about who verifies a card
column: col-mqwk2njn-4
position: -14000
assignee: { kind: human }
createdAt: 1785852411541
updatedAt: 1785863692153
---

## Description
`buildDoabilityPrompt` and `buildTriagePrompt` in `src/boardLoop.ts` both tell the model that "every card is verified by a human in the Verify column after implementation". Once AI verification can be enabled that claim is no longer always true.

Reword both to something true under either setting, such as "every card is verified in the Verify column before Done". The point the sentence supports is unchanged: a card must not be routed to a person merely because it will need verification, testing sign-off, or review.

## Acceptance criteria
- [x] Neither prompt asserts that a human specifically performs Verify-column verification
- [x] Both prompts still instruct the model not to route a card to a human merely because it needs verification, testing sign-off, or review
- [x] Existing triage and doability tests still pass, with any wording assertions updated

## Activity
### 2026-08-04T14:06:51.541Z - Imported from plan
Import key: `ai-verify-loop-plan#triage-prompt-wording` (source: AI Verify option plan, 2026-08-04 chat).

### 2026-08-04T14:34:19.171Z - AI loop advanced this card
Moved to "Ready".

### 2026-08-04T14:43:09.699Z - AI loop advanced this card
Moved to "Implement".

### 2026-08-04T14:43:09.907Z - OpenAI Codex CLI implementation handoff started
Started OpenAI Codex CLI in the active workspace and waiting for card-file completion evidence.

### 2026-08-04T14:47:35.889Z - Implementation completed
Reworded both triage prompts so Verify-column verification is role-neutral while preserving the instruction not to route review-only needs to a human. Updated the wording assertions; compile, focused tests, all 250 unit tests, and lint pass.
STATUS: DONE

### 2026-08-04T14:48:24.798Z - AI loop advanced this card
Moved to "Verify".

### 2026-08-04T14:48:25.005Z - AI loop parked in Verify
Implementation finished; reassigned to Human for verification and sign-off.
