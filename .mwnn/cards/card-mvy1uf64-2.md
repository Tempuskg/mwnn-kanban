---
id: card-mvy1uf64-2
title: Add a toggle to hide blocked cards
column: col-mqwk2njn-4
position: -107000
assignee: { kind: ai }
preferredModel.copilot: claude-sonnet-5.5
preferredModel.codex: gpt-6-luna
preferredModel.claude-code: sonnet
preferredModel.cursor-other: claude-opus-5-5-medium
thinkingLevel.copilot: medium
thinkingLevel.codex: medium
thinkingLevel.claude-code: medium
createdAt: 1793550811468
updatedAt: 1794156488206
---

## Description
Add a board-level toggle that hides cards currently shown as blocked, so operators can focus on actionable work without scrolling past dependency-, schedule-, or STATUS-blocked cards. The filter is view-only: it must not move, delete, or rewrite cards, and it must not change WIP / reverse-WIP / move rules. Default remains "show blocked cards". Persist the preference per workspace the same way board zoom is persisted, so reopening the panel restores the last choice.

A card counts as blocked for this toggle when the board would render its Blocked chip today: unfinished `dependsOn`, a still-future `scheduledFor`, or a latest Activity `STATUS: BLOCKED`.

## Acceptance criteria
- [x] A clearly labelled control (e.g. "Hide blocked") appears in the board chrome near the existing zoom controls and is usable with keyboard and screen-reader labels.
- [x] With the toggle off (default), every card renders in its column exactly as it does today, including blocked cards.
- [x] With the toggle on, cards that would show a Blocked chip (unfinished dependencies, future schedule, or latest `STATUS: BLOCKED`) are not rendered on the board; unblocked cards in every column remain visible and ordered as before.
- [x] Turning the toggle on or off updates the board immediately without a reload and without posting card create/update/delete/move messages.
- [x] The preference survives closing and reopening the board panel in the same workspace (persist via workspace memento, mirroring board zoom).
- [x] Column WIP / reverse-WIP badges and move / Ready admission rules still use the full board state, not the filtered view.
- [x] When a column's visible list becomes empty solely because blocked cards are hidden, the column still shows a sensible empty/placeholder state rather than a broken layout.
- [x] Development Host smoke: with at least one blocked and one unblocked card in Ready (or another column), toggle Hide blocked on and off and confirm only blocked cards disappear/reappear and the preference sticks after closing and reopening the board.

## Activity
### 2026-11-08T16:09:24.593Z - Usage Orchestrator chose Cursor Agent CLI
Stage: definition. Cursor Agent CLI reports 71% remaining, resetting 2026-11-06T23:33:31.000Z - the soonest reset among the CLIs with usage left, so it is spent before it is lost.

### 2026-11-08T16:09:25.271Z - Usage Orchestrator dispatch dispatch-mw812dxz-1 started
Card: card-mvy1uf64-2 ("Add a toggle to hide blocked cards"). CLI: Cursor Agent CLI. Stage: definition.
Requested model: "auto" (source: the AI loop stage model rule; passed to the CLI exactly as shown).
Actual model: awaiting authoritative CLI/session metadata.
Started Cursor Agent CLI in the active workspace and waiting for card-file completion evidence.
AI loop stage model rule for the definition stage: auto.
AI loop stage thinking level rule for the definition stage "max" was not applied: Cursor Agent CLI does not accept a thinking level, so the AI loop stage thinking level rule for the definition stage "max" was not applied and the run used that CLI's default thinking level.

### 2026-11-08T16:09:29.140Z - Usage Orchestrator dispatch dispatch-mw812dxz-1 model observed
Card: card-mvy1uf64-2. CLI: Cursor Agent CLI. Stage: definition.
Actual model: "Auto" (source: Cursor Agent stream-json system.init.model; attempt: dispatch-mw812dxz-1).

### 2026-11-08T16:10:20.470Z - Run settings recommended by Jev
Jev (TypeSafe) judged this card's difficulty tier: **standard**.

- copilot: model `claude-sonnet-5.5`, thinking level `medium`
- codex: model `gpt-6-luna`, thinking level `medium`
- claude-code: model `sonnet`, thinking level `medium`
- cursor-other: model `claude-opus-5-5-medium`

