---
id: card-ms1w43su-1
title: add cli option to run with ai
column: col-mqwk2njn-4
position: -10000
assignee: { kind: human }
createdAt: 1785075920958
updatedAt: 1785079157200
---

## Description
Let the per-card **Run with AI** action use a locally installed agent CLI, not only a VS Code chat extension. Today `runCardWithAI` always calls `pickChatProvider()`, so the only targets are the Copilot, Codex, and Claude Code chat extensions — even though the AI board loop already supports headless GitHub Copilot CLI, OpenAI Codex CLI, Anthropic Claude Code CLI, and Cursor Agent CLI through the shared `agentCliHandoff` layer (resolution, spawning, path overrides, failure reporting, cancellation).

Extend the Run with AI provider selection so the user can choose an agent CLI as the execution target for a single card. The CLI receives the same card handoff prompt as the chat path, runs in the workspace root, and the dispatch is recorded in the card's Activity log just like a chat handoff. Reuse the existing `agentCliHandoff` provider registry and the `mwnn-kanban.agentCliPaths` overrides rather than duplicating provider-specific logic; the existing chat-extension options and their behaviour must be unchanged.

## Acceptance criteria
- [x] The Run with AI provider picker (command palette and card-button entry points) offers the four agent CLI providers (GitHub Copilot CLI, OpenAI Codex CLI, Anthropic Claude Code CLI, Cursor Agent CLI) alongside the existing chat-extension options, with labels that make clear which are CLIs.
- [x] Choosing a CLI provider launches that CLI headlessly in the workspace root with the same card handoff prompt used by the chat path, reusing the shared `agentCliHandoff` resolution and spawn logic (no provider-specific argument logic duplicated in `extension.ts`).
- [x] CLI executable resolution honours the `mwnn-kanban.agentCliPaths` overrides, including paths containing spaces.
- [x] A successful CLI dispatch appends a handoff entry to the card's `## Activity` section naming the CLI provider, and the board panel refreshes to show it.
- [x] When the selected CLI is missing or fails to start, the user sees an actionable error naming the provider and attempted command, and no handoff Activity entry is recorded.
- [x] A CLI run that exits unsuccessfully surfaces the failure to the user instead of reporting success, and the card is left in a recoverable state (no false completion or column change).
- [x] The existing per-card in-flight guard covers CLI runs: starting a second Run with AI on the same card while a CLI run is active shows the "already in progress" message instead of spawning another process.
- [x] The existing chat-extension handoff options continue to work unchanged, and the whole action remains gated by `mwnn-kanban.enableRunWithAI`.
- [x] Unit tests cover the extended provider selection, CLI dispatch success (including the Activity entry), missing executable, unsuccessful exit, and the in-flight guard; compilation, lint, and the full test suite pass.

## Activity
### 2026-07-26T14:25:41.144Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.

### 2026-07-26T14:28:51.905Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-07-26T15:20:00.000Z - Implemented by Claude Code
Extended the per-card Run with AI action to support the four local agent CLIs alongside the existing chat extensions.

- New `src/runWithAi.ts`: `listRunWithAiProviderChoices` builds the combined picker (chat entries labelled "VS Code chat extension", CLI entries labelled "Local agent CLI" using the shared `AGENT_CLI_LABELS`, which all contain "CLI"), and `runCardWithAgentCli` dispatches one card through the shared `agentCliHandoff` layer — `resolveAgentCliTarget` (honouring `mwnn-kanban.agentCliPaths`, including quoted paths with spaces) and `runAgentCliCardHandoff` (start/failure/cancellation Activity entries, exit-code and STATUS-evidence validation). No provider-specific argument logic was added to `extension.ts`.
- `extension.ts`: `runCardWithAISelection` (both the command-palette and card-button entry points) now uses the combined picker; a CLI choice runs behind a cancellable progress notification in the workspace root, refreshes the board panel, and reports the outcome (done / blocked / failure reason / stopped). A resolution failure shows the shared actionable message naming the provider, attempted command, and the `agentCliPaths` setting, and records nothing on the card. The existing `runCardHandoff` in-flight guard wraps the whole action, so a second run on a busy card shows the "already in progress" message. Chat handoffs, other chat-picker consumers (`Fill in with AI`, `Import Plan`, loop chat mode), and the `mwnn-kanban.enableRunWithAI` gate are unchanged; `pickChatProvider` was only refactored to share its discovery step.
- Docs: README command/settings/feature rows and the `agentCliPaths` setting description in `package.json` now mention the per-card CLI path; CHANGELOG entry added.
- Tests: new `test/unit/runWithAi.test.ts` (16 tests) covers the combined picker (order, labels, no-chat case, unchanged chat targets), successful dispatch with the exact prompt and the Activity start entry plus board refresh, the spaces-in-path override, missing executables for all four providers with no Activity written, unsuccessful exit, missing terminal evidence, blocked status, mid-run cancellation, the in-flight guard, and outcome messages.
- Validation: `npm run compile-tests`, `node --test dist-test/test/unit/runWithAi.test.js` (16/16), `npm run compile` (webpack OK), `npm run lint` (clean), `npm test` (217/217 pass). Not verified: a manual Extension Development Host smoke test of the picker UI (environment is headless).

STATUS: DONE
