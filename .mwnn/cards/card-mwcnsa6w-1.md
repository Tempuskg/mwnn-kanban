---
id: card-mwcnsa6w-1
title: In cursor we have the gitHub co-pilot aI option when you click on run with AI have it say cursor instead of github Copilot
column: col-mqwk2njn-4
position: -116000
assignee: { kind: ai }
preferredModel.copilot: claude-sonnet-5.5
preferredModel.codex: gpt-6-luna
preferredModel.claude-code: sonnet
preferredModel.cursor-other: claude-opus-5-5-medium
thinkingLevel.copilot: medium
thinkingLevel.codex: medium
thinkingLevel.claude-code: medium
createdAt: 1794434189720
updatedAt: 1794777438295
---

## Description
Update the card's Run with AI provider picker so the editor chat option currently labelled GitHub Copilot displays Cursor when MWNN Kanban runs inside Cursor. Use the editor identity to present the correct chat label while preserving the existing card-prompt handoff and keeping chat distinct from the Cursor Agent CLI options.

## Acceptance criteria
- [x] In Cursor, opening Run with AI on a card shows the editor chat option labelled Cursor instead of GitHub Copilot.
- [x] Selecting Cursor hands the selected card's prompt to Cursor's editor chat through the existing chat handoff flow.
- [x] In VS Code, the corresponding chat option still displays GitHub Copilot and retains its existing handoff behavior; local CLI options retain their existing labels and dispatch targets in both editors.
- [x] Focused automated checks cover the editor-dependent picker label and preserved chat target, and a Development Host smoke test in Cursor confirms the displayed label and successful card-prompt handoff.

## Activity
### 2026-11-15T17:22:04.179Z - Usage Orchestrator chose OpenAI Codex CLI
Stage: definition. OpenAI Codex CLI reports 21% remaining, resetting 2026-11-22T01:50:22.000Z - the soonest reset among the CLIs with usage left, so it is spent before it is lost.

### 2026-11-15T17:22:06.120Z - Usage Orchestrator dispatch dispatch-mwi3qtgo-1 started
Card: card-mwcnsa6w-1 ("In cursor we have the gitHub co-pilot aI option when you click on run with AI have it say cursor instead of github Copilot"). CLI: OpenAI Codex CLI. Stage: definition.
Requested model: "gpt-6.1-sol" (source: the AI loop stage model rule; passed to the CLI exactly as shown).
Actual model: awaiting authoritative CLI/session metadata.
Started OpenAI Codex CLI in the active workspace and waiting for card-file completion evidence.
AI loop stage model rule for the definition stage: gpt-6.1-sol.
AI loop stage thinking level rule for the definition stage: medium.

### 2026-11-15T17:22:10.716Z - Usage Orchestrator dispatch dispatch-mwi3qtgo-1 model observed
Card: card-mwcnsa6w-1. CLI: OpenAI Codex CLI. Stage: definition.
Actual model: "gpt-6.1-sol" (source: Codex rollout turn_context.payload.model; attempt: dispatch-mwi3qtgo-1).

### 2026-11-15T17:23:40.636Z - Run settings recommended by Jev
Jev (TypeSafe) judged this card's difficulty tier: **standard**.

- copilot: model `claude-sonnet-5.5`, thinking level `medium`
- codex: model `gpt-6-luna`, thinking level `medium`
- claude-code: model `sonnet`, thinking level `medium`
- cursor-other: model `claude-opus-5-5-medium`

### 2026-11-15T18:01:36.088Z - Auto-started in Implement
Assigned to AI in Ready; moved to Implement automatically.

### 2026-11-15T18:01:45.376Z - Usage Orchestrator chose OpenAI Codex CLI
Stage: implementation. OpenAI Codex CLI reports 20% remaining, resetting 2026-11-22T01:50:22.000Z - the soonest reset among the CLIs with usage left, so it is spent before it is lost.

### 2026-11-15T18:01:47.894Z - Usage Orchestrator dispatch dispatch-mwi55v92-2 started
Card: card-mwcnsa6w-1 ("In cursor we have the gitHub co-pilot aI option when you click on run with AI have it say cursor instead of github Copilot"). CLI: OpenAI Codex CLI. Stage: implementation.
Requested model: "gpt-6-luna" (source: the card's preferred model; passed to the CLI exactly as shown).
Actual model: awaiting authoritative CLI/session metadata.
Started OpenAI Codex CLI in the active workspace and waiting for card-file completion evidence.
Card preferred model: gpt-6-luna.
Card thinking level: medium.

### 2026-11-15T18:01:51.917Z - Usage Orchestrator dispatch dispatch-mwi55v92-2 model observed
Card: card-mwcnsa6w-1. CLI: OpenAI Codex CLI. Stage: implementation.
Actual model: "gpt-6-luna" (source: Codex rollout turn_context.payload.model; attempt: dispatch-mwi55v92-2).

### 2026-11-15T18:02:46.199Z - OpenAI Codex CLI implementation handoff failed
OpenAI Codex CLI exited successfully, but no terminal `STATUS: DONE` or `STATUS: BLOCKED: <reason>` line was appended to the card Activity. The card was not advanced; rerun the implementation handoff after fixing the agent instructions or CLI.

### 2026-11-15T20:05:34.686Z - OpenAI Codex CLI implementation handoff started
Started OpenAI Codex CLI in the active workspace and waiting for card-file completion evidence.
Card preferred model: gpt-6-luna.
Card thinking level: medium.

### 2026-11-15T20:06:19.410Z - OpenAI Codex CLI implementation blocker recorded by MWNN
OpenAI Codex CLI exited without appending a terminal status to this card, but its final reply reported a blocker. MWNN recorded it here from the CLI output.
Initially reported as blocked: workspace commands appeared to hang; resolved in a later implementation pass.

### 2026-11-15T21:14:03.071Z - OpenAI Codex CLI implementation handoff started
Started OpenAI Codex CLI in the active workspace and waiting for card-file completion evidence.
Card preferred model: gpt-6-luna.
Card thinking level: medium.

### 2026-11-15 - Cursor editor chat label implementation
Updated Run with AI chat choices to label the Copilot chat target as Cursor when `vscode.env.appName` identifies Cursor. Preserved the existing chat handoff target and left all local CLI labels and providers unchanged. Added focused tests for Cursor and VS Code labels, chat target identity, and CLI entries. `npm run compile-tests`, `node --test dist-test/test/unit/runWithAi.test.js`, and `npm run compile` passed (41 focused tests). Could not complete the requested Cursor UI smoke test: the Extension Development Host opened, but the MWNN Kanban board webview remained blank, so the picker and prompt handoff could not be exercised. The remaining acceptance item is that smoke test.
Initially reported as blocked: Cursor Development Host board webview is blank, preventing verification of the Run with AI picker and prompt handoff. Resolved below.

### 2026-11-15 Claude Code: review
Reviewed and committed the Cursor label change. The full `npm test` run found 2 failures in `test/unit/providerPickerLicense.test.ts`, whose fake `vscode` lacked `env.appName`; fixed in the test. 1172/1172 tests and lint pass. The Cursor Development Host smoke test is still outstanding: in Cursor, the "Cursor" chat choice still runs `workbench.action.chat.open`, and whether that opens Cursor's own chat is unverified.

### 2026-11-15 Claude Code: Cursor smoke test passed
The user ran the smoke test in Cursor: Run with AI shows the chat choice labelled Cursor, and selecting it hands the card prompt to Cursor's chat. All acceptance criteria met.
STATUS: DONE
