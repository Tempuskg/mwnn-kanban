---
id: card-mr51u2nv-2
title: "In AI Loop it is timing out, rearchitect the loop so it never timesout"
column: col-mqxta6ho-4
position: 1000
assignee: { kind: human }
createdAt: 1783090146811
updatedAt: 1783166329917
---

## Description
`runBoardLoop` in `src/boardLoop.ts` gives up on any pending hand-off (dispatch, definition request, or fallback triage) once it has waited longer than `waitTimeoutMs` (default `DEFAULT_WAIT_TIMEOUT_MS`, 15 minutes): the card is marked skipped for the rest of the run and an "AI loop timed out" entry is appended. Real agent work routinely takes longer than that, so the loop abandons cards that are still actively being worked on.

Rearchitect the wait handling so elapsed wall-clock time is never a reason to give up on a card. A pending wait should end only on a terminal signal — the agent's `STATUS: DONE`/`STATUS: BLOCKED` report, the definition being filled in, the triage assignee being recorded, the card being moved or deleted (existing `pruneLoopSession` behavior), or the user cancelling the loop. Cancellation remains the user's escape hatch for a genuinely stuck agent, so it must stay responsive during long waits, and the progress reporting should make it obvious what the loop is waiting on and for how long, so an indefinite wait never looks like a hang.

## Acceptance criteria
- [ ] No code path in `runBoardLoop` skips, abandons, or otherwise gives up on a card because of elapsed time; pending dispatch, definition, and triage waits persist until a terminal signal, board invalidation, or user cancellation.
- [ ] The `waitTimeoutMs` option, `DEFAULT_WAIT_TIMEOUT_MS`, and `formatLoopTimeoutEntry` are removed (or repurposed as informational-only stall notices that never skip the card), and no "AI loop timed out" activity entries are written.
- [ ] A unit test proves a dispatched card waiting well past the old 15-minute threshold is still advanced normally when its `STATUS: DONE` report eventually appears.
- [ ] Cancelling the loop while waits are pending still exits promptly and does not mark the waited-on cards as skipped or append failure entries to them.
- [ ] Existing wait-invalidation behavior is preserved: a waited-on card that is moved out of its dispatch column or deleted drops its wait record without stalling the loop.
- [ ] While waiting, the progress message (`onEvent`) reports what is being waited on, including how long the longest wait has been pending, so users can distinguish a long-running agent from a hang.
- [ ] Timeout-based unit tests in `test/unit/boardLoop.test.ts` are updated to the new architecture, and the full test suite and lint pass.

## Activity
### 2026-07-03T14:49:27.391Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.

### 2026-07-04T11:48:10.669Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-07-04T12:05:00.000Z - Implemented by Claude Code
Removed the wait timeout from `runBoardLoop` in `src/boardLoop.ts`: deleted `DEFAULT_WAIT_TIMEOUT_MS`, the `waitTimeoutMs` option, `formatLoopTimeoutEntry`, and the timed-out branch that skipped cards and appended "AI loop timed out" entries. Pending dispatch/definition/triage waits now persist until a terminal signal (STATUS report, definition filled, assignee recorded), board invalidation via `pruneLoopSession`, or user cancellation — elapsed time never ends a wait. The per-poll progress message now names what the loop is waiting on and how long the longest wait has been pending (e.g. `Waiting for the agent working on "X" (waiting 40m)`), so an indefinite wait is distinguishable from a hang; cancellation is still checked every poll interval. Replaced the timeout unit test with three new ones: a dispatch that reports DONE after 50 simulated minutes still advances normally (with wait-duration progress messages asserted), cancelling mid-wait exits promptly without skipping or writing failure entries to the waited-on card, and a waited-on card moved out of its dispatch column drops its wait record without stalling the loop. `npm test` (132 passing), `npm run compile`, and `npm run lint` all pass.
