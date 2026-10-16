---
id: card-mvaetljc-1
title: Let the user exclude agent CLIs from the Usage Orchestrator
column: col-mqxta6ho-4
position: 1000
assignee: { kind: ai, name: Claude Code }
dependsOn: [card-muwsfaoh-1]
createdAt: 1792121419848
updatedAt: 1792121419848
---

## Description
A user on the free Copilot CLI plan cannot use the models they want there, but the Usage Orchestrator still chooses Copilot whenever it is installed. Add a `mwnn-kanban.usageOrchestratorExcludedClis` setting (an array of provider ids: `copilot`, `codex`, `claude-code`, `cursor`). The orchestrator never resolves, probes, or chooses an excluded CLI, and lists it as skipped in its ranking. Choosing a CLI directly (`aiLoopProvider` or the Run Card picker) still works for an excluded CLI.

Changed: `package.json` (new setting), `src/agentCliOrchestrator.ts` (`excludedProviders` dep), `src/extension.ts` (`readUsageOrchestratorExcludedClis`, passed to all three orchestrator call sites; the initial orchestrated target skips excluded CLIs), `test/unit/agentCliOrchestrator.test.ts`.

## Acceptance criteria
- [x] `mwnn-kanban.usageOrchestratorExcludedClis` is in the manifest as a unique-item array limited to the four provider ids, default `[]`
- [x] An excluded CLI is not resolved, probed, or chosen, and appears in `ranking.skipped` with a reason that names the setting
- [x] With every remaining CLI exhausted, the orchestrator returns `none` and never falls back to an excluded CLI
- [x] Unknown ids in the setting are ignored
- [x] `npm run compile-tests`, `npm run compile`, `npm test` (784 pass), `npm run lint` are green
- [ ] Development Host smoke test: with `["copilot"]` set and Copilot installed, an orchestrated AI loop run never dispatches to Copilot, and the output channel ranking shows Copilot as skipped

## Activity
### 2026-10-15 - Implemented and unit-tested
Setting, orchestrator support, and the focused test are in place; full build, tests, and lint pass. Still waiting on the Development Host smoke test. Not committed yet.
