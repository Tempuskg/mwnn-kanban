---
id: card-mvaetljc-1
title: Let the user exclude agent CLIs from the Usage Orchestrator
column: col-mqwk2njn-4
position: -76000
assignee: { kind: human }
createdAt: 1792121419848
updatedAt: 1792245201562
dependsOn: [card-muwsfaoh-1]
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
- [x] Development Host smoke test: with `["copilot"]` set and Copilot installed, an orchestrated AI loop run never dispatches to Copilot, and the output channel ranking shows Copilot as skipped

## Activity
### 2026-10-15 - Implemented and unit-tested
Setting, orchestrator support, and the focused test are in place; full build, tests, and lint pass. Still waiting on the Development Host smoke test. Not committed yet.

### 2026-10-17T02:13:21.091Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.

### 2026-10-17T02:13:35.051Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.

### 2026-10-16 - Codex verification
Confirmed the existing manifest, excluded-provider handling, unknown-id filtering, and all three orchestrator call sites. No implementation changes were needed. Re-ran `npm run compile-tests`, `npm run compile`, `node --test dist-test/test/unit/agentCliOrchestrator.test.js` (13 pass), `npm test` (784 pass), and `npm run lint`; all passed.

The remaining Development Host smoke test requires a human: this session cannot control or inspect the native VS Code UI. Copilot and VS Code executables are available, but no live dispatch or output-channel evidence was obtained. The smoke-test acceptance criterion remains unchecked.

Manual verification:
1. In VS Code, launch the repository's `Run Extension` debug configuration (F5), then open a disposable workspace in the Extension Development Host with Copilot CLI and at least one other supported CLI installed and authenticated.
2. Set workspace settings `mwnn-kanban.usageOrchestratorExcludedClis` to `["copilot"]` and `mwnn-kanban.aiLoopProvider` to `"orchestrator"`.
3. Put a disposable AI-assigned card with a non-empty Description and testable acceptance criteria in Ready. Run `MWNN Kanban: Run Board with AI Loop`.
4. Inspect the CLI output channel ranking: Copilot must be skipped with a reason naming `mwnn-kanban.usageOrchestratorExcludedClis`; every dispatch must use another CLI. Stop the loop after observing a dispatch.
5. Record the observed ranking and dispatched provider here and check the final criterion only after it passes. Supersede the blocked marker below before appending `STATUS: DONE`.

If preferred, Codex can package and install the working-tree build for local testing using the dependency-preserving local test install procedure in `.github/instructions/vscode-extension-release.instructions.md`.
Initially reported as blocked: Human Development Host smoke test required to verify excluded Copilot is skipped in the output ranking and never dispatched; resolved in interview, 2026-10-17 (see below).

### 2026-10-17T02:17:33.359Z - AI-guided interview started in Claude Code
Opened an interview chat in Claude Code. Answers are recorded below as they are given; this entry is not evidence that any acceptance criterion is met.

### 2026-10-17T12:50:09.093Z - AI-guided interview started in Claude Code
Opened an interview chat in Claude Code. Answers are recorded below as they are given; this entry is not evidence that any acceptance criterion is met.

### 2026-10-17 - Interview: smoke test status
Q: Have you run the Development Host smoke test yet, with `["copilot"]` excluded and Copilot CLI installed?
A (user-reported in interview chat, 2026-10-17): "I don't see the usage orchestrator excluded clis setting". Smoke-test result: not reported.

Verified evidence (checked by Claude Code during the interview, not user-reported):
- The working-tree `package.json` declares `mwnn-kanban.usageOrchestratorExcludedClis` (array, `uniqueItems`, enum of the four provider ids, default `[]`, scope `resource`).
- The VS Code install `darrenjmcleod.mwnn-kanban@1.0.2` under `~/.vscode/extensions` contains the setting in both `package.json` and `dist/extension.js`. Both files are timestamped 2026-10-17 06:43 local, and the installed `dist/extension.js` matches the working-tree build in size (281876 bytes).
- Cursor has only older installs (`0.0.11`, `0.0.12`), which predate the setting.

### 2026-10-17 - Interview: where the setting was looked for
Q: Which window were you looking in: the Extension Development Host (F5), your regular VS Code window, or Cursor?
A (user-reported in interview chat, 2026-10-17): "Regular vs code window".

### 2026-10-17 - Interview: setting found and set
Q: After Developer: Reload Window, does `usageOrchestratorExcludedClis` appear in Settings?
A (user-reported in interview chat, 2026-10-17): "ok I found it and added Copart".

