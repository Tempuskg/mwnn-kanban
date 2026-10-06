---
id: card-muwu2fei-1
title: Read Claude Code remaining usage for the usage orchestrator
column: col-mqwk2njn-2
position: 2000
createdAt: 1791300499578
updatedAt: 1791300499578
dependsOn: [card-muwsfaoh-1]
---

## Description
Feed Claude Code's plan usage into the usage-snapshot contract from
`card-muwsfaoh-1`, so the orchestrator ranks Claude Code by its real remaining
usage and reset time instead of the averaged value it gets as an "unknown" CLI.

Documented sources: `/usage` shows plan usage limits
(https://code.claude.com/docs/en/commands), and supported subscriptions expose
usage percentages and reset times through status-line JSON
(https://code.claude.com/docs/en/statusline). Status-line JSON is produced
inside an interactive session, so part of this card is establishing a
non-interactive read path the extension can use with the installed `claude`
executable. Where no supported path exists for an installed version or account
type (e.g. an API-key account instead of a subscription), Claude Code stays
"unknown", with the reason stated.

Claude Code reports a 5-hour session window and a weekly window; both are
normalized to the binding window by the rule in `card-muwsfaoh-1`.

## Acceptance criteria
- [ ] A Claude Code usage source returns the snapshot contract (remaining percentage and reset time) for subscription accounts that expose plan usage, normalizing the session and weekly windows to the binding window.
- [ ] Usage is read only through the locally installed `claude` executable, resolved the same way as dispatch (honoring `mwnn-kanban.agentCliPaths`); the extension makes no direct network requests and never reads Claude Code credentials or tokens itself.
- [ ] Reading usage never sends a prompt to a model, so the probe does not spend the allowance it measures.
- [ ] An API-key account, an unsupported version, missing fields, malformed or hostile output, a nonzero exit, or a timeout yields "unknown" with a reason, never an error or a failed dispatch, and any probe process has ended within its timeout.
- [ ] README documents the chosen read path and the Claude Code versions and account types it supports, alongside the Codex source.
- [ ] `node:test` coverage over `dist-test/` uses fixture outputs for both windows, a single window, a missing reset time, an API-key account, and malformed output.
- [ ] `npm run compile-tests`, `npm test`, `npm run compile`, and `npm run lint` pass, and a Development Host smoke test with a subscription account shows Claude Code ranked by reported (not imputed) usage.

## Activity
