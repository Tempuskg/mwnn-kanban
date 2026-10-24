---
id: card-mvmhnrvl-1
title: Where ever you can select Cursor Agent CLI add Cursor Agent CLI Other
column: col-mqwk2njn-4
position: -90000
assignee: { kind: ai }
createdAt: 1792851781089
updatedAt: 1792880580997
---

## Description
Promote `cursor-other` from a stage-only settings key (today labeled “Cursor Other Models”) to a first-class agent CLI provider id, and rename it to **Cursor Agent CLI Other** on every surface that currently names Cursor Agent CLI or Cursor Other Models.

Selecting Cursor Agent CLI Other still launches the same Cursor Agent CLI executable as `cursor` (resolve path via the existing `cursor` / `mwnn-kanban.agentCliPaths["cursor"]` machinery; do not require a separate executable). It is a distinct selectable identity for model catalogs, card preferred model / thinking level (`preferredModel.cursor-other`, `thinkingLevel.cursor-other`), stage overrides, Run Card with AI / AI loop provider pickers, `mwnn-kanban.aiLoopProvider`, `mwnn-kanban.usageOrchestratorExcludedClis`, the Agent CLI Models panel (including a top-level provider section, not only a stage row), model recovery, usage ranking / Activity copy, and any other UI or setting enum that lists agent CLI providers. Usage for that choice continues to map to Cursor’s Other Models pool; `cursor` remains the Auto / Cursor-models pool identity.

Remove the “stage-only; dispatches still run as cursor” framing from settings descriptions, README, and in-product copy wherever this concept appears; use **Cursor Agent CLI Other** consistently instead of **Cursor Other Models**.

## Acceptance criteria
- [x] `cursor-other` is a first-class `AgentCliProviderId` (included wherever provider ids are enumerated for selection, settings, card frontmatter, and catalogs), not merely an `AgentCliStageProviderId` bolt-on; selecting it still spawns Cursor Agent CLI via the same executable resolution as `cursor`.
- [x] Every user-visible label that previously said “Cursor Other Models” (or equivalent) now says **Cursor Agent CLI Other**, including the Agent CLI Models panel, stage rows, settings `enumDescriptions` / markdown descriptions, Run Card with AI and AI loop CLI pickers, board preferred-model / thinking-level provider lists, model recovery, usage/Activity ranking copy, README, and CHANGELOG (Unreleased).
- [x] Every UI or setting that lets the user choose among agent CLIs for a run, preference, exclusion, or per-provider config lists **Cursor Agent CLI Other** alongside **Cursor Agent CLI**, including: Run Card with AI / AI loop CLI quick-pick, `mwnn-kanban.aiLoopProvider`, `mwnn-kanban.usageOrchestratorExcludedClis`, card preferred-model and thinking-level provider dropdowns, Agent CLI Models panel top-level provider sections (not stage-only), model recovery, and any other provider list that currently shows Cursor Agent CLI.
- [x] Cards can store and edit `preferredModel.cursor-other` and `thinkingLevel.cursor-other` independently of `preferredModel.cursor` / `thinkingLevel.cursor`; a dispatch chosen as Cursor Agent CLI Other uses the `cursor-other` card / stage / workspace defaults for that provider id.
- [x] `mwnn-kanban.agentCliModels`, `mwnn-kanban.agentCliThinkingLevels`, `mwnn-kanban.agentCliStageModels`, and `mwnn-kanban.agentCliStageThinkingLevels` accept and edit a `cursor-other` entry as a peer of `cursor` (and the other CLIs); path overrides remain shared with `cursor` (no separate required path key unless already present).
- [x] Usage orchestration and pool classification treat a Cursor Agent CLI Other selection as the Other Models pool, while Cursor Agent CLI remains the Auto / Cursor-models pool; excluding either id in `usageOrchestratorExcludedClis` only excludes that identity.
- [ ] Unit tests cover provider enumeration, label, dispatch mapping to the Cursor executable, independent model/thinking resolution for `cursor-other`, and settings/panel surfaces; `npm run compile-tests`, `npm run compile`, focused relevant tests, and `npm test` pass. A Development Host smoke test confirms Cursor Agent CLI Other appears and is selectable wherever Cursor Agent CLI is.

