---
id: card-muwu2fei-2
title: Read GitHub Copilot remaining usage for the usage orchestrator
column: col-mqwk2njn-4
position: -61000
assignee: { kind: human }
createdAt: 1791300499578
updatedAt: 1791583477945
dependsOn: [card-muwsfaoh-1]
---

## Description
Feed GitHub Copilot's quota into the usage-snapshot contract from
`card-muwsfaoh-1`, so the orchestrator ranks Copilot by its real remaining
usage and reset date instead of the averaged value it gets as an "unknown" CLI.

Documented source: the Copilot SDK's `account.getQuota` returns the remaining
percentage and reset date
(https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/usage-and-billing).
`/usage` shows session consumption only, so it is not the remaining-allowance
signal. The SDK talks to the locally installed Copilot CLI; whether reading the
quota needs a new runtime dependency, and its bundling and package-size impact,
is decided as part of this card.

## Acceptance criteria
- [x] A Copilot usage source returns the snapshot contract (remaining percentage and reset date) from `account.getQuota`, through the locally installed Copilot CLI resolved the same way as dispatch (honoring `mwnn-kanban.agentCliPaths`).
- [x] A quota reported as unlimited is treated as 100% remaining with no reset time.
- [x] Not signed in, an unsupported CLI version, missing fields, a malformed or hostile response, an error, or a timeout yields "unknown" with a reason, never an error or a failed dispatch, and any started process or session is closed within the timeout.
- [x] The extension makes no direct network requests; any new runtime dependency is bundled by the existing build and included in the packaged VSIX.
- [x] README documents the Copilot source alongside the Codex source.
- [x] `node:test` coverage over `dist-test/` uses fixture responses for a normal quota, an unlimited quota, a missing reset date, a signed-out account, and malformed input.
- [ ] `npm run compile-tests`, `npm test`, `npm run compile`, and `npm run lint` pass, and a Development Host smoke test shows Copilot ranked by reported (not imputed) usage.

## Activity
### 2026-10-09T17:22:03.096Z - AI loop triage
The AI judged this card doable by an agent and assigned it to AI.
Why: The implementation details are clear and can be executed by an AI coding agent without requiring human intervention.

### 2026-10-09T19:54:45.251Z - AI loop advanced this card
Moved to "Implement".

### 2026-10-09T19:56:19.882Z - Usage Orchestrator chose OpenAI Codex CLI
Stage: implementation. OpenAI Codex CLI reports 82% remaining, resetting 2026-10-16T12:19:08.000Z - the soonest reset among the CLIs with usage left, so it is spent before it is lost.

### 2026-10-09T19:56:20.523Z - Usage Orchestrator dispatch dispatch-mv1dynjf-3 started
Card: card-muwu2fei-2 ("Read GitHub Copilot remaining usage for the usage orchestrator"). CLI: OpenAI Codex CLI. Stage: implementation.
Requested model: "gpt-6-luna" (source: the AI loop stage model rule; passed to the CLI exactly as shown).
Actual model: awaiting authoritative CLI/session metadata.
Started OpenAI Codex CLI in the active workspace and waiting for card-file completion evidence.
AI loop stage model rule for the implementation stage: gpt-6-luna.
AI loop stage thinking level rule for the implementation stage: max.

### 2026-10-09 - Implemented Copilot quota usage source
Added a local Copilot SDK-compatible `account.getQuota` probe using the dispatch-resolved CLI, without adding an SDK dependency or direct network requests. Unlimited, unknown, malformed, timeout, and cleanup behavior have fixture-backed tests; README now documents the source. `npm run compile-tests`, `npm test` (742 tests), `npm run compile`, and `npm run lint` passed. A local Copilot CLI 1.0.90 RPC check reached the quota method and returned the expected `Not authenticated` unknown result in the isolated local-data run. The Development Host smoke test could not be performed because no desktop apps are exposed to this session, so real-usage ranking remains unverified.
STATUS: BLOCKED: Development Host smoke needs an accessible VS Code window and an authenticated Copilot CLI.

### 2026-10-09T20:06:57.765Z - Usage Orchestrator dispatch dispatch-mv1dynjf-3 runtime model unconfirmed
Card: card-muwu2fei-2. CLI: OpenAI Codex CLI. Stage: implementation.
Runtime model not confirmed: timed out waiting for the matching Codex rollout model metadata. The model request or CLI-default selection is recorded in the matching dispatch start entry. This entry reports model confirmation only; dispatch outcome is recorded separately. Attempt: dispatch-mv1dynjf-3.

### 2026-10-09T21:09:28.536Z - Usage Orchestrator chose OpenAI Codex CLI
Stage: verification. OpenAI Codex CLI reports 81% remaining, resetting 2026-10-16T12:19:08.000Z - the soonest reset among the CLIs with usage left, so it is spent before it is lost.

