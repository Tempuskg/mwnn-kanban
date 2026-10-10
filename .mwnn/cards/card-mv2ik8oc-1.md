---
id: card-mv2ik8oc-1
title: Add a per-card Stop AI run button to the board webview
column: col-mqwk2njn-4
position: -69000
assignee: { kind: human }
createdAt: 1791643972377
updatedAt: 1791645647746
---

## Description
Today `mwnn-kanban.stopCardRun` (Stop Card AI Run) can only be reached from the palette, even though the board already shows a "<provider> running" chip on the card whose CLI run is live. Add a Stop control to that running card in `media/board.js`. It should post a new `stopCardRun` message with `cardId`, and `src/boardPanel.ts` should abort only that card's entry in `activeCardCliRuns`; the palette command still aborts all runs. Update the shared message-protocol types on both sides. Decision record: wiki/command-ui-surfaces.md (from card-mv2h1yip-1).

## Acceptance criteria
- [x] A Stop button appears on a card only while that card has a live CLI run and `mwnn-kanban.enableRunWithAI` is on
- [x] Clicking it aborts only that card's run and leaves other active card runs and the AI loop untouched
- [x] The palette command `mwnn-kanban.stopCardRun` behaves as before
- [x] Message types are updated on both the host and webview sides, and a unit test covers per-card abort routing
- [x] Development Host smoke test: start a card run, stop it from the card, and see the running chip clear

## Activity
- 2026-10-10 Claude Code: created from the command UI audit (card-mv2h1yip-1)

### 2026-10-10T15:09:06.266Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-10-10 Claude Code: per-card Stop implemented
- Added `src/cardCliRuns.ts` (`CardCliRunRegistry`): single-card runs register with their card id; `abortCard` aborts only that card's runs, `abortAll` backs the unchanged palette `mwnn-kanban.stopCardRun`. AI loop dispatches never register, so they are untouched.
- `runWithProgress` now takes an optional `cardId` (passed from `src/runWithAi.ts`); `src/extension.ts` marks single-card run statuses `stoppable` and wires `stopCardRun` into the board panel deps.
- Protocol: `CliRunStatus.stoppable` (host→webview) and `{ type: 'stopCardRun', cardId }` (webview→host) in `src/types.ts`, routed in `src/boardPanel.ts`.
- `media/board.js` renders a Stop button on a card only while its run is live, stoppable, and `enableRunWithAI` is on; `media/board.css` styles it.
- Tests: `test/unit/cardCliRuns.test.ts` covers per-card abort routing and the message guard. compile-tests, compile, `npm test` (782/782), and lint pass.
- Not done: Development Host smoke test (start a card run, click Stop on the card, confirm the running chip clears) needs a human.
Initially reported as blocked: Development Host smoke test still needed; resolved below.

### 2026-10-10T15:13:47.020Z - AI-guided interview started in Claude Code
Opened an interview chat in Claude Code. Answers are recorded below as they are given; this entry is not evidence that any acceptance criterion is met.

### 2026-10-10 Interview: smoke test status
- Q: Has the Development Host smoke test been run (start a card run, click Stop on the card, confirm the running chip clears)?
- A: Not yet. Darren asked for the working-tree build to be packaged and installed so they can test it (reported by Darren McLeod in interview chat, 2026-10-10).
- Done (verified): packaged the working tree to `%TEMP%\mwnn-kanban-test.vsix` with dependencies. The pro package was staged from a packed copy of `E:\mwnn-kanban-pro` because its dev junction breaks vsce, and the junction was restored afterwards. Confirmed the archive contains `extension/node_modules/@tempuskg/mwnn-kanban-pro/` and the `stopCardRun` code in `media/board.js`, then installed with `code --install-extension --force`. Same version as the current release; this is not a release.
- Smoke test result: pending, awaiting Darren's report.

### 2026-10-10 Interview: smoke test result
- Q: When you clicked Stop on the running card, did the running chip clear?
- A: Yes (reported by Darren McLeod in interview chat, 2026-10-10, against the installed working-tree build).

### 2026-10-10 Interview summary
- Met: all five acceptance criteria. Criteria 1–4 rest on the implementing agent's evidence (code, `test/unit/cardCliRuns.test.ts`, compile/test/lint green). Criterion 5 is user-reported by Darren McLeod, not independently verified.
- Open: none. Unresolved exceptions: none.
- The card was not moved and its assignee was not changed in this interview.
STATUS: DONE
