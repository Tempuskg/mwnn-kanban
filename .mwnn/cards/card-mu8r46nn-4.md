---
id: card-mu8r46nn-4
title: Report AI loop usage and enforce a per-run dispatch budget
column: col-mqwk2njn-4
position: -31000
assignee: { kind: ai }
createdAt: 1789844354483
updatedAt: 1789906042523
---

## Description
Give the user a way to see and cap what an AI loop run consumes. Today a run can
dispatch an unbounded number of CLI handoffs with no visible tally, and the only
stop signal is the credit exhaustion handled by `card-mtx4l9l8-2` - by which
point the allowance is already spent. Split out of `card-mtx4jeej-1`.

Budget on what the extension can actually observe: the number of handoffs per
run, per stage, per provider, and per model, plus whatever usage or cost lines
the CLIs already print. Do not ship a hardcoded per-model price table - prices
change between extension releases and the CLIs do not report cost uniformly, so
a built-in table would quietly mislead. If a monetary figure is shown, it must
come from the CLI's own output and be labelled as such.

Independent of the per-card model field, but composes with it: the tally is
grouped by the model each dispatch actually ran on, so the numbers stay
meaningful once models vary per card.

## Acceptance criteria
- [x] Each loop run tallies dispatches by stage, provider, and resolved model, and reports the tally to the user when the run ends, including runs that end by pausing, blocking, or cancellation.
- [x] Usage or cost figures parsed from CLI output are attributed to the reporting CLI and never synthesized from a built-in price table; a CLI that reports nothing shows dispatch counts only, with no invented figures.
- [x] A configurable maximum number of dispatches per loop run is available and disabled by default; when disabled, run length and behavior are unchanged.
- [x] Reaching the cap stops the run without advancing the in-flight card, records the reason in that card's Activity, and tells the user the cap was hit and how to raise or clear it.
- [x] The cap never leaves a card half-dispatched: the active CLI process has ended before the run stops, and no further handoffs are launched afterwards.
- [x] A run stopped on budget is distinguishable from credit exhaustion and from normal completion in both the user-facing message and the Activity entry.
- [x] Cancelling a run reports the partial tally, and a late exit or output event cannot resume a run stopped by the cap.
- [x] Parsed CLI output is never logged with credentials, and unparseable or hostile output cannot crash the run or corrupt the tally.
- [x] Tally and cap logic live in a module with no `vscode` import, with `node:test` coverage over `dist-test/` for counting by stage and model, cap enforcement, disabled cap, cancellation, missing usage output, and malformed usage output.
- [x] `npm run compile-tests`, `npm test`, `npm run compile`, and `npm run lint` pass.

## Activity
### 2026-09-20T02:51:16.418Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-09-20T03:02:15.970Z - Claude Code implemented the card
Added `src/aiLoopBudget.ts`, a pure module (no `vscode` import) holding the
per-run ledger: it counts each dispatch by stage, provider, and the model the
dispatch actually ran on, enforces an optional cap, scans CLI output for usage
or cost lines, and formats the tally, the stop notification, and the stop
Activity entry. No price table is shipped; every monetary or token figure is a
line the CLI printed itself, redacted and attributed to that CLI.

`src/agentCliFallback.ts` gained `beforeDispatch` / `afterDispatch` hooks and a
new `stopped` outcome. The veto is consulted immediately before every process
the runner launches - first attempt, credit-fallback replacement, and model
escalation retry alike - so the cap bounds real dispatches rather than whole
stages, and a refusal spawns nothing at all. `afterDispatch` fires only after
the awaited process has ended, carrying the model that actually ran.

`src/extension.ts` creates one ledger per loop run, wires the hooks in CLI mode,
wraps the CLI observer so `onExit` feeds stdout/stderr to the usage scanner,
and applies the same reserve/settle path to the four chat gateways (collapsed
into one shared `runChatHandoff` helper). A denied dispatch appends the budget
stop entry to the in-flight card, cancels the run without advancing that card,
and the closing notification reports the tally labelled `finished`,
`cancelled`, `paused` (spent credits), or `budget`, so the three stop reasons
are distinguishable. Added the `mwnn-kanban.aiLoopMaxDispatches` setting
(default `0` = disabled) in `package.json`, plus README and CHANGELOG entries.

Coverage: `test/unit/aiLoopBudget.test.ts`, 22 tests over `dist-test/` -
counting by stage/provider/model, cap enforcement, disabled and malformed caps,
latched stop against late settle/usage events, partial tally on cancellation,
missing usage output, malformed/binary/hostile/oversized output, credential
redaction, and three integration tests against the real fallback runner
covering escalation-retry counting, the pre-launch veto, and byte-equivalent
behavior when the cap is off.

Validation: `npm run compile-tests`, `npm test` (472 pass, 0 fail),
`npm run compile`, and `npm run lint` all pass.

STATUS: DONE
