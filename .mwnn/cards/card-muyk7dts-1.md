---
id: card-muyk7dts-1
title: Add a gui to manage Ai cli available models
column: col-mqwk2njn-4
position: -56000
assignee: { kind: ai }
preferredModel.copilot: claude-sonnet-4.6
preferredModel.codex: gpt-5.5
preferredModel.claude-code: sonnet
thinkingLevel.copilot: high
thinkingLevel.codex: high
thinkingLevel.claude-code: high
createdAt: 1791404867008
updatedAt: 1791468291861
---

## Description
Add a webview editor panel for agent CLI model and thinking-level settings, so they can be managed in one place instead of stepping through the existing quick-pick (`mwnn-kanban.manageAgentCliModels`). The panel shows one section per provider (`copilot`, `codex`, `claude-code`, `cursor`). Each section lists the configured models with the default (first entry) marked, the thinking level in use plus any suggested levels, and the per-stage overrides (`agentCliStageModels`, `agentCliStageThinkingLevels`). All of these can be edited in the panel. Edits go through the existing `agentCliSettingsEditor` rules and are written only to the chosen settings scope (Workspace or User), read via `inspect()`. The panel opens from a button in the MWNN sidebar or the board toolbar. The quick-pick command keeps working. The panel touches both surfaces: the extension host owns reads and writes, the webview only renders and sends messages, and the message types in `src/types.ts` are shared by both sides.

## Acceptance criteria
- [x] A button (gear or models icon) in the MWNN sidebar view title or the board header opens the "Agent CLI Models" panel; a second click reveals the existing panel instead of opening another.
- [x] The panel has a Workspace/User scope selector (Workspace hidden when no folder is open) and shows only that scope's own values; a value inherited from the other scope is labelled as inherited and is not copied in.
- [x] Each of the four providers shows its models in order with the default marked, and offers add (bundled names suggested, free text allowed), remove, and make-default.
- [x] Each provider shows its thinking level in use and suggested levels, and offers set, add suggestion, remove, and clear (back to the CLI default); Cursor is marked "not applied by this CLI".
- [x] Stage overrides for models and thinking levels can be added, changed, and removed for each AI loop stage.
- [x] Every edit uses the `agentCliSettingsEditor` functions; an invalid edit (such as a duplicate or blank name) shows its reason in the panel and writes nothing.
- [x] After a write, or an outside change to settings.json, the panel and any open board's model and thinking pickers refresh within one configuration-change event.
- [x] New webview message types are added to `src/types.ts`, and the webview code imports no Node or `vscode` modules.
- [x] The existing `Manage Agent CLI Models and Thinking Levels` quick-pick command still works unchanged.
- [x] Unit tests cover the host-side message handler that maps panel messages to settings edits (scope selection, add, remove, make default, stage overrides, and a rejected edit); `npm run compile-tests`, `npm test`, and `npm run lint` pass.
- [x] Development Host smoke test: open the panel from the sidebar or toolbar, edit a model, a thinking level, and a stage override in each scope, and confirm settings.json and the board pickers update.

## Activity
### 2026-10-08T13:16:00.791Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.

### 2026-10-08T13:23:50.039Z - Run settings recommended by Jev
Jev (TypeSafe) judged this card's difficulty tier: **heavy**.

- copilot: model `claude-sonnet-4.6`, thinking level `high`
- codex: model `gpt-5.5`, thinking level `high`
- claude-code: model `sonnet`, thinking level `high`

### 2026-10-08T13:25:04.879Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.

### 2026-10-08 - Implementation started by Codex
The preferred `gpt-5.5` model cannot be selected from this session. Using the session's GPT-6 model family (the exact variant is not exposed). Verified this card is in Implement and has no completed acceptance evidence. Preserving pre-existing unrelated working-tree changes. The panel uses a host-owned inspect/update bridge and a shared, validated webview protocol. Stage overrides retain the existing shared-by-stage schema; they apply to every provider.

### 2026-10-08 - Implementation and automated validation by Codex
Added the singleton Agent CLI Models panel, sidebar gear and command, browser-only TypeScript bundle and themed styles, scope-isolated inspect/update controller, shared validated message types, and stage-edit rules in agentCliSettingsEditor. The quick-pick implementation is unchanged. Both panel and open-board listeners include all four settings. Added 13 controller tests covering scopes, inheritance without copying, all list operations, all stages, invalid edits, stale scopes, external refreshes, serialized edits, and write failures. Updated CHANGELOG.md after green validation.

TypeScript diagnostics, npm run compile-tests, npm run compile, 53 focused tests, npm test (683 tests), and npm run lint passed. The browser bundle contains only the webview module, with no Node or vscode imports. Development Host testing verified sidebar opening, one tab after a second gear click, all provider sections and controls, User scope showing no Workspace-owned entries, and Workspace model/thinking/stage writes in the temporary settings.json. Scope changes now clear drafts, and validation errors receive focus. Full smoke testing remains pending: Windows computer use lost its captured window and returned `failed to activate captured window` after window selection recovery.

### 2026-10-08 - Final validation and smoke-test handoff
Final source diagnostics, npm run compile-tests, npm run compile, 53 focused tests, npm test (683 passed), npm run lint, and scoped git diff --check passed after the UI fixes and message-origin check. The first ten acceptance criteria are implemented and verified through code review, unit tests, builds, and the partial Development Host run. The last criterion remains unchecked because the complete interactive test has not passed.

Remaining human smoke test:
1. Start the repo's Run Extension configuration with F5, open the MWNN sidebar, and click its gear twice; confirm one Agent CLI Models tab.
2. Open a board card's Details. In both Workspace and User scopes, edit a model, a thinking level, and a stage override. Confirm only the selected settings.json changes, the panel lists the saved values, and the already-open board model/thinking suggestions refresh. Use a provider without a Workspace override to observe User changes on the board.
3. Try a duplicate model and a blank model/level/stage value; confirm a visible reason and no settings write. Change settings.json outside the panel and confirm both views refresh. Confirm inherited User values are labelled in Workspace without being added to its inputs, and that switching scopes clears drafts.
4. Confirm the existing Manage Agent CLI Models and Thinking Levels quick-pick still opens; open a folderless window and confirm the panel offers only User scope.

Codex can package and install the working-tree VSIX for this test on request, including runtime Pro dependencies; it retains version 0.0.15 and includes uncommitted changes. This is a local test build, not a release.
Initially reported as blocked: Windows UI access failed after recovery; resolved by the successful fresh-session smoke test below.

### 2026-10-08T13:58:20Z - Development Host smoke test completed by Codex
Resetting the Windows computer-use session restored native UI access. Completed the remaining test in an isolated Development Host with temporary Workspace and User settings. Saved model, thinking-level, and stage-model edits in both scopes; inspected both settings.json files to confirm scope isolation. The already-open board pickers refreshed with the saved lists and order. An outside User settings.json edit refreshed both panel and board model/thinking suggestions. Workspace displayed User-owned Codex values as inherited without copying them into its own entries or drafts. A duplicate model showed its reason in the panel and left the settings file's SHA256 unchanged. Making a model default reordered the panel and board suggestions. The original quick-pick opened with current scoped values and stage overrides. After closing the temporary folder, the sidebar gear still opened the panel and its scope selector contained only User. All acceptance criteria are now checked; the previously recorded green automated validation remains applicable because no source changed during this retry.
STATUS: DONE
