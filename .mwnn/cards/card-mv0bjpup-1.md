---
id: card-mv0bjpup-1
title: Modify the AI Loop model preference so that for each task you can set the preferred model for each cli
column: col-mqwk2njn-4
position: -59000
assignee: { kind: human }
preferredModel.copilot: claude-sonnet-5.5
preferredModel.codex: gpt-6.1-sol
preferredModel.claude-code: sonnet
preferredModel.cursor: auto
thinkingLevel.copilot: xhigh
thinkingLevel.codex: max
thinkingLevel.claude-code: max
createdAt: 1791511258273
updatedAt: 1791571885067
---

## Description
Allow a separate preferred model and thinking level for each CLI (GitHub Copilot, OpenAI Codex, Anthropic Claude Code, and Cursor Agent) at each AI Loop stage: definition, triage, implementation, and verification. Today, stage overrides share one model and thinking level across all CLIs, so switching CLI can apply names intended for another provider.

Extend `mwnn-kanban.agentCliStageModels` and `mwnn-kanban.agentCliStageThinkingLevels` to store a provider map for each stage, such as `implementation: { codex: "gpt-example", "claude-code": "sonnet" }`. Update the existing Agent CLI Models panel and Manage Agent CLI Models and Thinking Levels quick-pick to edit these preferences in User or Workspace scope. Model and thinking level remain independent, optional, free-form values.

Resolve stage preferences for the CLI actually selected for a dispatch, including orchestrator selection and CLI fallback. Preserve the existing precedence of card override, stage override, provider default, then CLI default, and the existing opt-in escalation behavior. Keep legacy shared stage strings readable and preserve unedited preferences when converting them to per-CLI entries.

## Acceptance criteria
- [x] Both stage settings accept independent entries for all 16 stage/CLI combinations, using stage-to-provider maps under the existing configuration keys; setting only a model or only a thinking level does not require the other value.
- [x] The Agent CLI Models panel lets the user select or clearly identify the stage and CLI, view its saved model and thinking level, and set or remove either override independently. Suggestions contain only that CLI's configured values, and an off-list value can still be entered and saved.
- [x] The existing Manage Agent CLI Models and Thinking Levels quick-pick can set and remove model and thinking-level overrides for a selected stage and CLI, with the same results as the panel.
- [x] User and Workspace edits write only to the selected scope. Inherited values are visibly identified without being copied into that scope; changing one stage/CLI entry preserves all other entries. Clearing an override removes its key and restores normal scope/default inheritance.
- [x] For every AI Loop stage, initial dispatch resolves model and thinking level independently in this order: that CLI's card override, that stage's override for that CLI, that CLI's configured default, then the CLI's own default. When no layer supplies a value, dispatch adds no corresponding CLI argument; resolving defaults never writes them into a card.
- [x] Orchestrator selection and credit fallback resolve both preferences after the actual CLI is chosen; a replacement CLI receives its own preferences for the interrupted stage rather than values from the previous CLI. Run Card with AI continues to use the implementation-stage preferences for its selected CLI, and existing opt-in escalation behavior is preserved.
- [x] Existing stage-only string settings remain readable with their current shared behavior. Editing a legacy stage converts it to per-CLI entries while preserving the effective values for unedited CLIs; removing one converted override leaves the other CLIs' preferences intact.
- [x] Unknown stage/provider keys, malformed entries, and blank or whitespace-only values are ignored safely when reading settings. The editors reject invalid input with a visible reason and no settings write; valid model and thinking-level names remain free-form without validation against a fixed catalog.
- [x] A CLI that cannot apply a configured thinking level still runs using its default effort, and its Activity entry states that the requested level was not applied. Dispatch reporting identifies the selected CLI, stage, resolved values, and their sources without failing solely because thinking-level selection is unsupported.
- [x] Saving through either editor or editing settings.json externally refreshes the open panel and relevant board suggestions without a window reload. Shared host/webview message types carry the stage and CLI for each edit, with no Node or vscode imports in webview code.
- [x] Configuration schemas, settings help text, and relevant model-selection documentation describe the per-stage/per-CLI shape, legacy compatibility, and precedence. Focused automated tests cover all stages and providers, independent model/level resolution, clearing and scope isolation, legacy conversion, malformed input, unsupported thinking levels, and provider switches; compile-tests, compile, focused tests, npm test, and lint pass.
- [ ] A Development Host smoke test saves distinct model and thinking-level values for at least two CLIs at the same stage and different values at another stage, verifies the correct scoped settings.json entries, confirms the panel and quick-pick show those values, and checks that clearing one override preserves the others and restores the expected inherited/default value.

