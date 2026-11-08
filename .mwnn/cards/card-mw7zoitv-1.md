---
id: card-mw7zoitv-1
title: Occasionally I'm still seeing multiple mwnn kanban tabs being created
column: col-mqwk2njn-4
position: -109000
assignee: { kind: ai }
preferredModel.copilot: claude-sonnet-5.5
preferredModel.codex: gpt-6.1-sol
preferredModel.claude-code: sonnet
preferredModel.cursor-other: claude-opus-5-5-medium
thinkingLevel.copilot: high
thinkingLevel.codex: high
thinkingLevel.claude-code: high
createdAt: 1794151838803
updatedAt: 1794157927545
---

## Description
Despite the existing single-panel lifecycle, a second "MWNN Kanban" editor tab still appears occasionally in the same VS Code window. Find and close the remaining race or edge path that creates an extra board webview (for example open vs session restore, rapid re-open after close, or a stale singleton clear), so every board entry point keeps exactly one live board panel and reveals it when one already exists.

## Acceptance criteria
- [x] Reproducing the intermittent duplicate (reload/restart with a restored board, Open Board / sidebar / other open entry points while a board is already open or restoring, and close-then-immediately-reopen) leaves at most one "MWNN Kanban" editor tab in that window.
- [x] When a board panel already exists (visible, hidden, or in another editor group), every open path reveals that same panel and does not create a second webview.
- [x] If VS Code hands the extension a restored board panel while another board panel is already live, the live panel stays and the duplicate is disposed (or otherwise removed) so only one tab remains.
- [x] After the sole board panel is closed, the next open creates exactly one new functional board panel; a later open still reuses that panel.
- [x] Automated tests cover the residual failure mode(s) found (for example restore-vs-show ordering, stale close clearing a replacement, or concurrent open), and existing lifecycle reuse/close/restore tests still pass.
- [x] A Development Host smoke check of the previously failing sequence confirms only one MWNN Kanban tab remains afterward.

## Activity
### 2026-11-08T16:55:08.656Z - Usage Orchestrator chose Cursor Agent CLI
Stage: definition. Cursor Agent CLI reports 71% remaining, resetting 2026-11-06T23:33:31.000Z - the soonest reset among the CLIs with usage left, so it is spent before it is lost.

### 2026-11-08T16:55:09.386Z - Usage Orchestrator dispatch dispatch-mw82p7be-4 started
Card: card-mw7zoitv-1 ("Occasionally I'm still seeing multiple mwnn kanban tabs being created"). CLI: Cursor Agent CLI. Stage: definition.
Requested model: "auto" (source: the AI loop stage model rule; passed to the CLI exactly as shown).
Actual model: awaiting authoritative CLI/session metadata.
Started Cursor Agent CLI in the active workspace and waiting for card-file completion evidence.
AI loop stage model rule for the definition stage: auto.
AI loop stage thinking level rule for the definition stage "max" was not applied: Cursor Agent CLI does not accept a thinking level, so the AI loop stage thinking level rule for the definition stage "max" was not applied and the run used that CLI's default thinking level.

### 2026-11-08T16:55:12.366Z - Usage Orchestrator dispatch dispatch-mw82p7be-4 model observed
Card: card-mw7zoitv-1. CLI: Cursor Agent CLI. Stage: definition.
Actual model: "Auto" (source: Cursor Agent stream-json system.init.model; attempt: dispatch-mw82p7be-4).

### 2026-11-08T16:55:54.061Z - Run settings recommended by Jev
Jev (TypeSafe) judged this card's difficulty tier: **heavy**.

- copilot: model `claude-sonnet-5.5`, thinking level `high`
- codex: model `gpt-6.1-sol`, thinking level `high`
- claude-code: model `sonnet`, thinking level `high`
- cursor-other: model `claude-opus-5-5-medium`

### 2026-11-08T16:57:42.631Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.
### 2026-11-08 - Codex implementation and automated verification
- Applied the accessible workspace AGENTS.md and .github/copilot-instructions.md. Current card column remains Implement (col-mqwk2njn-3); no prior completion evidence existed.
- Requested model gpt-6.1-sol cannot be selected or independently verified through this session. Used the active Codex agent (GPT-6-based; exact backend model metadata is unavailable).
- Identified a lifecycle gap: inactive session-restored tabs can exist before VS Code invokes the serializer, so an empty singleton does not prove there are no board tabs. BoardPanel.show now snapshots only matching unowned webview tabs before creation and closes that snapshot after retaining the new live panel. Live-panel opens still reveal the singleton. Cleanup cannot include the newly created tab or unrelated editors.
- Added src/boardPanelTabs.ts, test/unit/boardPanelTabs.test.ts, and test/unit/boardPanelIntegration.test.ts; updated src/boardPanel.ts and CHANGELOG.md. Preserved all pre-existing unrelated working-tree changes.
- Verified: git diff --check; npm run compile-tests; npm run compile; node --test dist-test/test/unit/boardPanelIntegration.test.js dist-test/test/unit/boardPanelLifecycle.test.js dist-test/test/unit/boardPanelPlacement.test.js dist-test/test/unit/boardPanelTabs.test.js (12 passing); npm test (1117 passing); npm run lint. The first npm test attempt encountered sandbox Git initialization permissions; an unsandboxed rerun passed.
- Automated evidence covers lazy restored tabs across groups, prefixed webview types, delayed tab cleanup, hidden live-panel reuse without changing groups, restored duplicate disposal, close/reopen/reuse, and existing lifecycle regressions. Actual reload/restart reproduction and Development Host confirmation remain unchecked.
- Launched a Development Host with the working-tree build and a temporary workspace. Its welcome/sign-in modal blocks the smoke check. Asked the user to dismiss it; the computer-use skill safety guidance prohibits automating authentication dialogs.
### 2026-11-08 - Development Host verification completed
- The user dismissed the initial welcome/sign-in dialog; the smoke-check obstacle was resolved without automating authentication or changing workspace trust.
- Verified the working-tree build in an actual Extension Development Host and temporary workspace: sidebar open; command-palette Open Board with an existing board; hidden-panel focus from a second editor group; reload with an inactive board and sidebar visible; close the sole board and immediately reopen via the sidebar; subsequent Open Board; and reload with both the board inactive and sidebar hidden, then command-palette Open Board before selecting the restored tab. Every completed sequence left exactly one MWNN Kanban editor tab.
- Cross-group Focus Board retained the original group and webview identity. After the final reload/open sequence, repeated Open Board retained webview id 370d8bfe-3f52-4c25-ba26-2f07c34c5baa. Verified board responsiveness by zooming from 100% to 110% and resetting to 100%.
- All acceptance criteria are checked. All 1117 automated tests, compilation, and lint passed. Card column and position are unchanged.
STATUS: DONE