### 2026-11-08T16:10:54.381Z - Usage Orchestrator chose Cursor Agent CLI
Stage: implementation. Cursor Agent CLI reports 71% remaining, resetting 2026-11-06T23:33:31.000Z - the soonest reset among the CLIs with usage left, so it is spent before it is lost.

### 2026-11-08T16:10:55.069Z - Usage Orchestrator dispatch dispatch-mw814b8d-2 started
Card: card-mvy1uf64-2 ("Add a toggle to hide blocked cards"). CLI: Cursor Agent CLI. Stage: implementation.
Requested model: "auto" (source: the AI loop stage model rule; passed to the CLI exactly as shown).
Actual model: awaiting authoritative CLI/session metadata.
Started Cursor Agent CLI in the active workspace and waiting for card-file completion evidence.
AI loop stage model rule for the implementation stage: auto.

### 2026-11-08T16:10:58.133Z - Usage Orchestrator dispatch dispatch-mw814b8d-2 model observed
Card: card-mvy1uf64-2. CLI: Cursor Agent CLI. Stage: implementation.
Actual model: "Auto" (source: Cursor Agent stream-json system.init.model; attempt: dispatch-mw814b8d-2).

### 2026-11-08 - Implemented Hide blocked board toggle
Added a labelled "Hide blocked" checkbox beside the zoom controls. Filtering is view-only (`showsBlockedChip` = unfinished deps, future schedule, or latest `STATUS: BLOCKED`); WIP/reverse-WIP and move rules still use the full column list; drop indices map back to the full list; empty filtered columns show a placeholder. Preference persists via workspace memento key `mwnn-kanban.hideBlocked` (same pattern as zoom) through `setHideBlocked` / state `hideBlocked`. Compile, focused protocol/model-suggestion tests, lint, and Snyk on touched TS passed. Development Host smoke still needed.
Initially reported as blocked: Development Host smoke required — toggle Hide blocked with mixed blocked/unblocked cards and confirm preference after close/reopen; resolved by the successful smoke test below.

### 2026-11-08T16:16:57.358Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.

### 2026-11-08 - Codex verification follow-up
Requested gpt-6-luna is unavailable for switching this active session; used GPT-6 (Codex session; exact deployment variant is not exposed). Reused the existing implementation and verified the webview filter, shared protocol, host workspace-memento persistence, full-state metrics, and filtered empty state. Rebuilt tests and extension successfully; 21 focused protocol/model-suggestion tests and lint passed. Full suite: 1,108 passed, two failed because sandbox permissions denied git init in disposable temporary repositories (outcomeEvidence tests). Launched Run Extension with F5; Development Host is waiting at the untrusted-files security prompt, which requires human interaction. Smoke checkbox remains unchecked pending that interaction.

Remaining smoke steps: handle the Development Host untrusted-files prompt, open E:\mwnn-kanban and run MWNN Kanban: Open Board. In a column containing blocked and unblocked cards, toggle Hide blocked on/off; confirm only blocked cards disappear/reappear, order and WIP badges stay stable, then enable it, close the panel, and reopen it to confirm the preference remains enabled. If preferred, the working-tree build can be packaged and installed locally (same version, includes uncommitted changes; not a release).
Initially reported as blocked: Human must handle the Development Host untrusted-files security prompt before the remaining smoke test can run; resolved by the successful smoke test below.

### 2026-11-08 - Development Host smoke passed
Human cleared the untrusted-files prompt. Ran the rebuilt working tree in Extension Development Host using an isolated fixture workspace. Default off showed the actionable card plus dependency-, future-schedule-, and Activity STATUS-blocked cards in Ready, with an actionable card in Done. Enabling Hide blocked immediately removed all three blocked cards while preserving actionable cards and their order; disabling restored all three. Ready still displayed 4 cards and Defined 2/3 throughout. Enabled the filter, closed the board with Ctrl+F4, reopened via MWNN Kanban: Open Board, and confirmed the enabled preference and filtered view were restored. All five fixture card files were byte-for-byte unchanged after toggling and reopening. Removed the disposable fixture workspace afterward. No source changes were needed in this follow-up; prior build, focused tests and lint remain green. Full-suite sandbox failures remain documented above and are unrelated to this filter.
Model clarification: the session UI identifies GPT-6.1 Sol Medium; gpt-6-luna could not be selected for the active session.
STATUS: DONE
