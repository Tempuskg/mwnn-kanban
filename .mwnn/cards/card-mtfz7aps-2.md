---
id: card-mtfz7aps-2
title: "Add Play, Pause, and Stop buttons for AI loop"
column: col-mqwk2njn-4
position: -45000
assignee: { kind: ai }
preferredModel.copilot: claude-sonnet-4.6
preferredModel.codex: gpt-5.5
preferredModel.claude-code: sonnet
thinkingLevel.copilot: high
thinkingLevel.codex: high
thinkingLevel.claude-code: high
createdAt: 1788104417536
updatedAt: 1791043185446
---

## Description
Replace the single "Run AI loop" button in the MWNN sidebar view (`src/sidebarView.ts`) with Play, Pause, and Stop controls so the user can start, temporarily hold, and cancel the AI board loop without the command palette.

- **Play** starts the loop when idle (same path as `mwnn-kanban.runBoardLoop`, including the target picker) and resumes it when paused.
- **Pause** is new: it lets the in-flight card stage/CLI run finish, then holds the loop before the next dispatch until Play is pressed. It does not abort the active process, advance cards, or count against `aiLoopMaxDispatches`.
- **Stop** reuses the existing cancel path (`stopBoardLoopCommand`: sets `cancelled` and aborts the active CLI process), and also ends a paused loop.

The extension host owns loop state (idle / running / paused) and pushes it to the sidebar webview so buttons enable/disable correctly; the sidebar only posts commands. New message types must be added to the shared protocol (`src/sidebarMessages.ts` / `src/types.ts`) on both sides, and a matching `mwnn-kanban.pauseBoardLoop` command should be contributed alongside the existing run/stop commands, gated by `enableRunWithAI`.

## Acceptance criteria
- [x] The sidebar shows Play, Pause, and Stop buttons (with accessible labels/tooltips) in place of the single "Run AI loop" button, only usable when `mwnn-kanban.enableRunWithAI` is on.
- [x] Button enablement reflects host-pushed loop state: idle → only Play enabled; running → Pause and Stop enabled; paused → Play (resume) and Stop enabled. State stays correct after the sidebar is hidden and re-shown.
- [x] Play while idle starts the loop exactly as `mwnn-kanban.runBoardLoop` does; cancelling the target picker leaves the state idle.
- [x] Pause while running lets the current card stage complete normally, then dispatches no further card until resumed; the active CLI process is not killed.
- [x] Play while paused resumes from the next eligible card with the same run's ledger, budget, and fallback state (no new target picker, no duplicate dispatch of the finished card).
- [x] Stop while running or paused ends the loop via the existing cancel/abort path and the state returns to idle; the closing report distinguishes a user stop from completion.
- [x] A `mwnn-kanban.pauseBoardLoop` command is contributed in `package.json` (title "Pause AI Loop", category "MWNN Kanban", palette-gated by `enableRunWithAI`) and shows an info message when no loop is running.
- [x] New sidebar message types (commands in, loop-state out) are declared in the shared message-protocol types and validated on receipt; unknown messages are ignored.
- [x] Unit tests cover the pause/resume gate (no dispatch while paused, resume continues, stop while paused terminates) and sidebar message validation; `npm run compile-tests`, `npm test`, and `npm run lint` pass.
- [x] Development Host smoke test: start, pause mid-run, resume, and stop the loop from the sidebar with buttons updating accordingly.

## Activity
### 2026-10-03T15:29:07.547Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.

### 2026-10-03T15:29:55.452Z - Run settings recommended by Jev
Jev (TypeSafe) judged this card's difficulty tier: **heavy**.

- copilot: model `claude-sonnet-4.6`, thinking level `high`
- codex: model `gpt-5.5`, thinking level `high`
- claude-code: model `sonnet`, thinking level `high`

### 2026-10-03T15:31:37.177Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-10-03 - Claude Code: implemented Play / Pause / Stop
Model note: the card prefers `sonnet`; this session could not switch models and ran on Claude Opus 5.5 (`claude-opus-5-5`).

- New pure pause gate `src/aiLoopPause.ts`, consumed through an optional `LoopControl.waitWhilePaused` hook awaited at the top of each `runBoardLoop` iteration (`src/boardLoop.ts`). The in-flight stage and its CLI process always finish; the next action holds until resume or stop, inside the same run, so session, dispatch ledger, budget, and fallback runner are kept.
- `src/extension.ts`: `activeLoop` carries the gate; host-owned `aiLoopState()` (idle/running/paused) plus a change emitter (also fired on `enableRunWithAI` changes). New `pauseBoardLoopCommand` (info message when not running / already paused), `playBoardLoopCommand` (resume if paused, else the unchanged `runBoardLoopCommand` path incl. target picker). Stop and progress-cancel now also release the gate so a paused run ends as cancelled (closing report says "stopped" vs "finished").
- `package.json`: `mwnn-kanban.pauseBoardLoop` ("Pause AI Loop", category MWNN Kanban, palette `when: config.mwnn-kanban.enableRunWithAI`); no-workspace stub registered too.
- `src/sidebarMessages.ts`: commands `playAiLoop` / `pauseAiLoop` / `stopAiLoop` / `sidebarReady` (retired `runAiLoop`), `AiLoopState`, `aiLoopControls()` enablement, and the `aiLoopState` host to sidebar message. Unknown messages are still ignored.
- `src/sidebarView.ts`: Play / Pause / Stop buttons with titles and aria-labels in place of "Run AI loop"; all disabled when Run With AI is off; state re-pushed on `sidebarReady` and on visibility change so it survives hide/re-show.
- Tests: `test/unit/aiLoopPause.test.ts` (new), pause/resume/stop-while-paused integration in `test/unit/boardLoop.test.ts`, routing and enablement in `test/unit/sidebarMessages.test.ts`.
- Validation: `npm run compile-tests`, `npm test` (574 pass), `npm run lint`, `npm run compile` all green.
- Not done: the Development Host smoke test (start, pause mid-run, resume, stop from the sidebar) needs a person to run the interactive UI. README/wiki/CHANGELOG were left alone per AGENTS.md until the UX is confirmed.

STATUS: BLOCKED: Development Host smoke test of the sidebar Play/Pause/Stop buttons needs a human; all other criteria are met and verified.

STATUS: DONE
