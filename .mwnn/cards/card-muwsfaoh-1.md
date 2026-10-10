---
id: card-muwsfaoh-1
title: Create a usage orchestrator
column: col-mqwk2njn-4
position: -57000
assignee: { kind: ai }
preferredModel.copilot: claude-sonnet-4.6
preferredModel.codex: gpt-5.5
preferredModel.claude-code: opus
thinkingLevel.copilot: xhigh
thinkingLevel.codex: max
thinkingLevel.claude-code: xhigh
createdAt: 1791297740753
updatedAt: 1791547224287
---

## Description
Add a **Usage Orchestrator** choice wherever the user picks which agent CLI runs, so
dispatches are spread across the user's CLI subscriptions by their real
remaining usage, instead of draining one CLI until the credit fallback
(`card-mtx4l9l8-2`) catches the exhaustion. Today the CLI is fixed per run by
`mwnn-kanban.aiLoopProvider` or the "which local CLI?" picker, and the only
usage awareness is reactive.

With Usage Orchestrator selected, before each CLI dispatch the extension reads a
usage snapshot - remaining usage as a percentage, and when that allowance next
resets - for every available CLI, and ranks them:

1. **Soonest reset first.** Among CLIs that report usage with a reset time,
   the allowance that resets soonest is spent first, because unused allowance
   is lost at reset. Equal reset times are ranked by higher remaining
   percentage.
2. **Then unknown usage is drained.** A CLI whose usage cannot be read -
   Cursor always (it has no documented quota query), or any CLI whose probe
   fails or times out - receives every dispatch not taken by rule 1 until it
   stops accepting work (the credit fallback detects exhaustion), because there
   is no figure to balance it against. With several unknown CLIs, the built-in
   provider order decides which is drained first. An unknown CLI that has
   stopped accepting work is not chosen again for the rest of the run, since it
   reports no reset time.
3. **Then most remaining usage**, for CLIs that report a percentage but no
   reset time.

A CLI with no remaining usage is skipped until its reset time passes. A report
with several windows (e.g. a 5-hour and a weekly limit) is normalized to the
binding window: the lowest remaining percentage, with that window's reset time.
The orchestrator chooses the CLI only; the model and thinking level then
resolve for that CLI through the existing layers (card entry, stage rule,
workspace default, CLI default) exactly as for a manually picked CLI.

