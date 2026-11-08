---
id: card-mw89f8vw-1
title: "Start the Pro trial on first Pro feature open, not on activation"
column: col-mqwk2njn-4
position: -111000
assignee: { kind: ai }
createdAt: 1794168202172
updatedAt: 1794173147691
---

## Description
Since 1.0.8, `src/pro/upgrade.ts` (around lines 150–152) calls `hasProLicense(..., { startTrialIfMissing: true })` at extension activation. That starts the 14-day local Pro trial the first time the extension activates, even for users who only ever use the free board.

The landing page (`e:\mwnn-kanban-pro\landing\index.html:393`) and every launch campaign draft promise that the trial "starts the first time you open a Pro feature". The decision recorded on `e:\mwnn-kanban-pro` card `card-mv5f2w72-2` on 2026-11-08 is to treat the activation start as a bug and keep the published promise.

Move the trial start from activation to the first time a user opens a Pro feature, meaning a gated Pro command or view such as the Portfolio or My Work. Keep the 1.0.8 guard: once a trial start is stored, nothing mints a new one. That covers clearing a key, a later gated command, and an expired trial. Activation must still publish the license context without starting a trial, and must not flash Pro views. Trials already started by 1.0.8 or 1.0.9 are not reset.

## Acceptance criteria
- [x] Activation with no stored trial start and no license key does not write `mwnn-kanban-pro.trialStartedAt`
- [x] The first time a Pro feature opens with no stored trial start and no key, the 14-day trial starts and the feature opens
- [x] A stored trial start, active or expired, is never replaced: clearing a key or running a gated command does not start a new trial
- [x] Existing trial starts from 1.0.8 and 1.0.9 are honoured unchanged
- [x] Pro views still do not flash in unlicensed windows during startup
- [x] Unit tests under `node:test` cover each case above, and `npm run compile-tests`, `npm test`, and `npm run lint` pass
- [x] CHANGELOG `[Unreleased]` records the fix

## Activity
### 2026-11-08 - Created from the launch claim check
Raised from `e:\mwnn-kanban-pro\.mwnn\cards\card-mv5f2w72-2.md`. Darren McLeod chose in the interview chat (2026-11-08) to treat the activation-time trial start as a bug rather than change the published copy.

### 2026-11-08T20:49:31.638Z - Usage Orchestrator chose Cursor Agent CLI
Stage: implementation. Cursor Agent CLI reports 71% remaining, resetting 2026-11-06T23:33:31.000Z - the soonest reset among the CLIs with usage left, so it is spent before it is lost.

### 2026-11-08T20:49:32.407Z - Usage Orchestrator dispatch dispatch-mw8b2mev-1 started
Card: card-mw89f8vw-1 ("Start the Pro trial on first Pro feature open, not on activation"). CLI: Cursor Agent CLI. Stage: implementation.
Requested model: "auto" (source: the AI loop stage model rule; passed to the CLI exactly as shown).
Actual model: awaiting authoritative CLI/session metadata.
Started Cursor Agent CLI in the active workspace and waiting for card-file completion evidence.
AI loop stage model rule for the implementation stage: auto.

### 2026-11-08T20:49:35.759Z - Usage Orchestrator dispatch dispatch-mw8b2mev-1 model observed
Card: card-mw89f8vw-1. CLI: Cursor Agent CLI. Stage: implementation.
Actual model: "Auto" (source: Cursor Agent stream-json system.init.model; attempt: dispatch-mw8b2mev-1).

### 2026-11-08 - Implemented trial start on first Pro feature open
Moved `startTrialIfMissing` off activation in `src/pro/upgrade.ts`; activation still publishes false first then the existing key/trial state. Gated Pro opens request the trial via `hasProLicense(..., { startTrialIfMissing: true })` (Pro package command gates updated; Open Portfolio is always in the command palette so a first open is reachable). Stored trial starts are never replaced. Unit tests in `test/unit/upgrade.test.ts` cover activation, first open, no-replace, and honouring prior starts. `npm run compile-tests`, `npm test` (1121/1121), and `npm run lint` passed. CHANGELOG `[Unreleased]` records the fix. Companion Pro source changes live in `e:\mwnn-kanban-pro` (gated commands pass the flag; background checks do not) and need a Pro package release for the published VSIX dependency to pick them up.
STATUS: DONE

### 2026-11-08T20:59:02.196Z - MWNN independent verification started

### 2026-11-08T20:59:02.440Z - Cursor Agent CLI implementation handoff failed
Missing or invalid verification inputs. Configure .mwnn/verification.json, with a check mapping for every acceptance criterion, before dispatch.