## Activity
### 2026-10-09T02:01:30.805Z - Definition requested from Codex (ChatGPT)
Asked Codex (ChatGPT) to fill in the Description and Acceptance criteria for this card.

### 2026-10-09T02:07:39.597Z - Run settings recommended by Jev
Jev (TypeSafe) judged this card's difficulty tier: **heavy**.

- copilot: model `claude-sonnet-5.5`, thinking level `xhigh`
- codex: model `gpt-6.1-sol`, thinking level `max`
- claude-code: model `sonnet`, thinking level `max`
- cursor: model `auto`

### 2026-10-09T02:11:58.692Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.

### 2026-10-08 - Implementation started by Codex
Reviewed the current Implement card, repository instructions, and existing working-tree changes. The external pasted handoff is accessible and applied. This session cannot change its assigned model to `gpt-6.1-sol`; work is being performed by the assigned GPT-6 coding agent. Stage settings currently use shared strings; implementing provider-scoped preferences while preserving the existing changes.

### 2026-10-08 - Implementation and focused validation
Implemented stage-to-provider model and thinking-level maps, independent panel and quick-pick edits, scoped inheritance and clearing, legacy conversion that preserves unedited CLIs, configured-only stage suggestions, shared stage/CLI protocol validation, and provider-specific dispatch resolution. Added matrix, scope, legacy, malformed-input, unsupported-effort, quick-pick, fallback, and orchestrator tests. Both builds and 190 focused tests pass. Updated configuration help, README, and Unreleased notes. Full-suite/lint closeout and the explicitly required Development Host smoke test remain.

### 2026-10-08 - Validation complete; Development Host check pending
Implemented independent model/effort preferences for every stage/CLI pair, both editors, scope isolation and inheritance, legacy conversion, shared protocol validation, provider-switch resolution, schemas, help and documentation. Existing unrelated working-tree changes were preserved. All 11 implementation/automated criteria are checked; the Development Host smoke criterion remains unchecked because native Windows UI control is unavailable in this session and no human smoke-test result has been received.

Changed files: src/agentCliModels.ts, src/agentCliSettingsEditor.ts, src/agentCliSettingsPanelController.ts, src/agentCliSettingsQuickPick.ts, src/webview/agentCliModels.ts, src/types.ts, src/extension.ts, src/agentCliHandoff.ts, package.json, README.md, CHANGELOG.md, test/unit/agentCliStageModels.test.ts, test/unit/agentCliSettingsPanelController.test.ts, and this card.

Verified: TypeScript diagnostics, compile-tests, compile, 190 focused tests, 704 full-suite tests, lint, and scoped git diff --check all pass. Commands:
- `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.test.json`
- `npm.cmd run compile-tests`
- `npm.cmd run compile`
- `node --test dist-test/test/unit/agentCliStageModels.test.js dist-test/test/unit/agentCliSettingsPanelController.test.js dist-test/test/unit/agentCliSettingsEditor.test.js dist-test/test/unit/cardThinkingLevel.test.js dist-test/test/unit/agentCliFallback.test.js dist-test/test/unit/agentCliEscalation.test.js dist-test/test/unit/agentCliOrchestrator.test.js dist-test/test/unit/runWithAi.test.js`
- `npm.cmd test`
- `npm.cmd run lint`

Required human smoke test (AGENTS.md workflow step 9 and the final acceptance criterion):
1. Press F5 with the existing Run Extension launch configuration; open a test workspace in the Development Host and run MWNN Kanban: Agent CLI Models.
2. In User scope, save a Codex Implementation model and thinking level. In Workspace scope, save different Implementation model/level values for Codex and Claude Code, plus distinct Codex Triage values. Confirm User settings.json is unchanged by Workspace edits and the stage-to-provider entries are in the test workspace's .vscode/settings.json.
3. Open MWNN Kanban: Manage Agent CLI Models and Thinking Levels in the same scope; confirm those stage/CLI values appear. Change a model and a thinking level through the quick-pick, including an off-list name; confirm the open panel updates.
4. Remove the Workspace Codex Implementation model through the quick-pick and its thinking level through the panel. Confirm the User values are identified as inherited and Claude Code/Triage entries remain unchanged. Edit a stage entry in settings.json externally and confirm the panel refreshes without reloading; edit a provider model/level list and confirm the open board suggestions refresh.

