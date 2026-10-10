---
id: card-mv2ik8oc-5
title: Route the board model picker settings link to the Agent CLI Models panel
column: col-mqwk2njn-1
position: 6000
assignee: { kind: ai }
createdAt: 1791643972377
updatedAt: 1791643972377
---

## Description
In the board card model picker, "Configure model lists in settings…" posts `openModelSettings`. `src/boardPanel.ts` handles that message by opening raw settings (`workbench.action.openSettings`, `AGENT_CLI_MODELS_SETTING`), while the sidebar gear opens the dedicated Agent CLI Models panel (`mwnn-kanban.openAgentCliModels`). This sends the same intent to two different destinations, which the audit flagged in wiki/command-ui-surfaces.md (from card-mv2h1yip-1). Point the board link at `mwnn-kanban.openAgentCliModels` so both entry points open the panel, and update the link label to match.

## Acceptance criteria
- [ ] The board model-picker link opens the Agent CLI Models panel instead of the Settings editor
- [ ] The link label names the panel (for example, "Configure models in Agent CLI Models…")
- [ ] The panel opens even when the sidebar view has never been shown
- [ ] Development Host smoke test: with an empty model list, use the picker link and see the panel open

## Activity
- 2026-10-10 Claude Code: created from the command UI audit (card-mv2h1yip-1)