This card delivers the orchestrator plus its first real usage source, Codex,
via the Codex app-server `account/rateLimits/read` method, which returns usage
percentages and reset times for ChatGPT accounts
(https://learn.chatgpt.com/docs/app-server). The Claude Code and Copilot usage
sources are split into their own cards. Until they land, those CLIs are
"unknown" and are drained under rule 2 once no reporting CLI with a reset time has usage left, so this card is complete and
usable on its own.

Out of scope: the VS Code chat channel (fire-and-forget, nothing to probe);
choosing models; any built-in price table or synthesized usage figure (the
`card-mu8r46nn-4` rule stands); the Claude Code and Copilot usage sources.

## Acceptance criteria
- [x] `mwnn-kanban.aiLoopProvider` gains an `orchestrator` value with an `enumDescriptions` entry in `package.json`; the existing values, the `prompt` default, and their behavior are unchanged.
- [x] Orchestrator is offered in the local-CLI pickers used by the AI loop and by `Run Card with AI`, and choosing it (or the setting value) routes that run's CLI choice through the orchestrator.
- [x] A `vscode`-free usage-snapshot contract represents, per provider, either a remaining percentage (0-100) with an optional reset time, or "unknown" with a reason; multi-window reports normalize to the lowest remaining percentage and that window's reset time.
- [x] Ranking implements: reporting CLIs with a reset time first, by soonest reset, equal resets ranked by higher remaining percentage; then available unknown-usage CLIs in built-in provider order, each receiving every dispatch until it stops accepting work and then excluded for the rest of the run; then reporting CLIs with no reset time by higher remaining percentage; a reporting CLI at 0% skipped until its reset time has passed (for the rest of the run when it has none); CLIs whose executable is unavailable skipped; remaining ties resolved by the built-in provider order. No averaged or otherwise synthesized percentage is assigned to an unknown CLI.
- [x] In the AI loop, Orchestrator re-ranks before every CLI dispatch (every stage of every card), so one run can use several CLIs; `Run Card with AI` ranks once at dispatch.
- [x] The Codex usage source reads remaining percentage and reset times through the Codex app-server `account/rateLimits/read` method of the locally resolved `codex` executable; a non-ChatGPT account, an unsupported version, a malformed or hostile response, a nonzero exit, or a timeout yields "unknown" with a reason, and the probe process has ended before the dispatch starts.
- [x] Probing never blocks or fails a dispatch: each probe has a bounded timeout, available CLIs are probed concurrently, a snapshot is reused only within a short documented freshness window, and probe failures (including every CLI being unknown) still produce a choice.
- [x] When an orchestrated AI-loop stage reports credit exhaustion, the same stage is retried on the next-ranked eligible CLI with the existing credit-fallback guarantees: the failed process has ended first, at most one handoff is active, the latest card contents are used, and a switch never advances the card on its own. The exhausted CLI is not chosen again in that run before its reset time (an unknown-usage CLI, which has no reset time, is not chosen again in that run at all).
- [x] The Activity entry for each orchestrated dispatch names the chosen CLI and why (its reported remaining percentage and reset time, or that its usage is unknown and it is being drained until it stops accepting work), and the full candidate ranking, with skipped CLIs and reasons, goes to the existing agent-CLI output.
- [x] Usage data comes only from the locally installed CLIs: the extension makes no new direct network requests (the README privacy statement stays true), and probe output passes through the existing secret redaction before it is logged or written to a card.
- [x] With any selection other than Orchestrator, no usage probe runs and CLI choice, arguments, and dispatch behavior are unchanged.
- [x] README documents the Orchestrator option, the ranking rules, the rule that unknown-usage CLIs are drained after reset-reporting CLIs, and per-CLI usage sources (Codex supported; Claude Code and Copilot pending; Cursor always unknown).
- [x] `node:test` coverage over `dist-test/` covers each ranking rule (including a reset-reporting CLI outranking an unknown one, draining an unknown CLI until exhaustion, then the next unknown, then reporting CLIs with no reset time), reset expiry, multi-window normalization, Codex response parsing including malformed input, exhaustion re-routing, and the unchanged non-Orchestrator path.
- [x] `npm run compile-tests`, `npm test`, `npm run compile`, and `npm run lint` pass, and a Development Host smoke test shows Orchestrator selectable in the setting and both pickers, with a loop run choosing a CLI.

## Activity
### 2026-10-06T14:42:48.939Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.

### 2026-10-06T15:28:19.578Z - Split into multiple cards
Split the per-CLI usage sources out of this card, which keeps the orchestrator and the Codex source: `card-muwu2fei-1` (Claude Code usage source) and `card-muwu2fei-2` (GitHub Copilot usage source).

### 2026-10-06T15:29:29.855Z - Run settings recommended by Jev
Jev (TypeSafe) judged this card's difficulty tier: **heavy**.

- copilot: model `claude-sonnet-4.6`, thinking level `xhigh`
- codex: model `gpt-5.5`, thinking level `max`
- claude-code: model `opus`, thinking level `xhigh`

### 2026-10-07T14:54:18.858Z - Auto-start held in Ready
Assigned to AI, but the card stays in Ready: "Ready" has 1 of its 3 defined cards (reverse WIP) and Backlog still has cards to define.

### 2026-10-07T14:58:10.094Z - Unknown-usage rule changed
Replaced the average-imputation rule: a CLI whose usage cannot be read now receives every dispatch until it stops accepting work, then is excluded for the rest of the run, before the reporting CLIs are ranked by reset time and remaining usage.

### 2026-10-07T15:14:00.826Z - Ranking order changed
Reordered the ranking: reporting CLIs with a reset time come first (soonest reset, then most remaining), then unknown-usage CLIs are drained until they stop accepting work, then reporting CLIs with no reset time by most remaining.

### 2026-10-07T16:18:13.215Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-10-07 Claude Code (claude-opus-5-5, the requested `opus`): Usage Orchestrator implemented
- New vscode-free modules: `src/agentCliUsage.ts` (snapshot contract, multi-window normalization, Codex `account/rateLimits/read` parsing, ranking), `src/agentCliUsageProbe.ts` (bounded `codex app-server` JSON-RPC probe that waits for the process to end before resolving; Claude Code/Copilot pending, Cursor always unknown), `src/agentCliOrchestrator.ts` (concurrent probing, 60 s freshness window, 10 s probe timeout (later raised to 20 s), exhaustion with reset times, Activity/ranking text).
- `src/agentCliFallback.ts`: optional `orchestrator` dep re-ranks before every stage and picks the replacement after credit exhaustion. It keeps the existing guarantees and pauses when nothing is eligible. Without the dep, nothing changes.
- `aiLoopProvider` gains `orchestrator` (package.json enum + enumDescriptions). The AI loop CLI picker and the Run Card with AI picker offer Usage Orchestrator. `runCardWithAgentCli` ranks once at dispatch.
- README (Usage Orchestrator section, privacy line, settings row) and CHANGELOG updated.
- Tests: new `test/unit/agentCliUsage.test.ts` and `test/unit/agentCliOrchestrator.test.ts`, which include real-process probe tests against a fake app-server. `test/unit/runWithAi.test.ts` choice-list tests updated.
- Validation: `npm run compile-tests`, `npm test` (648/648), `npm run compile`, and `npm run lint` all pass. A real probe against the installed Codex 0.146 (ChatGPT plus) ranked Codex first at 94% remaining with its reset time and the other CLIs as unknown, in about 2 s.
- Not done: the Development Host smoke test needs a person. Steps: F5 to launch the Extension Development Host. (1) In Settings, check that `mwnn-kanban.aiLoopProvider` lists `orchestrator`. (2) Leave it at `prompt`, run the AI loop, choose Local agent CLI, and check that "Usage Orchestrator" is in the CLI picker. Pick it and confirm the card Activity shows "Usage Orchestrator chose ..." and the MWNN Agent CLI output shows the ranking. (3) Run Card with AI on an AI card and check that "Usage Orchestrator" is in the provider picker.
STATUS: BLOCKED: Development Host smoke test (setting + both pickers + a loop run choosing a CLI) needs a human; every other criterion is met and verified.

STATUS: DONE
