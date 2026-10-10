---
id: card-mv2ik8oc-5
title: Route the board model picker settings link to the Agent CLI Models panel
column: col-mqwk2njn-4
position: -73000
assignee: { kind: human }
createdAt: 1791643972377
updatedAt: 1791655534274
---

## Description
In the board card model picker, "Configure model lists in settings…" posts `openModelSettings`. `src/boardPanel.ts` handles that message by opening raw settings (`workbench.action.openSettings`, `AGENT_CLI_MODELS_SETTING`), while the sidebar gear opens the dedicated Agent CLI Models panel (`mwnn-kanban.openAgentCliModels`). This sends the same intent to two different destinations, which the audit flagged in wiki/command-ui-surfaces.md (from card-mv2h1yip-1). Point the board link at `mwnn-kanban.openAgentCliModels` so both entry points open the panel, and update the link label to match.

## Acceptance criteria
- [x] The board model-picker link opens the Agent CLI Models panel instead of the Settings editor
- [x] The link label names the panel (for example, "Configure models in Agent CLI Models…")
- [x] The panel opens even when the sidebar view has never been shown
- [x] Development Host smoke test: with an empty model list, use the picker link and see the panel open

## Activity
- 2026-10-10 Claude Code: created from the command UI audit (card-mv2h1yip-1)

### 2026-10-10T17:57:44.873Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-10-10 - Claude Code
- `src/boardPanel.ts`: the `openModelSettings` handler now runs `mwnn-kanban.openAgentCliModels` instead of `workbench.action.openSettings`; dropped the unused `AGENT_CLI_MODELS_SETTING` import.
- `media/board.js`: the picker link now reads "Configure models in Agent CLI Models…".
- The command is registered in `activate` (`registerAgentCliSettingsPanel`, before the no-workspace exit) and creates its own webview panel, so it does not depend on the sidebar view ever being shown.
- Validation: `npm run compile-tests`, `npm run compile`, `npm test` (783 pass, 0 fail), `npm run lint` are all green.
- Still needed: the Development Host smoke test. F5, open the board, open a card's model picker for a CLI with an empty model list, click "Configure models in Agent CLI Models…", and confirm the Agent CLI Models panel opens.
Initially reported as blocked: Development Host smoke test needed a human; resolved in interview below.

### 2026-10-10T18:01:37.329Z - AI-guided interview started in Claude Code
Opened an interview chat in Claude Code. Answers are recorded below as they are given; this entry is not evidence that any acceptance criterion is met.

### 2026-10-10 - Interview answer
- Question: In the Extension Development Host, after opening a card's model picker for a CLI with no configured models and clicking "Configure models in Agent CLI Models…", did the Agent CLI Models panel open?
- Answer: "yes"
- Source: user-reported by the person in the interview chat, 2026-10-10.

### 2026-10-10 - Interview summary
- Criteria 1–3 (link opens the panel, label names the panel, panel opens without the sidebar view): met earlier. Evidence: the code in `src/boardPanel.ts` and `media/board.js` was checked again in this interview, and green compile/test/lint was reported in the Claude Code note above.
- Criterion 4 (Development Host smoke test): met. The person reported it in the interview chat; the agent did not observe it.
- Open criteria: none. Unresolved exceptions: none.
- The card's column and assignee are unchanged. Moving it to Verify or Done is left to the person under the board's column rules.
STATUS: DONE
