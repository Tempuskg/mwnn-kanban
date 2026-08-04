---
id: card-mseqezrp-1
title: Add a verification verdict parser for AI-verified cards
column: col-mqwk2njn-1
position: 1000
assignee: { kind: ai }
createdAt: 1785852411541
updatedAt: 1785852411541
---

## Description
Add `src/cardVerification.ts`, a small shared module (mirroring `src/cardDefinition.ts`) that both `src/boardLoop.ts` and `src/agentCliHandoff.ts` can import without creating a cycle, so it must stay free of `vscode` and of any import from those two modules.

It exports the verdict type and the parser for the markers a verifying agent appends to a card's Activity:
- `VERIFY: PASS` — every acceptance criterion independently confirmed.
- `VERIFY: FAIL: <reason>` — one or more criteria are not met.
- `VERIFY: HUMAN: <reason>` — verification needs a person.

Only text appended after the recorded activity baseline is scanned, the same discipline as `parseTerminalCardStatus` in `src/agentCliHandoff.ts`, so a marker left by an earlier run can never resolve a new verification.

Deliberately no "all acceptance criteria checked" fallback, unlike `readDispatchOutcome` in `src/boardLoop.ts`: the implementation handoff ticks every checkbox before a card reaches Verify, so that fallback would make every card pass without the agent verifying anything.

## Acceptance criteria
- [ ] `src/cardVerification.ts` exports a `VerificationVerdict` discriminated union (`pass`, `fail`, `human`, with a reason on `fail` and `human`) and `parseVerificationVerdict(activity, activityBaseline)`
- [ ] Only activity appended after `activityBaseline` is scanned, and the last `VERIFY:` line wins
- [ ] `VERIFY: FAIL:` or `VERIFY: HUMAN:` without a non-empty reason is rejected rather than accepted
- [ ] A fully checked acceptance-criteria list on its own never produces a pass verdict
- [ ] An out-of-range baseline returns no verdict instead of throwing
- [ ] The module imports neither `vscode` nor `boardLoop`/`agentCliHandoff`
- [ ] `test/unit/cardVerification.test.ts` covers the above and `npm test` passes

## Activity
### 2026-08-04T14:06:51.541Z - Imported from plan
Import key: `ai-verify-loop-plan#verification-verdict-parser` (source: AI Verify option plan, 2026-08-04 chat).
