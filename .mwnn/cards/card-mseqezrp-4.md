---
id: card-mseqezrp-4
title: Validate verification completion evidence in the agent CLI handoff
column: col-mqwk2njn-1
position: 4000
assignee: { kind: ai }
dependsOn: [card-mseqezrp-1]
createdAt: 1785852411541
updatedAt: 1785852411541
---

## Description
Add `verification` to `AgentCliHandoffKind` in `src/agentCliHandoff.ts` and give `validateCompletionEvidence` a matching branch that requires a parsed `VERIFY:` verdict in the activity appended by the run, next to the existing `definition` and `triage` branches.

A CLI run that exits without a usable verdict must report `started: false` with a clear reason, which the loop turns into a hand-back to a human — closing the gap that the chat channel cannot close.

`RunWithAiHandoffKind` is an `Extract<AgentCliHandoffKind, 'implementation' | 'definition'>`, and `createCliRunObserver` already takes the full kind, so the per-card Run-with-AI path and the output-channel and status-bar feedback should need no signature changes. Confirm that while making the change.

## Acceptance criteria
- [ ] `AgentCliHandoffKind` includes `verification`
- [ ] `validateCompletionEvidence` has a `verification` branch that accepts a run only when a `VERIFY:` verdict was appended after the baseline
- [ ] A verification run with no verdict, or an unparseable one, is invalid with a reason naming the missing `VERIFY: PASS` / `VERIFY: FAIL: <reason>` / `VERIFY: HUMAN: <reason>` line
- [ ] `RunWithAiHandoffKind` still resolves to `implementation | definition` and the per-card Run-with-AI path is unchanged
- [ ] Live-feedback surfaces (output channel heading, progress text, card status) render the new kind without signature changes
- [ ] `test/unit/agentCliHandoff.test.ts` covers valid and invalid verification evidence and `npm test` passes

## Activity
### 2026-08-04T14:06:51.541Z - Imported from plan
Import key: `ai-verify-loop-plan#cli-verification-evidence` (source: AI Verify option plan, 2026-08-04 chat).