## Activity
### 2026-10-24T14:23:27.043Z - Definition requested from GitHub Copilot
Asked GitHub Copilot to fill in the Description and Acceptance criteria for this card.

### 2026-10-24T14:32:31.139Z - Run settings recommended by Jev
Jev (TypeSafe) judged this card's difficulty tier: **heavy**.
No provider had a choice to make, so no run settings were changed.

### 2026-10-24T14:53:25.828Z - Handed off to GitHub Copilot
Dispatched this card to GitHub Copilot. The agent should append its completion note below.

### 2026-10-24T15:20:00.000Z - Cursor Agent CLI Other promoted
Promoted `cursor-other` to a first-class `AgentCliProviderId` labeled **Cursor Agent CLI Other**. It shares the Cursor Agent CLI executable / `agentCliPaths["cursor"]` with `cursor`, keeps independent preferred model / thinking / stage / workspace defaults, appears on pickers and settings enums, and ranks against the Other Models usage pool. Updated README, CHANGELOG (Unreleased), AGENTS.md, package.json, panel, orchestrator, and unit tests. `npm run compile-tests`, `npm run compile`, and `npm test` (936 pass) succeeded. Initially reported as blocked: Development Host smoke still required; resolved or restated below.

### 2026-10-24T20:24:14.542Z - Usage Orchestrator chose Cursor Agent CLI
Stage: implementation. Cursor Agent CLI reports 87.1% remaining, resetting 2026-11-06T23:33:31.000Z - the soonest reset among the CLIs with usage left, so it is spent before it is lost. Pace variance -44.4 pts (57.3% elapsed).

### 2026-10-24T20:24:14.982Z - Usage Orchestrator dispatch dispatch-mvmukbk6-d started
Card: card-mvmhnrvl-1 ("Where ever you can select Cursor Agent CLI add Cursor Agent CLI Other"). CLI: Cursor Agent CLI. Stage: implementation.
Requested model: none (source: CLI default; no model argument was supplied).
Actual model: awaiting authoritative CLI/session metadata.
Started Cursor Agent CLI in the active workspace and waiting for card-file completion evidence.

### 2026-10-24T20:24:17.266Z - Usage Orchestrator dispatch dispatch-mvmukbk6-d model observed
Card: card-mvmhnrvl-1. CLI: Cursor Agent CLI. Stage: implementation.
Actual model: "Auto" (source: Cursor Agent stream-json system.init.model; attempt: dispatch-mvmukbk6-d).

### 2026-10-24T20:26:11.552Z - Verified unit gates; smoke still open
Re-verified the existing Cursor Agent CLI Other promotion. Strengthened Agent CLI Models panel unit coverage so the top-level `cursor-other` provider id/label/`thinkingApplied` are asserted (fixture now includes that suggestion row). `npm run compile-tests`, `npm run compile`, focused cursor-other/panel/model/thinking/pool tests (108), and `npm test` (983 pass) succeeded. Implementation ACs remain met; only Development Host smoke is still unmet.

Smoke steps (F5 Development Host):
1. Command Palette → Agent CLI Models: confirm a top-level **Cursor Agent CLI Other** section beside **Cursor Agent CLI**, and stage rows for both.
2. Run Card with AI / AI loop CLI quick-pick: both Cursor identities selectable.
3. Card preferred-model and thinking-level provider lists: both identities present; setting `cursor-other` does not overwrite `cursor`.
4. Model recovery UI (if triggered): offers **Cursor Agent CLI Other**.
5. Settings: `mwnn-kanban.aiLoopProvider` and `usageOrchestratorExcludedClis` enum/descriptions name **Cursor Agent CLI Other**.

Say if you want a local working-tree VSIX packaged and installed (`npm run package:vsix` / `code --install-extension … --force`) for that smoke.

STATUS: BLOCKED: Development Host smoke test still needed — confirm Cursor Agent CLI Other appears and is selectable wherever Cursor Agent CLI is (steps above). Unit compile/test gates are green.