Verified evidence (checked by Claude Code during the interview, not user-reported):
- VS Code user `settings.json` (`%APPDATA%/Code/User/settings.json`) now contains `"mwnn-kanban.usageOrchestratorExcludedClis": ["copilot"]`. The answer's "Copart" is recorded verbatim; the saved value is `copilot`.
- `mwnn-kanban.aiLoopProvider` is not set in user settings, so it is the default `prompt`; the orchestrator must be chosen when the loop starts.
- The smoke test is running in the regular VS Code window against the locally installed working-tree build (the local test install route in `AGENTS.md` step 9), not an F5 Extension Development Host.

### 2026-10-17 - Interview: orchestrator ranking shows Copilot skipped
Q: What does the orchestrator's ranking in the MWNN Agent CLI output channel say about Copilot?
A (user-reported in interview chat, 2026-10-17): "skipped - GitHub Copilot CLI: excluded by mwnn-kanban.usageOrchestratorExcludedClis". The reported line names the setting, matching the reason text built in `src/agentCliOrchestrator.ts`.

### 2026-10-17 - Interview: CLI the loop dispatched to
Q: Which CLI did the AI loop actually send the card to?
A (user-reported in interview chat, 2026-10-17): "Claude code Usage Orchestrator ranking for the implementation stage of "have option to Save the mwnn Kanban board skills in the users area so they don't have to be checked in with the repo":", followed by these pasted MWNN Agent CLI output lines:
- `2026-10-17 07:05:15.658 [info]   1. Anthropic Claude Code CLI: 40% remaining, resets 2026-10-19T09:00:00.000Z.`
- `2026-10-17 07:05:15.658 [info]   2. OpenAI Codex CLI: 75% remaining, resets 2026-10-22T13:17:58.000Z.`
- `2026-10-17 07:05:15.658 [info]   3. Cursor Agent CLI: usage unknown (Cursor Agent CLI shows usage only in its interactive /usage view; print mode sends /usage to the model, so usage cannot be read.); drained until it stops accepting work.`

Copilot is not among the three ranked CLIs; it appears only as skipped (previous entry).

Verified evidence (checked by Claude Code during the interview, not user-reported):
- `card-mv6yxenp-1` Activity records `2026-10-17T13:05:15.658Z - Usage Orchestrator chose Anthropic Claude Code CLI` (stage: implementation, 40% remaining, resets 2026-10-19T09:00:00.000Z) and dispatch `dispatch-mvcestvq-1` started on Anthropic Claude Code CLI at 13:05:16Z. 13:05:15Z is 07:05:15 local, the same time as the pasted output lines.
- A search of every card under `.mwnn/cards/` for 2026-10-17 orchestrator dispatches finds only this one; no card records a dispatch to Copilot.

### 2026-10-17 - Interview: smoke test sign-off
Q: This run was in the regular VS Code window with the locally installed working-tree build, not an F5 Development Host. Do you accept it as the smoke test, so the last criterion can be checked and the card marked done?
A (user-reported in interview chat, 2026-10-17): "Yes".

### 2026-10-17 - Interview complete
Criteria met:
- Criteria 1-5 (manifest setting, excluded CLI skipped with a reason naming the setting, `none` with no fallback to an excluded CLI, unknown ids ignored, compile/test/lint green) were already checked before this interview, on the earlier implementation and Codex verification evidence; the interview did not re-run them. Verified during the interview: the working-tree `package.json` setting shape matches criterion 1, and the implementation is committed as `f9e8089` (the 2026-10-15 "Not committed yet" note is now out of date).
- Criterion 6 (smoke test) checked on the user's sign-off. Ranking with Copilot skipped and the reason naming `mwnn-kanban.usageOrchestratorExcludedClis`: user-reported. Dispatch to Anthropic Claude Code CLI: user-reported, and verified in `card-mv6yxenp-1` Activity (`dispatch-mvcestvq-1`, 2026-10-17T13:05:16Z). No Copilot dispatch: verified, since no card records one on 2026-10-17. `["copilot"]` in user settings: verified.

Open criteria: none.
Unresolved exceptions: none. The test ran in the regular VS Code window against the locally installed working-tree build rather than an F5 Development Host; the user accepted this as the smoke test. It covered one orchestrated dispatch.

Dependency `card-muwsfaoh-1` is in Done. The card stays in Verify; moving it is left to the board's column rules and the user.
STATUS: DONE