A working-tree VSIX can be packaged with dependencies and installed for this check under the local test install rule in .github/instructions/vscode-extension-release.instructions.md; it would retain version 0.0.15 and include the existing uncommitted changes. No release or version bump was performed.

STATUS: BLOCKED: Development Host smoke test requires human confirmation.

### 2026-10-08 - Working-tree test build installed
At the user's request, packaged and installed the current working tree into VS Code as darrenjmcleod.mwnn-kanban version 0.0.15. The build includes existing uncommitted changes and the Pro runtime; no version bump or publication was performed. Packaging used a temporary ignore file to exclude the linked Pro repository's development dependencies, leaving the repository packaging configuration unchanged. Verified all nine extension/webview/Pro runtime files against both the archive and the installed extension.

VSIX: C:\Users\darre\AppData\Local\Temp\mwnn-kanban-test-1791516045180.vsix
SHA-256: 0c686b9cebb4a84567b4b22bc55240513a04d77ee8ed78f8626b59bab9bc24eb
Commands:
- `npx.cmd --yes @vscode/vsce package --ignoreFile "C:\Users\darre\AppData\Local\Temp\mwnn-kanban-test-1791516234198.vscodeignore" --out "C:\Users\darre\AppData\Local\Temp\mwnn-kanban-test-1791516045180.vsix"`
- `code.cmd --install-extension "C:\Users\darre\AppData\Local\Temp\mwnn-kanban-test-1791516045180.vsix" --force`

VS Code reported successful installation. Next: run Developer: Reload Window, then open MWNN Kanban: Agent CLI Models and perform the smoke steps recorded above. The final acceptance criterion remains unchecked pending that test result.

STATUS: BLOCKED: Development Host smoke test requires human confirmation.

### 2026-10-09T17:21:50.236Z - Usage Orchestrator chose OpenAI Codex CLI
Stage: verification. OpenAI Codex CLI reports 89% remaining, resetting 2026-10-16T12:19:08.000Z - the soonest reset among the CLIs with usage left, so it is spent before it is lost.

### 2026-10-09T17:21:51.029Z - Usage Orchestrator dispatch dispatch-mv18fz5h-2 started
Card: card-mv0bjpup-1 ("Modify the AI Loop model preference so that for each task you can set the preferred model for each cli"). CLI: OpenAI Codex CLI. Stage: verification.
Requested model: "gpt-6.1-sol" (source: the card's preferred model; passed to the CLI exactly as shown).
Actual model: awaiting authoritative CLI/session metadata.
Started OpenAI Codex CLI in the active workspace and waiting for card-file completion evidence.
Card preferred model: gpt-6.1-sol.
Card thinking level: max.

### 2026-10-09T17:21:57.964Z - Usage Orchestrator dispatch dispatch-mv18fz5h-2 actual model unavailable
Card: card-mv0bjpup-1. CLI: OpenAI Codex CLI. Stage: verification.
Actual model unavailable: the CLI rejected the requested model before reporting a model that it used. The requested model selection, if any, remains recorded separately. Attempt: dispatch-mv18fz5h-2.

### 2026-10-09T17:21:58.237Z - OpenAI Codex CLI verification handoff failed
OpenAI Codex CLI rejected the card's preferred model "gpt-6.1-sol": {"type":"error","message":"{\"type\":\"error\",\"status\":400,\"error\":{\"type\":\"invalid_request_error\",\"message\":\"The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account.\"}}"}. The card was not advanced; set a model name OpenAI Codex CLI accepts on the card, or clear the card's preferred model to use that CLI's default.

### 2026-10-09T17:21:59.180Z - AI loop handed verification to Human
The card remains in Verify and was reassigned to Human.
Why: The AI verification hand-off could not be started.
Verification focus: Investigate this specific AI-verification result before sign-off: The AI verification hand-off could not be started.
Human verification procedure:
1. Independently verify every acceptance criterion against the current workspace; do not rely only on the AI's completion claim.
2. Review the implementation and all existing Activity context, then run every relevant automated check and every applicable manual or visual check.
3. Record each check performed and its result in Activity, with concrete evidence for the corresponding acceptance criterion.
4. Move the card to Done only when every acceptance criterion passes.
5. If any criterion fails or cannot be verified, leave the card in Verify and document the failed or unverified criteria, evidence, and required follow-up in Activity.
