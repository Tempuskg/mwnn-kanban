---
id: card-mseqezrp-3
title: Drive AI verification of Verify-column cards in the board loop
column: col-mqwk2njn-1
position: 3000
assignee: { kind: ai }
dependsOn: [card-mseqezrp-1]
createdAt: 1785852411541
updatedAt: 1785852411541
---

## Description
Teach `src/boardLoop.ts` to verify a card with the AI instead of immediately parking it, behind an opt-in option. Today the planner returns `{ kind: 'park' }` the instant it sees an AI-assigned card in the Verify column; that becomes the option-off branch and stays the default.

Plumbing:
- `LoopOptions.verifyWithAi` and `PlanLoopOptions.verifyWithAi`, threaded exactly like `reviewFreshDefinitions`.
- `LoopGateways.verifyCard?(card)` — optional, so existing gateway objects and tests keep compiling; option on with no gateway falls back to parking.
- `LoopSession.verifications`, a map of records shaped like `DispatchRecord` (`columnId`, `activityBaseline`, `requestedAt`); `pruneLoopSession` drops records whose card left the recorded column or vanished.
- New actions `verify`, `complete`, and `park-unverified`.

Planner behaviour for an AI card in Verify: with the option off, park as today. With a pending verification record, read the verdict via `parseVerificationVerdict` — `pass` plus a Done column with WIP capacity gives `complete`, `fail` or `human` gives `park-unverified`, and no verdict yet means keep waiting. Otherwise queue the verification handoff, gated by `hasPendingHandoff` like dispatch so only one agent conversation runs at a time. Handoff priority becomes verify, then triage, then definition, then dispatch, so finished work drains before new work starts.

Every failure path lands on today's safe behaviour — a failed handoff parks the card to a human rather than calling `markSkipped`, and so does a pass with no Done column or a full Done column.

`PendingWait` gains a `verification` kind with a `WAIT_DESCRIPTIONS` entry so the progress line shows what is being waited on and for how long. `LoopSummary` gains `verified` and `verificationsRequested`.

## Acceptance criteria
- [ ] `LoopOptions`/`PlanLoopOptions` carry `verifyWithAi` and `runBoardLoop` threads it into the planner
- [ ] `LoopGateways.verifyCard` is optional; with the option on but no gateway the card is parked to a human
- [ ] With the option off, an AI card in Verify is still assigned to Human exactly as before
- [ ] `VERIFY: PASS` moves the card to the end of the Done column, records `summary.verified`, and appends an Activity entry
- [ ] `VERIFY: FAIL` and `VERIFY: HUMAN` assign the card to Human, leave it in Verify, and record the agent's reason in Activity
- [ ] A verification handoff that fails to start assigns the card to Human instead of skipping it
- [ ] A pass with no Done column, or with Done at its WIP limit, assigns the card to Human and leaves it in Verify
- [ ] A verification is never started while another handoff is pending, and a card with a verification in flight is not verified again
- [ ] `pruneLoopSession` drops verification records whose card moved out of the recorded column or was deleted
- [ ] The progress line reports a pending verification with its elapsed time
- [ ] `test/unit/boardLoop.test.ts` covers each routing case above and `npm test` passes

## Activity
### 2026-08-04T14:06:51.541Z - Imported from plan
Import key: `ai-verify-loop-plan#loop-verification-flow` (source: AI Verify option plan, 2026-08-04 chat).
