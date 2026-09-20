---
id: card-mu8r46nn-3
title: Auto-escalate a card to a stronger model after a failed attempt
column: col-mqwk2njn-4
position: -30000
assignee: { kind: ai }
createdAt: 1789844354483
updatedAt: 1789872602680
dependsOn: [card-mtx4jeej-1]
---

## Description
Choose the model automatically instead of making the user guess which cards are
hard. Split out of `card-mtx4jeej-1`, which only carries an explicit per-card
model.

Do this as deterministic escalation, not as a quality heuristic over card text:
run a card on the configured cheaper model first, and when that attempt reports
a blocked status or fails to produce the stage's completion evidence, retry the
same stage once on the configured stronger model. An escalation ladder is
observable and testable; guessing difficulty from a card's title or description
is neither.

The retry mechanics mirror the credit fallback in `card-mtx4l9l8-2` - same card,
same workspace state, one handoff in flight, the substitution recorded in
Activity - but the trigger is a failed or inconclusive attempt rather than
exhausted credits, and the provider stays the same while the model changes.

## Acceptance criteria
- [x] Escalation is opt-in, disabled by default, and configured as an ordered ladder of model names for the active provider; disabled escalation preserves the single-attempt behavior exactly.
- [x] A blocked status report or missing stage completion evidence triggers one escalation to the next model in the ladder. Credit exhaustion, authentication errors, network failures, cancellation, and a rejected model name do not trigger escalation.
- [x] A successful attempt never escalates, and escalation alone never advances the card or counts a stage as complete: the stronger model must satisfy the existing stage completion and verification evidence rules.
- [x] Escalation is bounded - each model in the ladder is tried at most once per card per loop run, and a card cannot loop between models indefinitely.
- [x] The failed attempt's process has ended before the retry starts, at most one handoff is active at a time, and repeated failure signals cannot launch duplicate handoffs.
- [x] The retry receives the same workspace, card, and stage instructions plus the reason for escalation; existing workspace edits, acceptance checkboxes, and Activity history are preserved.
- [x] A card with an explicit `preferredModel` is not escalated away from that model unless the user has opted into overriding explicit card models, and that behavior is documented in the setting description.
- [x] Escalation interacts correctly with credit fallback: exhausted credits switch provider without consuming an escalation step, and the escalation ladder is re-resolved for the replacement provider.
- [x] Each escalation is recorded in the card Activity with the time, stage, previous model, replacement model, and trigger reason, without logging credentials.
- [x] Cancelling the loop during failure handling or a retry stops further dispatches; a late exit or output event cannot restart the loop.
- [x] Automated `node:test` coverage with simulated CLI results covers escalation on a blocked report and on missing evidence, no escalation on success or on excluded failure kinds, ladder exhaustion, bounded retries, duplicate failure events, cancellation, and the credit-fallback interaction.
- [x] `npm run compile-tests`, `npm test`, `npm run compile`, and `npm run lint` pass.

## Activity
### 2026-09-20T02:17:29.395Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-09-20T03:05:00.000Z - Implemented model escalation
Added deterministic, opt-in model escalation for the AI loop.

- New `src/agentCliEscalation.ts` owns the policy: validated per-provider ladder
  (`readAgentCliEscalationLadders`, sharing the model catalog's validation),
  trigger classification (`detectAgentCliEscalationTrigger`), rung selection
  (`selectNextEscalationModel`), and the Activity/prompt formatters.
- `src/agentCliHandoff.ts` now classifies failures as a value
  (`AgentCliHandoffFailure`: card-missing / model-rejected / credit-exhausted /
  process-failed / missing-evidence) so escalation keys on the outcome rather
  than on prose, and accepts an `escalatedModel` for one dispatch.
- `src/agentCliModels.ts` gained an `escalation` model source above the card
  layer; the escalated model is never written back to the card or settings.
- `src/agentCliFallback.ts` drives escalation from the same attempt loop as the
  credit fallback, so the two compose: a spent allowance switches provider,
  clears the escalated model, and costs no rung; rungs are tracked per card and
  per provider, so the replacement CLI climbs its own ladder.
- Settings: `mwnn-kanban.aiLoopModelEscalationEnabled` (off by default),
  `...Ladder` (ordered per-CLI model names), and
  `...OverridesCardModel` (off by default; its description documents that a
  card's explicit `preferredModel` is otherwise never escalated away from).
- Tests: `test/unit/agentCliEscalation.test.ts` (16 tests across 5 suites)
  drives the real hand-off with simulated CLI processes - escalation on a
  blocked report and on missing evidence, no escalation on success, on disabled
  escalation, or on auth/network/credit/model-rejection failures, ladder
  exhaustion, per-card rung budget, duplicate failure signals, cancellation
  during failure handling, and both credit-fallback interactions.
- Docs: README settings table plus a "Model escalation after a failed attempt"
  section, and a CHANGELOG entry under Unreleased.

Validation: `npm run compile-tests`, `npm test` (450 pass / 0 fail),
`npm run compile`, and `npm run lint` all pass. No Development Host smoke test
was needed: the change adds no board or webview surface.

STATUS: DONE
