---
id: card-mseqezrp-2
title: Add the AI card verification prompt builder
column: col-mqwk2njn-4
position: -13000
assignee: { kind: human }
createdAt: 1785852411541
updatedAt: 1785863655272
---

## Description
Add `buildCardVerificationPrompt(card, cardFilePath)` to `src/aiCards.ts`, alongside `buildCardHandoffPrompt` and `buildCardDefinitionPrompt`.

The prompt tells the agent to verify a finished card rather than work on it: check each acceptance criterion against the actual workspace state (read the files, run the build and tests), do not implement or fix anything, uncheck any criterion that is not genuinely met, append its findings to the card's Activity section, and end with exactly one `VERIFY: PASS` / `VERIFY: FAIL: <reason>` / `VERIFY: HUMAN: <reason>` marker on its own line.

It must steer the agent to `VERIFY: HUMAN` for anything it cannot confirm itself: visual or UX judgement, external services, credentials, and ambiguous or subjective criteria.

## Acceptance criteria
- [x] `buildCardVerificationPrompt(card, cardFilePath)` is exported from `src/aiCards.ts`
- [x] The prompt names the card file path and instructs the agent to verify without implementing or fixing anything
- [x] The prompt asks the agent to uncheck acceptance criteria that are not actually met
- [x] The prompt specifies exactly one terminal marker: `VERIFY: PASS`, `VERIFY: FAIL: <reason>`, or `VERIFY: HUMAN: <reason>`
- [x] The prompt lists the cases that call for `VERIFY: HUMAN` (visual/UX checks, external services, credentials, ambiguous criteria)
- [x] `test/unit/aiCards.test.ts` asserts the marker instructions and the no-implementation instruction, and `npm test` passes

## Activity
### 2026-08-04T14:06:51.541Z - Imported from plan
Import key: `ai-verify-loop-plan#verification-prompt-builder` (source: AI Verify option plan, 2026-08-04 chat).

### 2026-08-04T14:34:18.922Z - AI loop advanced this card
Moved to "Ready".

### 2026-08-04T14:39:00.387Z - AI loop advanced this card
Moved to "Implement".

### 2026-08-04T14:39:00.577Z - OpenAI Codex CLI implementation handoff started
Started OpenAI Codex CLI in the active workspace and waiting for card-file completion evidence.

### 2026-08-04T14:42:25.999Z - OpenAI Codex CLI implementation completed
Added the exported verification prompt builder with workspace-evidence, no-implementation, checklist correction, Activity reporting, single-verdict, and human-verification guidance. Added focused unit coverage. `npm run compile-tests`, `npm run compile`, `node --test dist-test/test/unit/aiCards.test.js`, `npm test` (250 passed), and `npm run lint` all passed.
STATUS: DONE

### 2026-08-04T14:43:07.624Z - AI loop advanced this card
Moved to "Verify".

### 2026-08-04T14:43:09.444Z - AI loop parked in Verify
Implementation finished; reassigned to Human for verification and sign-off.
