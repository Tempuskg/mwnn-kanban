---
id: card-msw61zoy-1
title: In AI Loop when asigning a card to a human to Verify add more detailed instructions for the human to follow
column: col-mqwk2njn-4
position: -20000
assignee: { kind: ai }
createdAt: 1786906603762
updatedAt: 1786907181901
---

## Description
Improve the AI loop's handoff whenever it places or leaves an AI-completed card in the Verify column and assigns it to a human. The Activity entry should give the human a self-contained verification procedure: independently check every acceptance criterion against the current workspace, review the implementation and prior handoff context, run the relevant automated and manual checks, record evidence and any failures, and move the card to Done only after all criteria pass. When AI verification failed or could not proceed, retain its specific reason and direct the human to investigate it.

## Acceptance criteria
- [x] Every AI-loop path that assigns an AI card to a human for verification appends detailed verification instructions to the card's Activity, including both a normal handoff in Verify and a handback after unsuccessful or unavailable AI verification.
- [x] The instructions tell the human to independently verify each acceptance criterion against the current workspace, review the implementation and existing Activity context, and run all relevant automated plus manual or visual checks.
- [x] The instructions tell the human to record the checks performed and their results in Activity, move the card to Done only when every criterion passes, and otherwise leave it in Verify with the failed criteria, evidence, and required follow-up documented.
- [x] A handback caused by failed, inconclusive, or unavailable AI verification preserves the concrete reason and makes it part of the human's verification focus.
- [x] Existing AI-loop column movement and assignee behavior remain unchanged apart from the richer Activity guidance.
- [x] Focused unit tests cover the normal Verify handoff and AI-verification handback paths, asserting the actionable instructions and preservation of any handback reason.

## Activity
### 2026-08-16T18:57:08.429Z - OpenAI Codex CLI definition handoff started
Started OpenAI Codex CLI in the active workspace and waiting for card-file completion evidence.

### 2026-08-16T18:58:57.759Z - AI loop placed this card in Ready
The definition was just filled in; moved to "Ready" to continue through the board flow.

### 2026-08-16T18:59:01.601Z - OpenAI Codex CLI triage handoff started
Started OpenAI Codex CLI in the active workspace and waiting for card-file completion evidence.

### 2026-08-16T12:59:17-06:00 - Triage decision
AI can implement this autonomously by updating the AI-loop handoff logic and focused unit tests; no product decision or external/manual implementation step is required.

### 2026-08-16T18:59:42.412Z - AI loop advanced this card
Moved to "Implement".

### 2026-08-16T18:59:44.323Z - OpenAI Codex CLI implementation handoff started
Started OpenAI Codex CLI in the active workspace and waiting for card-file completion evidence.

### 2026-08-16T19:02:40.345Z - Implementation complete
Expanded normal Verify handoffs and AI-verification handbacks with a self-contained human verification procedure, including an explicit investigation focus that preserves the handback reason. Added focused assertions for the instructions, unchanged Verify/Human behavior, and reason preservation. `npm run compile-tests`, `npm run compile`, the 47-test focused board-loop suite, all 315 unit tests, and `npm run lint` passed.

STATUS: DONE

### 2026-08-16T19:03:43.456Z - AI loop advanced this card
Moved to "Verify".

### 2026-08-16T19:03:43.686Z - OpenAI Codex CLI verification handoff started
Started OpenAI Codex CLI in the active workspace and waiting for card-file completion evidence.

### 2026-08-16T19:05:35.898Z - Verification complete
Verified all six acceptance criteria against the current workspace. In `src/boardLoop.ts`, the normal Verify parking path appends the shared five-step human procedure, while every failed, inconclusive, unavailable, launch-failed, or blocked-Done AI-verification outcome funnels through `handVerificationToHuman`, which preserves the concrete reason in both `Why` and `Verification focus` before appending the same procedure. The diff changes Activity text only, leaving the existing Verify-column movement and Human-assignee operations intact. `test/unit/boardLoop.test.ts` asserts the actionable instructions, unchanged Verify/Human outcome, and handback-reason preservation; existing cases also exercise unavailable gateway, failed launch, missing Done, and full Done paths.

Validation passed: `npm run compile-tests`; `npm run compile`; `node --test dist-test/test/unit/boardLoop.test.js` (47/47); `npm test` (315/315); and `npm run lint`.

VERIFY: PASS

### 2026-08-16T19:06:21.867Z - AI loop verified this card
AI verification passed; moved to "Done".
