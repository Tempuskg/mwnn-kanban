---
id: card-mtx4l9l8-2
title: Have ability to auto switch to another cli during Ai loop if run out of credits
column: col-mqwk2njn-4
position: -26000
assignee: { kind: ai }
createdAt: 1789141392332
updatedAt: 1789843625554
---

## Description
Allow an AI loop to continue automatically with another user-configured CLI when the active CLI reports exhausted credits or a usage/session quota. Retry the interrupted card stage using the current card and workspace state, then use the replacement CLI for the rest of that loop run. Make fallback opt-in, ordered, bounded, and visible to the user. This work belongs to the existing AI-loop and CLI handoff flow in the free `mwnn-kanban` extension; any new settings must be declared in that extension's manifest.

## Acceptance criteria
- [x] The user can enable automatic fallback and configure an ordered list of supported CLI providers. Fallback is disabled by default; disabled fallback preserves the existing single-CLI behavior.
- [x] A recognized credit-exhaustion or usage/session-limit failure triggers fallback during any CLI-backed AI-loop stage (definition, triage, implementation, or verification). Authentication errors, network failures, transient rate limits, generic nonzero exits, and missing completion evidence do not trigger credit fallback.
- [x] With CLI A active and B then C configured as fallbacks, exhaustion of A selects B without another user action. Duplicate providers, the exhausted provider, and providers whose executable is unavailable are skipped; if B also exhausts its allowance, C is selected.
- [x] The failed CLI process has ended before its replacement starts. Repeated failure signals cannot launch duplicate handoffs, and at most one CLI handoff is active for the loop at a time.
- [x] The replacement receives the same workspace, card, stage instructions, and required completion markers, plus the latest card contents and a handoff note explaining the interruption. Existing workspace edits, acceptance checkboxes, and Activity history are preserved; completed stages are not restarted.
- [x] A switch alone never advances the card or counts a stage as complete. The replacement must satisfy the existing stage-specific completion and verification evidence rules before the loop advances.
- [x] After a successful fallback, subsequent handoffs in that loop run use the replacement CLI. Providers exhausted during the run are not retried during that run, and the user's saved primary CLI preference is unchanged.
- [x] If no eligible fallback remains, the loop pauses without advancing the interrupted card, records the reason, and tells the user to restore credits or configure an available CLI before resuming. It does not cycle through providers indefinitely.
- [x] Cancelling the loop during failure handling or a replacement handoff stops further dispatches; a late exit or output event cannot restart the loop.
- [x] Loop progress identifies the active CLI. Each switch is recorded in the card Activity with the time, interrupted stage, previous CLI, replacement CLI, and exhaustion reason, without logging credentials.
- [x] Automated `node:test` coverage uses simulated CLI results to verify successful fallback, ordered chaining, unavailable and duplicate providers, exhaustion of all fallbacks, disabled fallback, unrelated failures, duplicate failure events, cancellation, and preservation of stage completion rules. A smoke test from the free extension verifies that a simulated credit failure continues the same card stage and displays the switch without consuming real paid credits.

## Activity
### 2026-09-15T03:00:46.680Z - Definition requested from Codex (ChatGPT)
Asked Codex (ChatGPT) to fill in the Description and Acceptance criteria for this card.

### 2026-09-15T03:02:15.843Z - Definition requested from Codex (ChatGPT)
Asked Codex (ChatGPT) to fill in the Description and Acceptance criteria for this card.

### 2026-09-15T12:53:40.682Z - Moved from the mwnn-kanban-pro board
Scoped as a free-extension feature, not Pro. The AI loop and agent CLI handoff live entirely in this repo (`src/agentCliHandoff.ts`, `src/boardLoop.ts`, `src/aiLoopProvider.ts`); the Pro package contains no AI-loop code. Gating credit fallback behind Pro would degrade an existing free feature and would require exposing the CLI handoff lifecycle as a new cross-repo capability. Moved from `mwnn-kanban-pro` Ready to this board's Ready column, keeping the original id and createdAt.

### 2026-09-19T18:31:45.662Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-09-19T19:45:00.000Z - Implemented by Claude Code
Added opt-in credit fallback for the AI loop's CLI handoffs.

- New `src/agentCliCredit.ts` classifies a finished CLI process as credit/usage-limit exhaustion, excluding auth, network, transient rate-limit and generic failures, and redacts credentials from the recorded detail.
- `src/agentCliHandoff.ts` attaches a `creditExhaustion` signal (and a tailored failure reason) to the handoff result; evidence rules are unchanged.
- New `src/agentCliFallback.ts` holds the per-run fallback policy: ordered chaining, duplicate/exhausted/unavailable providers skipped, one handoff at a time, cancellation checks, switch and pause Activity entries, progress lines naming the active CLI, and a handoff note plus freshly reloaded card contents for the replacement.
- `src/extension.ts` routes all four loop stages (definition, triage, implementation, verification) through the fallback runner and pauses the loop when no eligible CLI remains; prompts are now rebuilt per attempt.
- New settings `mwnn-kanban.aiLoopCliFallbackEnabled` (default `false`) and `mwnn-kanban.aiLoopCliFallbackOrder` (default `[]`) declared in `package.json`; documented in `README.md` and `CHANGELOG.md`.
- Tests: `test/unit/agentCliFallback.test.ts` (22 `node:test` cases with simulated CLI results) and `scripts/smoke-cli-fallback.cjs` (`npm run smoke:cli-fallback`), which drives the real board store and board loop with a simulated credit failure and spends no real credits.

Validation: `npm run compile-tests`, `npm test` (373 pass, 0 fail), `npm run compile`, `npm run lint`, `node ./scripts/smoke-cli-fallback.cjs` (SMOKE PASS). Not run: a Development Host smoke test of the loop UI, since the switch surfaces through existing notification/progress/output-channel paths only.

STATUS: DONE
