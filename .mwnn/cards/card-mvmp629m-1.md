---
id: card-mvmp629m-1
title: When running AI Loop skip cards that are Blocked
column: col-mqxta6ho-4
position: 2000
assignee: { kind: human }
createdAt: 1792864391674
updatedAt: 1792864606956
---

## Description
Update AI Loop card selection so cards blocked by unfinished dependencies are skipped rather than acted on. A blocked card must not be defined, triaged, dispatched, verified, or advanced while its dependencies remain incomplete; the loop should continue with other eligible cards and pick it up normally once it is unblocked.

## Acceptance criteria
- [x] The AI Loop does not request definition or triage, dispatch an agent, or advance a card whose dependencies are unfinished.
- [x] Blocked cards do not count as available work for Ready replenishment or implementation admission.
- [x] When a blocked card is skipped, the loop can still process other eligible unblocked cards and does not stall or repeatedly retry the blocked card.
- [x] Unit tests cover skipping a blocked card and confirm it becomes eligible for normal processing after its dependencies are completed.

## Activity
### 2026-10-24T17:53:24.008Z - Usage Orchestrator chose GitHub Copilot CLI
Stage: definition. GitHub Copilot CLI reports 61.4% remaining, resetting 2026-10-24T17:53:24.439Z - the soonest reset among the CLIs with usage left, so it is spent before it is lost.

### 2026-10-24T17:53:24.261Z - Usage Orchestrator dispatch dispatch-mvmp6bz9-1 started
Card: card-mvmp629m-1 ("When running AI Loop skip cards that are Blocked"). CLI: GitHub Copilot CLI. Stage: definition.
Requested model: none (source: CLI default; no model argument was supplied).
Actual model: awaiting authoritative CLI/session metadata.
Started GitHub Copilot CLI in the active workspace and waiting for card-file completion evidence.

### 2026-10-24T17:54:10.476Z - Usage Orchestrator dispatch dispatch-mvmp6bz9-1 runtime model unconfirmed
Card: card-mvmp629m-1. CLI: GitHub Copilot CLI. Stage: definition.
Runtime model not confirmed: Copilot CLI non-silent output did not include an explicit model label; this CLI version or selected agent may not expose it. The model request or CLI-default selection is recorded in the matching dispatch start entry. This entry reports model confirmation only; dispatch outcome is recorded separately. Attempt: dispatch-mvmp6bz9-1.

### 2026-10-24T17:54:11.041Z - Run settings recommended by Jev
Jev (TypeSafe) judged this card's difficulty tier: **standard**.
No provider had a choice to make, so no run settings were changed.

### 2026-10-24T17:54:38.213Z - Auto-started in Implement
Assigned to AI in Ready; moved to Implement automatically.

### 2026-10-24T17:54:46.442Z - Usage Orchestrator chose OpenAI Codex CLI
Stage: implementation. OpenAI Codex CLI reports 96% remaining, resetting 2026-10-31T13:48:55.000Z - the soonest reset among the CLIs with usage left, so it is spent before it is lost.

### 2026-10-24T17:54:46.635Z - Usage Orchestrator dispatch dispatch-mvmp83jf-2 started
Card: card-mvmp629m-1 ("When running AI Loop skip cards that are Blocked"). CLI: OpenAI Codex CLI. Stage: implementation.
Requested model: none (source: CLI default; no model argument was supplied).
Actual model: awaiting authoritative CLI/session metadata.
Started OpenAI Codex CLI in the active workspace and waiting for card-file completion evidence.

### 2026-10-24T17:54:49.941Z - Usage Orchestrator dispatch dispatch-mvmp83jf-2 model observed
Card: card-mvmp629m-1. CLI: OpenAI Codex CLI. Stage: implementation.
Actual model: "gpt-6.1-sol" (source: Codex rollout turn_context.payload.model; attempt: dispatch-mvmp83jf-2).

### 2026-10-24 - Codex implementation and validation
Moved the dependency guard ahead of every action in src/boardLoop.ts, including definition, triage, fresh-definition movement, verification, and completion. Dependency-blocked waits no longer stall eligible work; session evidence is retained so cards resume normally when dependencies complete. Existing Backlog availability and Ready reverse-WIP dependency filtering are covered by regression tests. Added 15 tests in test/unit/boardLoop.test.ts and an Unreleased changelog entry.
Validation passed: git diff --check for touched files; npm run compile-tests; npm run compile; node --test dist-test/test/unit/boardLoop.test.js dist-test/test/unit/portfolioCliLoop.test.js (80 passed); npm test (979 passed); npm run lint. Pure loop orchestration change; no webview or interactive command changes requiring a Development Host smoke test.
STATUS: DONE

### 2026-10-24T17:56:46.773Z - Run with AI parked in Verify
Implementation finished; reassigned to Human for verification and sign-off.
