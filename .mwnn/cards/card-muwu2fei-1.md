---
id: card-muwu2fei-1
title: Read Claude Code remaining usage for the usage orchestrator
column: col-mqwk2njn-4
position: -60000
assignee: { kind: human }
createdAt: 1791300499578
updatedAt: 1791582622121
dependsOn: [card-muwsfaoh-1]
---

## Description
Feed Claude Code's plan usage into the usage-snapshot contract from
`card-muwsfaoh-1`, so the orchestrator ranks Claude Code by its real remaining
usage and reset time instead of the averaged value it gets as an "unknown" CLI.

Documented sources: `/usage` shows plan usage limits
(https://code.claude.com/docs/en/commands), and supported subscriptions expose
usage percentages and reset times through status-line JSON
(https://code.claude.com/docs/en/statusline). Status-line JSON is produced
inside an interactive session, so part of this card is establishing a
non-interactive read path the extension can use with the installed `claude`
executable. Where no supported path exists for an installed version or account
type (e.g. an API-key account instead of a subscription), Claude Code stays
"unknown", with the reason stated.

Claude Code reports a 5-hour session window and a weekly window; both are
normalized to the binding window by the rule in `card-muwsfaoh-1`.

## Acceptance criteria
- [x] A Claude Code usage source returns the snapshot contract (remaining percentage and reset time) for subscription accounts that expose plan usage, normalizing the session and weekly windows to the binding window.
- [x] Usage is read only through the locally installed `claude` executable, resolved the same way as dispatch (honoring `mwnn-kanban.agentCliPaths`); the extension makes no direct network requests and never reads Claude Code credentials or tokens itself.
- [x] Reading usage never sends a prompt to a model, so the probe does not spend the allowance it measures.
- [x] An API-key account, an unsupported version, missing fields, malformed or hostile output, a nonzero exit, or a timeout yields "unknown" with a reason, never an error or a failed dispatch, and any probe process has ended within its timeout.
- [x] README documents the chosen read path and the Claude Code versions and account types it supports, alongside the Codex source.
- [x] `node:test` coverage over `dist-test/` uses fixture outputs for both windows, a single window, a missing reset time, an API-key account, and malformed output.
- [ ] `npm run compile-tests`, `npm test`, `npm run compile`, and `npm run lint` pass, and a Development Host smoke test with a subscription account shows Claude Code ranked by reported (not imputed) usage.

## Activity
### 2026-10-09T18:53:23.827Z - Usage Orchestrator chose OpenAI Codex CLI
Stage: implementation. OpenAI Codex CLI reports 85% remaining, resetting 2026-10-16T12:19:08.000Z - the soonest reset among the CLIs with usage left, so it is spent before it is lost.

### 2026-10-09T18:53:25.410Z - Usage Orchestrator dispatch dispatch-mv1bpqn6-4 started
Card: card-muwu2fei-1 ("Read Claude Code remaining usage for the usage orchestrator"). CLI: OpenAI Codex CLI. Stage: implementation.
Requested model: "gpt-6-luna" (source: the AI loop stage model rule; passed to the CLI exactly as shown).
Actual model: awaiting authoritative CLI/session metadata.
Started OpenAI Codex CLI in the active workspace and waiting for card-file completion evidence.
AI loop stage model rule for the implementation stage: gpt-6-luna.
AI loop stage thinking level rule for the implementation stage: max.

### 2026-10-09T19:08:15.000Z - Added Claude Code usage probe
Added the v2.1.295 non-interactive local `/usage` probe, binding-window parser, guarded process handling, fixture coverage for missing reset times and malformed output, and README support notes. The installed subscription CLI returned `local_command: usage` with zero model turns and zero API duration. `npm run compile-tests`, `npm run compile`, focused `dist-test` usage tests (31 passed), `npm test` (730 passed), and `npm run lint` pass. Development Host ranking smoke is unverified: the CLI failed with EPERM changing into the read-only VS Code install directory, and the existing VS Code window has this card's AI Loop dispatch active.
STATUS: BLOCKED: Development Host smoke test could not be run in this sandbox.

### 2026-10-09T19:09:12.613Z - Usage Orchestrator dispatch dispatch-mv1bpqn6-4 runtime model unconfirmed
Card: card-muwu2fei-1. CLI: OpenAI Codex CLI. Stage: implementation.
Runtime model not confirmed: Codex model discovery encountered missing, malformed, or unusable metadata in its JSONL output or matching local rollout. The dispatch start entry records "gpt-6-luna" from the AI loop stage model rule as passed to Codex. This reports model confirmation only; dispatch outcome is recorded separately. Attempt: dispatch-mv1bpqn6-4.

### 2026-10-09T19:50:47.514Z - Usage Orchestrator chose OpenAI Codex CLI
Stage: verification. OpenAI Codex CLI reports 83% remaining, resetting 2026-10-16T12:19:08.000Z - the soonest reset among the CLIs with usage left, so it is spent before it is lost.

### 2026-10-09T19:50:48.199Z - Usage Orchestrator dispatch dispatch-mv1drj47-1 started
Card: card-muwu2fei-1 ("Read Claude Code remaining usage for the usage orchestrator"). CLI: OpenAI Codex CLI. Stage: verification.
Requested model: "gpt-6-luna" (source: the AI loop stage model rule; passed to the CLI exactly as shown).
Actual model: awaiting authoritative CLI/session metadata.
Started OpenAI Codex CLI in the active workspace and waiting for card-file completion evidence.
AI loop stage model rule for the verification stage: gpt-6-luna.
AI loop stage thinking level rule for the verification stage: max.

### 2026-10-09 - Verification
Reviewed `src/agentCliUsage.ts`, `src/agentCliUsageProbe.ts`, `src/agentCliOrchestrator.ts`, `src/extension.ts`, the README usage-source table, the Claude fixtures, and `test/unit/agentCliUsage.test.ts`. The orchestrator resolves configured local CLI targets; Claude probing checks the supported version and invokes only local `/usage`, accepts only a zero-turn local-command response, normalizes windows, and returns unknown for unsupported or invalid results. Fixture and fake-process coverage includes failure paths and confirms timed-out probes end. README documents v2.1.295 and Pro/Max support. `npm run compile-tests`, `npm run compile`, focused usage tests (31 passed), `npm test` (730 passed), and `npm run lint` all passed. The interactive Development Host ranking smoke test with a subscription account was not verified.
VERIFY: HUMAN: Development Host ranking with a subscription account requires an interactive VS Code session and authenticated account, which I could not confirm in this run.

### 2026-10-09T19:54:43.456Z - Usage Orchestrator dispatch dispatch-mv1drj47-1 runtime model unconfirmed
Card: card-muwu2fei-1. CLI: OpenAI Codex CLI. Stage: verification.
Runtime model not confirmed: timed out waiting for the matching Codex rollout model metadata. The model request or CLI-default selection is recorded in the matching dispatch start entry. This entry reports model confirmation only; dispatch outcome is recorded separately. Attempt: dispatch-mv1drj47-1.

### 2026-10-09T19:54:44.328Z - AI loop handed verification to Human
The card remains in Verify and was reassigned to Human.
Why: Development Host ranking with a subscription account requires an interactive VS Code session and authenticated account, which I could not confirm in this run.
Verification focus: Investigate this specific AI-verification result before sign-off: Development Host ranking with a subscription account requires an interactive VS Code session and authenticated account, which I could not confirm in this run.
Human verification procedure:
1. Independently verify every acceptance criterion against the current workspace; do not rely only on the AI's completion claim.
2. Review the implementation and all existing Activity context, then run every relevant automated check and every applicable manual or visual check.
3. Record each check performed and its result in Activity, with concrete evidence for the corresponding acceptance criterion.
4. Move the card to Done only when every acceptance criterion passes.
5. If any criterion fails or cannot be verified, leave the card in Verify and document the failed or unverified criteria, evidence, and required follow-up in Activity.

STATUS: DONE
