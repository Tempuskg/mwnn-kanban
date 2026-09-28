---
id: card-mukc4q8f-1
title: Pass thinking levels to Copilot CLI and Claude Code CLI via --effort
column: col-mqwk2njn-4
position: -41000
assignee: { kind: ai }
createdAt: 1790544779727
updatedAt: 1790553255950
---

## Description
Today only Codex gets a thinking level. `PROVIDER_SPECS` in src/agentCliHandoff.ts has a `thinking` spec for Codex only (`-c model_reasoning_effort=<level>`). Copilot and Claude Code have none, so a level on a card or in settings for them is reported "not applied". Both CLIs now accept effort on the command line. GitHub Copilot CLI takes `--effort` (alias `--reasoning-effort`) with choices none, minimal, low, medium, high, xhigh, max. Claude Code CLI takes `--effort` with low, medium, high, xhigh, max. Add a `thinking` spec for each so a resolved level is passed as `--effort <level>`. This also makes the populate command (card-mukb0gzi-4) start writing `agentCliThinkingLevels` for these two CLIs: it keys off `AGENT_CLI_THINKING_FLAGS`, and until now it has listed their levels as "not written". Cursor stays unsupported.

Watch for: the gh-copilot launcher path (`gh copilot -- …`); Claude Code's fixed `-p` argv (make sure the flag isn't spliced between `-p` and a value); and cmd.exe shim quoting on Windows.

## Acceptance criteria
- [x] `PROVIDER_SPECS` gives `copilot` and `claude-code` a `thinking` spec, so a resolved level is spliced in as `--effort <level>` (one argv element for the value), and `AGENT_CLI_THINKING_FLAGS` reports `--effort` for both.
- [x] A run with no thinking level produces exactly the same argv as before for both CLIs.
- [x] The standalone Copilot launcher and the `gh copilot --` launcher both get the flag in a position the CLI accepts.
- [x] The not-applied reporting and help text no longer claim that Copilot CLI or Claude Code CLI lack effort support: the `package.json` descriptions for `agentCliThinkingLevels`, the `PROVIDER_SPECS` doc comment, the AGENTS.md board-contract note, and the card-authoring guidance in src/boardStore.ts.
- [x] The populate command writes discovered thinking levels for Copilot and Claude Code, and its unit tests are updated to match.
- [x] Unit tests cover the new argv for both providers, with and without a level. `npm run compile-tests`, `npm test`, and `npm run lint` pass.
- [x] Development Host smoke test: a card with `thinkingLevel.claude-code: high` runs Claude Code with `--effort high`, shown in the CLI output channel's start line.

## Activity
- 2026-09-27 Claude Code: created as a follow-up from card-mukb0gzi-4. Discovery found `--effort` choices in both CLIs' `--help`.

### 2026-09-27T22:52:14.617Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.

- 2026-09-27 Codex: Added Copilot and Claude Code --effort support, updated support guidance and populate discovery tests, and confirmed the formatted start command includes the effort flag. Validation passed: compile-tests, compile, 552 unit tests, lint, and the populate smoke. The Development Host output-channel check remains unverified because this session exposes browser controls only, with no native app windows.
STATUS: BLOCKED: Development Host smoke test could not be performed because native app UI control is unavailable in this session.

- 2026-09-27 Codex: Ran an isolated VS Code Development Host with a card containing `thinkingLevel.claude-code: high`. Claude Code completed that card; the MWNN Agent CLI output log's start command showed `claude.exe -p --permission-mode bypassPermissions --output-format text --effort high`. All acceptance criteria are verified.
STATUS: DONE