### 2026-10-09T21:09:29.233Z - Usage Orchestrator dispatch dispatch-mv1gkpw1-4 started
Card: card-muwu2fei-2 ("Read GitHub Copilot remaining usage for the usage orchestrator"). CLI: OpenAI Codex CLI. Stage: verification.
Requested model: "gpt-6-luna" (source: the AI loop stage model rule; passed to the CLI exactly as shown).
Actual model: awaiting authoritative CLI/session metadata.
Started OpenAI Codex CLI in the active workspace and waiting for card-file completion evidence.
AI loop stage model rule for the verification stage: gpt-6-luna.
AI loop stage thinking level rule for the verification stage: max.

### 2026-10-09 - Verification
Confirmed the usage orchestrator resolves Copilot through the same configured CLI path map as dispatch, and its probe calls `account.getQuota` over the local CLI's SDK stdio interface. The parser reports the premium-interactions percentage/reset, handles unlimited and missing-reset quotas, and returns unknown for malformed, hostile, signed-out, unsupported, error, and timeout cases; process-cleanup assertions pass. README lists Copilot alongside Codex. Fixture-backed `node:test` cases ran from `dist-test`; `npm run compile-tests`, `npm test` (743 passed), `npm run compile`, and `npm run lint` all passed. The compiled bundle contains the quota request, no Copilot SDK/runtime dependency was added, and `.vscodeignore` does not exclude `dist`. The desktop UI inventory exposed no apps or VS Code window, so the Development Host ranking smoke remains unverified and its criterion stays unchecked.
VERIFY: HUMAN: Development Host smoke could not be performed because this session exposes no VS Code window; confirm Copilot ranking by reported usage in a Development Host.

### 2026-10-09T21:14:34.896Z - Usage Orchestrator dispatch dispatch-mv1gkpw1-4 runtime model unconfirmed
Card: card-muwu2fei-2. CLI: OpenAI Codex CLI. Stage: verification.
Runtime model not confirmed: timed out waiting for the matching Codex rollout model metadata. The model request or CLI-default selection is recorded in the matching dispatch start entry. This entry reports model confirmation only; dispatch outcome is recorded separately. Attempt: dispatch-mv1gkpw1-4.

### 2026-10-09T21:21:41.751Z - Usage Orchestrator chose GitHub Copilot CLI
Stage: verification. GitHub Copilot CLI reports 0% remaining, resetting 2026-10-09T21:21:20.137Z - the soonest reset among the CLIs with usage left, so it is spent before it is lost.

### 2026-10-09T21:21:42.389Z - Usage Orchestrator dispatch dispatch-mv1h0flh-1 started
Card: card-muwu2fei-2 ("Read GitHub Copilot remaining usage for the usage orchestrator"). CLI: GitHub Copilot CLI. Stage: verification.
Requested model: "gpt-6-luna" (source: the AI loop stage model rule; passed to the CLI exactly as shown).
Actual model: awaiting authoritative CLI/session metadata.
Started GitHub Copilot CLI in the active workspace and waiting for card-file completion evidence.
AI loop stage model rule for the verification stage: gpt-6-luna.
AI loop stage thinking level rule for the verification stage: max.

### 2026-10-09T21:21:49.029Z - Usage Orchestrator dispatch dispatch-mv1h0flh-1 runtime model unconfirmed
Card: card-muwu2fei-2. CLI: GitHub Copilot CLI. Stage: verification.
Runtime model not confirmed: the CLI rejected the requested model before reporting a model that it used. The model request or CLI-default selection is recorded in the matching dispatch start entry. This entry reports model confirmation only; dispatch outcome is recorded separately. Attempt: dispatch-mv1h0flh-1.

### 2026-10-09T21:21:49.278Z - GitHub Copilot CLI verification handoff failed
GitHub Copilot CLI rejected the AI loop stage model rule for the verification stage "gpt-6-luna": Error: Model "gpt-6-luna" from --model flag is not available.. The card was not advanced; set a model name GitHub Copilot CLI accepts for "verification" / "copilot" in mwnn-kanban.agentCliStageModels, or remove that CLI's stage entry to fall back to mwnn-kanban.agentCliModels and the CLI's default.

### 2026-10-09T21:21:51.883Z - AI loop handed verification to Human
The card remains in Verify and was reassigned to Human.
Why: The AI verification hand-off could not be started.
Verification focus: Investigate this specific AI-verification result before sign-off: The AI verification hand-off could not be started.
Human verification procedure:
1. Independently verify every acceptance criterion against the current workspace; do not rely only on the AI's completion claim.
2. Review the implementation and all existing Activity context, then run every relevant automated check and every applicable manual or visual check.
3. Record each check performed and its result in Activity, with concrete evidence for the corresponding acceptance criterion.
4. Move the card to Done only when every acceptance criterion passes.
5. If any criterion fails or cannot be verified, leave the card in Verify and document the failed or unverified criteria, evidence, and required follow-up in Activity.
