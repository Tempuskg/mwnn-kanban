---
id: card-muwsfaoh-1
title: Create a usage orchestrator
column: col-mqwk2njn-2
position: 1000
preferredModel.copilot: claude-sonnet-4.6
preferredModel.codex: gpt-5.5
preferredModel.claude-code: opus
thinkingLevel.copilot: xhigh
thinkingLevel.codex: max
thinkingLevel.claude-code: xhigh
createdAt: 1791297740753
updatedAt: 1791300569989
---

## Description
Add an **Orchestrator** choice wherever the user picks which agent CLI runs, so
dispatches are spread across the user's CLI subscriptions by their real
remaining usage, instead of draining one CLI until the credit fallback
(`card-mtx4l9l8-2`) catches the exhaustion. Today the CLI is fixed per run by
`mwnn-kanban.aiLoopProvider` or the "which local CLI?" picker, and the only
usage awareness is reactive.

With Orchestrator selected, before each CLI dispatch the extension reads a
usage snapshot - remaining usage as a percentage, and when that allowance next
resets - for every available CLI, and ranks them:

1. **Soonest reset first.** Allowance that resets soonest is spent first,
   because unused allowance is lost at reset.
2. **Then most remaining usage**, for equal reset times and for CLIs that
   report no reset time.
3. **Unknown usage is the average of the others.** A CLI whose usage cannot be
   read - Cursor always (it has no documented quota query), or any CLI whose
   probe fails or times out - is treated as having the mean remaining
   percentage of the CLIs that did report, and no reset time.

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
"unknown" and get the averaged value, so this card is complete and usable on
its own.

Out of scope: the VS Code chat channel (fire-and-forget, nothing to probe);
choosing models; any built-in price table or synthesized usage figure (the
`card-mu8r46nn-4` rule stands); the Claude Code and Copilot usage sources.

## Acceptance criteria
- [ ] `mwnn-kanban.aiLoopProvider` gains an `orchestrator` value with an `enumDescriptions` entry in `package.json`; the existing values, the `prompt` default, and their behavior are unchanged.
- [ ] Orchestrator is offered in the local-CLI pickers used by the AI loop and by `Run Card with AI`, and choosing it (or the setting value) routes that run's CLI choice through the orchestrator.
- [ ] A `vscode`-free usage-snapshot contract represents, per provider, either a remaining percentage (0-100) with an optional reset time, or "unknown" with a reason; multi-window reports normalize to the lowest remaining percentage and that window's reset time.
- [ ] Ranking implements: soonest reset first; equal or missing reset ranked by higher remaining percentage; unknown CLIs imputed with the mean remaining percentage of the reporting CLIs and no reset time; a CLI at 0% skipped until its reset time has passed (for the rest of the run when it has none); CLIs whose executable is unavailable skipped; final ties and the all-unknown case resolved by the built-in provider order.
- [ ] In the AI loop, Orchestrator re-ranks before every CLI dispatch (every stage of every card), so one run can use several CLIs; `Run Card with AI` ranks once at dispatch.
- [ ] The Codex usage source reads remaining percentage and reset times through the Codex app-server `account/rateLimits/read` method of the locally resolved `codex` executable; a non-ChatGPT account, an unsupported version, a malformed or hostile response, a nonzero exit, or a timeout yields "unknown" with a reason, and the probe process has ended before the dispatch starts.
- [ ] Probing never blocks or fails a dispatch: each probe has a bounded timeout, available CLIs are probed concurrently, a snapshot is reused only within a short documented freshness window, and probe failures (including every CLI being unknown) still produce a choice.
- [ ] When an orchestrated AI-loop stage reports credit exhaustion, the same stage is retried on the next-ranked eligible CLI with the existing credit-fallback guarantees: the failed process has ended first, at most one handoff is active, the latest card contents are used, and a switch never advances the card on its own. The exhausted CLI is not chosen again in that run before its reset time.
- [ ] The Activity entry for each orchestrated dispatch names the chosen CLI and why (its remaining percentage and reset time, marked reported or imputed), and the full candidate ranking, with skipped CLIs and reasons, goes to the existing agent-CLI output.
- [ ] Usage data comes only from the locally installed CLIs: the extension makes no new direct network requests (the README privacy statement stays true), and probe output passes through the existing secret redaction before it is logged or written to a card.
- [ ] With any selection other than Orchestrator, no usage probe runs and CLI choice, arguments, and dispatch behavior are unchanged.
- [ ] README documents the Orchestrator option, the ranking rules, the average-imputation rule, and per-CLI usage sources (Codex supported; Claude Code and Copilot pending; Cursor always imputed).
- [ ] `node:test` coverage over `dist-test/` covers each ranking rule, reset expiry, multi-window normalization, Codex response parsing including malformed input, exhaustion re-routing, and the unchanged non-Orchestrator path.
- [ ] `npm run compile-tests`, `npm test`, `npm run compile`, and `npm run lint` pass, and a Development Host smoke test shows Orchestrator selectable in the setting and both pickers, with a loop run choosing a CLI.

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
