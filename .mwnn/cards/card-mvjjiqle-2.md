---
id: card-mvjjiqle-2
title: When running a card with AI or defining a card with AI and you select a CLI and it gets an error it can't find the model specified have a gui show up and let the user select the model that will work and the thinking level that will work and let them specify workspace or user level
column: col-mqxta6ho-4
position: 1000
assignee: { kind: human }
preferredModel.copilot: claude-sonnet-5.5
preferredModel.codex: gpt-6.1-sol
preferredModel.claude-code: sonnet
preferredModel.cursor: auto
thinkingLevel.copilot: high
thinkingLevel.codex: high
thinkingLevel.claude-code: high
createdAt: 1792673506850
updatedAt: 1792674608781
---

## Description
When Define with AI or Run with AI launches a selected agent CLI and that CLI fails because the requested model is unknown or unavailable (for example a stale `preferredModel.<provider>` value, an AI-loop stage default the CLI no longer accepts, or a renamed model id), stop treating the failure as a dead end.

Own the recovery in the free extension (`e:\mwnn-kanban`), not this Pro package: surface a GUI (reuse or extend the existing Agent CLI Models / Manage Agent CLI Models patterns) that lets the user pick a model and thinking level the chosen CLI can actually use, choose whether to save that choice at workspace or user (global) settings scope, apply the choice for the selected CLI/provider, and continue or re-dispatch the same define/run so the user does not have to dig through settings by hand.

Do not invent a new license gate or transmit any board/run data. If the CLI reports a different class of error (auth, network, usage limit, generic exit), do not open this recovery GUI.

## Acceptance criteria
- [x] When Define with AI or Run with AI fails because the selected CLI cannot find / does not accept the model that was passed for that provider, a recovery GUI opens (not only a transient status/error toast) before the dispatch is abandoned.
- [x] The recovery GUI is scoped to the CLI/provider that failed and shows selectable model options (and thinking-level options when that CLI supports them) drawn from the same source the existing Agent CLI Models management UI uses for that CLI.
- [x] The GUI lets the user choose save scope: workspace or user (global). Workspace is offered only when a workspace folder is available; otherwise user scope is the only choice.
- [x] Confirming the selection writes the model (and thinking level when applicable) for that CLI/provider into the correct VS Code configuration target for the chosen scope and does not overwrite the other scope's values for unrelated keys.
- [x] After a successful confirm, the same define/run is continued or re-dispatched with the newly selected model/thinking level so the user does not need a separate manual restart for that attempt.
- [x] Cancel / dismiss leaves existing settings and card frontmatter unchanged and does not leave a half-applied override.
- [x] Failures that are not model-unavailable (usage limit, auth, network, generic non-zero exit without a model-not-found signal) do not open this recovery GUI.
- [x] Focused unit or integration coverage in the free repo proves: (1) model-not-found is classified as recoverable, (2) scope write targets workspace vs global correctly, (3) non-model errors do not trigger the GUI path.

## Activity
### 2026-10-22T12:56:50.606Z - Cursor Agent CLI definition handoff started
Started Cursor Agent CLI in the active workspace and waiting for card-file completion evidence.
AI loop stage model rule for the definition stage: auto.
AI loop stage thinking level rule for the definition stage "xHigh" was not applied: Cursor Agent CLI does not accept a thinking level, so the AI loop stage thinking level rule for the definition stage "xHigh" was not applied and the run used that CLI's default thinking level.

### 2026-10-22T12:57:17.968Z - Run settings recommended by Jev
Jev (TypeSafe) judged this card's difficulty tier: **heavy**.

- copilot: model `claude-sonnet-5.5`, thinking level `high`
- codex: model `gpt-6.1-sol`, thinking level `high`
- claude-code: model `sonnet`, thinking level `high`
- cursor: model `auto`

### 2026-10-22T13:01:51.931Z - Auto-started in Implement
Assigned to AI in Ready; moved to Implement automatically.

### 2026-10-22T13:04:58.499Z - Cursor Agent CLI implementation handoff started
Started Cursor Agent CLI in the active workspace and waiting for card-file completion evidence.
Card preferred model: auto.

### 2026-10-22T13:20:00.000Z - Model-not-found recovery for Define/Run with AI
Added `agentCliModelRecovery` (classification, scope write targets, scoped settings patches, suggestion lists) and a QuickPick recovery UI that reuses Manage Agent CLI Models sources. `runCardWithAgentCli` opens recovery only on `failure === 'model-rejected'`, writes workspace or user settings on confirm, updates card preferred model when the refusal was card-sourced, and re-dispatches with escalated model/thinking overrides. Cancel writes nothing. Unit coverage: recoverable vs non-model failures, workspace vs global write targets, and re-dispatch / no-GUI paths.
STATUS: DONE

### 2026-10-22T13:10:08.415Z - Run with AI parked in Verify
Implementation finished; reassigned to Human for verification and sign-off.
