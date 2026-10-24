---
id: card-mvmm9bw9-1
title: Add behind-pace-only orchestration to the free extension
column: col-mqwk2njn-4
position: -89000
assignee: { kind: ai }
createdAt: 1792859505273
updatedAt: 1792861178728
---

## Description
Implement the behind-pace-only Usage Orchestrator behavior in this free-extension repo, including the setting, per-window usage data, pace eligibility, and scheduled waits. The companion Pro UI work remains on card-mvmh7o9f-1 in the Pro repo.

Pace uses the same rule as the Pro AI Provider Usage report (`aiUsagePace` in `src/aiUsage.ts`): variance is used % minus elapsed % at the reading's as-of time. Below -5 points (`AI_USAGE_PACE_TOLERANCE_POINTS`) is behind, within ±5 is on pace, and above +5 is ahead. A CLI is eligible only when every known-length window it reports is behind. Unknown, stale (older than a tenth of a window), and reset windows cannot be classified. Predictions assume no further use; the latest predicted behind time across a CLI's windows determines that CLI's time, and the earliest time across CLIs determines the next wake.

This repo owns the Usage Orchestrator, probes, fallback runner, wait, and manifest. Both the board AI loop and Portfolio AI loop host use them. Run Card with AI, fixed-CLI runs, and configured fallback order remain unchanged. No new probes, processes, or network calls are added.

## Acceptance criteria
- [x] `package.json` declares boolean `mwnn-kanban.usageOrchestratorBehindPaceOnly`, default `false`, with the same scope as `mwnn-kanban.usageOrchestratorExcludedClis`. Its description explains the behind-pace rule, the wait, and that the wait is capped by `mwnn-kanban.aiLoopUsageResetMaxWaitHours`.
- [x] With the option `false`, or for a run that is not orchestrated, or for Run Card with AI, ranking, fallback, reset waits, pauses, and Activity entries behave exactly as today. The existing orchestrator, fallback, and usage-wait tests pass unmodified.
- [x] Reported usage snapshots keep each window's used/remaining %, reset time, and length when the source states one: Claude Code 5-hour and weekly windows, Codex `windowDurationMins`, and Cursor usage-v1 `seconds` for both Auto and Other Models pools. Existing binding `remainingPercent`/`resetsAt` values remain unchanged for ranking and reset waits.
- [x] A pure, `vscode`-free pace function classifies one window as behind, on pace, ahead, or unknown, using the same formula and constants as Pro's `aiUsagePace` and `aiUsageCurrentPace`: 5-point tolerance, freshness of a tenth of the window, and a reset since the reading means unknown. `node:test` covers exactly -5 (on pace), just below -5 (behind), a stale reading, a reset window, and a window with no length.
- [x] With the option on in an AI loop run, the orchestrator ranks only CLIs that are behind on every known-length window, keeping the existing rank order among them. Every other CLI appears in ranking output as skipped with its reason: ahead or on pace with variance points and elapsed %, or pace unknown with why. Unknown-usage CLIs are not drained in this mode.
- [x] The option is checked on every dispatch: the first stage, each later stage, the replacement after mid-stage credit exhaustion, and the CLI resumed after a usage-reset wait. No CLI that is not behind at dispatch time is launched.
- [x] When no CLI is behind, the loop waits rather than pausing or stopping. It waits until the earliest computable predicted behind time plus the existing 90-second grace, then re-probes and re-ranks. If no CLI is behind after re-probing, it recomputes and waits again. Injected-clock tests cover one window, multiple windows (the latest decides), a crossing after reset, and choosing the earliest time across CLIs.
- [x] When no candidate has a computable predicted time, the loop rechecks every 30 minutes.
- [x] Every pace wait is capped by `mwnn-kanban.aiLoopUsageResetMaxWaitHours`, and `0` disables pace waits. A predicted time beyond the cap ends the run the same way today's "no eligible CLI" outcome does, with a reason naming the earliest predicted CLI and time and the setting.
- [x] A pace wait reuses the existing wall-clock wait, which sleeps at most one minute at a time. Stop ends it immediately and leaves the card not advanced. Pause holds the next dispatch; nothing is dispatched during the wait; and a machine that slept past the target resumes within one tick.
- [x] Activity records one entry when a pace wait begins and one when it ends. The start entry says which CLIs are not behind and why, the predicted CLI and time, and the cap. The end entry names the CLI that fell behind and is being dispatched. The orchestrator choice entry states the chosen CLI's variance. Text is redacted the same way existing entries.
- [x] The Portfolio AI loop host adds an additive optional pace-wait field to `src/pro/contracts.ts` and reports it through `usageWait`. It still sets `nextCheckAt` to the wake time so older Pro packages show a check time.
- [x] `npm run compile-tests`, `npm run compile`, focused relevant tests, `npm test`, and `npm run lint` pass.

## Activity
### 2026-10-24T16:35:34.404Z - Handed off to GitHub Copilot
Dispatched this card to GitHub Copilot. The agent should append its completion note below.

### 2026-10-24 - Behind-pace-only orchestration implemented
Added `mwnn-kanban.usageOrchestratorBehindPaceOnly` (default false, resource scope). Extended usage snapshots with per-window used/remaining/reset/length (Claude 5h+weekly, Codex `windowDurationMins`, Cursor usage-v1 `seconds`) while keeping binding `remainingPercent`/`resetsAt`. Pure `src/agentCliUsagePace.ts` mirrors Pro pace/freshness; ranking filters to behind-only when the setting is on for AI loop / Portfolio orchestrated runs (not Run Card with AI). Pace waits reuse wall-clock ticks + 90s grace, 30-minute recheck, and `aiLoopUsageResetMaxWaitHours` cap; Activity start/end + choice variance; Portfolio `usageWait.paceWait` with `nextCheckAt`. `compile-tests`, `compile`, focused tests, `npm test` (964 pass), and `lint` all green.

STATUS: DONE
