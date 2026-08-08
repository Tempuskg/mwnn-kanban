---
id: card-mseqezrp-4
title: Validate verification completion evidence in the agent CLI handoff
column: col-mqwk2njn-4
position: -16000
assignee: { kind: human }
createdAt: 1785852411541
updatedAt: 1785873110952
dependsOn: [card-mseqezrp-1]
---

## Description
Add `verification` to `AgentCliHandoffKind` in `src/agentCliHandoff.ts` and give `validateCompletionEvidence` a matching branch that requires a parsed `VERIFY:` verdict in the activity appended by the run, next to the existing `definition` and `triage` branches.

A CLI run that exits without a usable verdict must report `started: false` with a clear reason, which the loop turns into a hand-back to a human — closing the gap that the chat channel cannot close.

`RunWithAiHandoffKind` is an `Extract<AgentCliHandoffKind, 'implementation' | 'definition'>`, and `createCliRunObserver` already takes the full kind, so the per-card Run-with-AI path and the output-channel and status-bar feedback should need no signature changes. Confirm that while making the change.

## Acceptance criteria
- [x] `AgentCliHandoffKind` includes `verification`
- [x] `validateCompletionEvidence` has a `verification` branch that accepts a run only when a `VERIFY:` verdict was appended after the baseline
- [x] A verification run with no verdict, or an unparseable one, is invalid with a reason naming the missing `VERIFY: PASS` / `VERIFY: FAIL: <reason>` / `VERIFY: HUMAN: <reason>` line
- [x] `RunWithAiHandoffKind` still resolves to `implementation | definition` and the per-card Run-with-AI path is unchanged
- [x] Live-feedback surfaces (output channel heading, progress text, card status) render the new kind without signature changes
- [x] `test/unit/agentCliHandoff.test.ts` covers valid and invalid verification evidence and `npm test` passes

## Activity
### 2026-08-04T14:06:51.541Z - Imported from plan
Import key: `ai-verify-loop-plan#cli-verification-evidence` (source: AI Verify option plan, 2026-08-04 chat).

### 2026-08-04T17:15:08.248Z - AI loop advanced this card
Moved to "Ready".

### 2026-08-04T17:24:53.256Z - AI loop advanced this card
Moved to "Implement".

### 2026-08-04T17:24:53.434Z - OpenAI Codex CLI implementation handoff started
Started OpenAI Codex CLI in the active workspace and waiting for card-file completion evidence.

### 2026-08-04T17:29:00.243Z - OpenAI Codex CLI implementation completed
Added the `verification` handoff kind and baseline-aware verdict validation using `parseVerificationVerdict`, with valid, stale, missing, and malformed evidence coverage. Confirmed the per-card Run-with-AI and live-feedback signatures remain unchanged. `npm run compile-tests`, `npm run compile`, focused tests, `npm test` (268 tests), and `npm run lint` passed.
STATUS: DONE

### 2026-08-04T17:29:55.777Z - AI loop advanced this card
Moved to "Verify".

### 2026-08-04T17:29:56.998Z - AI loop parked in Verify
Implementation finished; reassigned to Human for verification and sign-off.
