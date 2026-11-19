---
id: card-mwms8fqc-1
title: Refresh the board and open card when the Claude desktop app updates a card file
column: col-mqwk2njn-4
position: -127000
assignee: { kind: ai }
createdAt: 1795046323620
updatedAt: 1795126247028
---

## Description
User-reported 2026-11-18: a card updated from the Claude desktop app (Claude Code tab) did not refresh in VS Code. Example: e:\session-control-pro\.mwnn\cards\card-mw6qoopl-4.md, where Claude appended Activity entries ending in `STATUS: DONE` and checked acceptance criteria. The file on disk had the update, but the person did not see `STATUS: DONE` in VS Code. The desktop app wrote the files with whole-file rewrites (Python/shell scripts, outside VS Code), and one write also changed the line endings from LF to CRLF. External edits are expected to reload through `registerBoardWatcher` in src/extension.ts (workspace `createFileSystemWatcher` on `<boardFolder>/**`, debounced `store.reload()` then `BoardPanel.postStateIfOpen()`).

Not yet established: whether the stale view was the board webview, the card details view or a text editor tab; whether the watcher event fired; and whether the cause is a missed event, a dropped or shut-down watcher, or a reload that does not repost an open details panel. The same VS Code instance's logs showed repeated `[File Watcher (node.js)] Watcher shutdown because watched path got deleted` warnings, which is a lead, not a confirmed cause. Reproduce first.

## Acceptance criteria
- [x] A reproduction shows which view stays stale (board, card details or editor) after an external whole-file rewrite of a card, including a CRLF rewrite
- [x] Root cause is identified with evidence (watcher event, reload or post-to-webview path)
- [x] After an external rewrite, the board and any open card details for that card show the new content and status within the normal debounce
- [x] If the watcher shuts down or misses events, the board recovers without reopening VS Code
- [x] Automated tests cover the external-rewrite reload path, and compile, tests and lint pass

## Activity
- 2026-11-18 America/Regina - Created at the person's request from the Claude desktop app. Symptom user-reported; file content verified on disk (card-mw6qoopl-4.md ended with `STATUS: DONE`). Watcher code location verified by reading src/extension.ts.

### 2026-11-19T12:54:39.178Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-11-19 - Claude Code: root cause found and fixed; Dev Host smoke test pending
- Reproduction (scratch copy of e:\session-control-pro\.mwnn, real store code): with the pre-fix store, a CRLF whole-file rewrite of card-mw6qoopl-4 adding `STATUS: DONE` stays stale on reload. It refreshes as soon as two *other* cards are repaired: card-mvf5ju3j-1.md and card-mvkfmco4-1.md had been overwritten by the desktop app with only an Activity fragment (no frontmatter). CRLF on its own is handled fine (`normalizeNewlines`).
- Root cause: on the reload path (`refreshFromDisk` -> `readCardDocuments` in src/boardStore.ts), any unparseable card threw. The catch then kept the *entire* previous board, so every later external edit was silently dropped. The board and the open card details were both stale, because the details modal rebuilds from each `state` push (media/board.js `render()`) and no new state was ever pushed. The watcher fired; the reload discarded the result.
- Fix: reloads now read cards leniently. An unparseable card keeps its last good version (same position), or is left out if it never parsed. A new `onDidChangeUnreadableCards` callback reports it, and src/extension.ts shows one warning naming the file(s). Writes stay strict, so a fragment file is never deleted and mutations are refused until it is fixed.
- Recovery: new src/boardReloadScheduler.ts (pure, unit-tested) handles the 75 ms debounce and in-flight requeue. Watcher events always repost. Window focus, the board becoming visible, and a 10 s poll while the board is open trigger a resync that reposts only when the board changed. This covers a shut-down or missed watcher without reopening VS Code.
- Tests: test/unit/boardExternalRewrite.test.ts (LF and CRLF rewrites, fragment sibling, strict writes never deleting, never-parsed file and warning clear) and test/unit/boardReloadScheduler.test.ts. `npm run compile-tests`, `npm run compile`, `npm test` (1188/1188) and `npm run lint` pass.
- Unmet: criterion 4 needs a Development Host smoke test of the live watcher, focus and poll wiring. Steps: F5 -> open the board -> open a card's details -> rewrite that card file from an external shell with CRLF (PowerShell `(Get-Content f) -join "`r`n" | Set-Content f`) and confirm the details update in under a second. Overwrite another card with text that has no frontmatter, then edit the first card again: expect a warning naming the broken file and the first card still refreshing. Finally, edit a card while VS Code is unfocused, return focus and confirm it updates (and within ~10 s while focused).
- Follow-up for the person: restore e:\session-control-pro\.mwnn\cards\card-mvf5ju3j-1.md and card-mvkfmco4-1.md (e.g. `git checkout` them), then re-append the Activity text that is now in those files.
STATUS: BLOCKED: Development Host smoke test of live watcher/focus/poll recovery (criterion 4) needs a human; code, tests, compile and lint are done.

### 2026-11-19T13:54:57.815Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-11-19 - Claude Code (follow-up run): criterion 4 still needs a live Dev Host check
- Re-read the recovery wiring in `registerBoardWatcher` (src/extension.ts). Watcher create/change/delete events schedule an `event` reload, which always reposts. Window focus (`onDidChangeWindowState`, focused), the board panel becoming open or visible (`BoardPanel.onDidChangeState`) and the 10 s `BOARD_RESYNC_POLL_MS` poll (gated on `BoardPanel.status().open`) schedule a `resync`, which reposts only when `boardsEqual` reports a change. The scheduler is disposed with the watcher. The wiring matches the design, and the scheduler's debounce, requeue, poll and dispose behavior is unit-tested in test/unit/boardReloadScheduler.test.ts.
- I could not do the live check from this run. There was no shell on the person's machine, so no F5 Development Host. The cloud workspace cannot download VS Code for @vscode/test-electron (the proxy refuses update.code.visualstudio.com). No code changed in this run.
- Remaining human step, unchanged: in a Dev Host, open the board and a card's details. Rewrite that card from an external shell with CRLF and confirm it updates within about a second. Edit a card while VS Code is unfocused, refocus and confirm it updates. Confirm a card edited while the window stays focused updates within about 10 s even without a watcher event. Then tick criterion 4.
STATUS: BLOCKED: criterion 4 (watcher shutdown/missed-event recovery) needs a human-run Extension Development Host smoke test; code, unit tests, compile and lint are done.

### 2026-11-19 - Claude Code: live Development Host smoke test (by computer use)
- Setup: started "Run Extension" from the main window (dist rebuilt by the watch task, contains the scheduler). Opened a scratch board E:\mwnn-kanban\.tmp-smoke-board (two Backlog cards) in the Dev Host, opened the board and card A's details. Every rewrite was a whole-file write from outside VS Code.
- Test 1 (CRLF rewrite) passed. Card A was rewritten with CRLF line endings, a new title, a checked criterion and `STATUS: DONE`. Within about 1 s, the board showed the new title and a Done badge, and the open details showed the new title, `[x]` and the new Activity lines.
- Test 2 (fragment sibling) passed. Card B was overwritten with a bare Activity fragment (no frontmatter), then card A was rewritten again. Card A's board and details refreshed within about 1 s, card B kept its last good version, and a warning appeared: "MWNN Kanban could not read a card file: .mwnn/cards/card-smoke-2…". This is the original failure mode, now fixed live. Criterion 3 is verified live.
- Not a product issue: one early attempt seemed stale because the file-transfer tool re-sent a cached copy of the original file. The disk content was unchanged, so the board was correct.
- Test 3 (missed-event recovery) is incomplete. To isolate the safety net, I temporarily built with the watcher handlers disabled. The approval for the next step took about 2 h and VS Code access lapsed, so the fault-injected Dev Host was never exercised. src/extension.ts is restored byte-for-byte (108952 bytes; `scheduleEventReload` schedules 'event' again). The watch task will rebuild dist on its next run.
- Leftovers for the person: scratch folder E:\mwnn-kanban\.tmp-smoke-board (including probe.md), safe to delete. The main VS Code window was minimized and the Dev Host may still be running.
- To finish criterion 4: in a Dev Host built with the watcher handlers disabled (change `scheduleEventReload` to a no-op), edit a card externally. Expect the board to update within about 10 s while focused, and on refocus after editing while unfocused. Then revert.
STATUS: BLOCKED: criterion 4 (recovery when the watcher misses events) still needs the fault-injected Dev Host check; criteria 1, 2, 3 and 5 are verified, and criterion 3 is now verified live.

### 2026-11-19T20:47:00Z - Claude Code: criterion 4 verified live; startup bug found and fixed
- Fault injection: I rebuilt the Dev Host with the watcher handlers disabled (`scheduleEventReload` a no-op), so only the focus, visibility and poll safety net could refresh the board. Scratch board E:\mwnn-kanban\.tmp-smoke-board, with card A's details open.
- New bug found: with the fragment card from test 2 still on disk, the Dev Host failed to activate the extension with "Card markdown is missing frontmatter". The startup load in `loadOrInitializeState` was still strict, so reopening VS Code would have left the board dead.
- Fix (src/boardStore.ts): startup now reads cards leniently, like reloads. An unreadable card is left out and reported through `onDidChangeUnreadableCards`. Nothing is written back while one exists: column-id recovery and the blocked-card enforcement write are skipped, so columns.json is never rewritten and mutations stay refused. `unreadableSignature` starts as "[]" so a clean startup sends no empty notification. Tests: `does not rewrite columns when an existing card cannot be read` (boardStore.test.ts) now asserts the board loads, the file is reported, columns.json and the fragment are untouched and mutations still reject. New test: `starting with a fragment card on disk still loads the board and recovers once it is fixed` (boardExternalRewrite.test.ts).
- Live results with the watcher disabled and the fix built in:
  - Startup with the fragment on disk: the board loaded with the warning "could not read a card file: .mwnn/cards/card-smoke-2…".
  - Focused external rewrite (POLL-3B): stale for about 4-5 s, then the board and open details updated on the poll tick.
  - Rewrite while VS Code was unfocused (FOCUS-3C): updated when the window was focused again. 15 s had passed, so the poll or the focus resync delivered it.
  - Fixing the fragment card: "Smoke card B FIXED" appeared on the board.
- Validation in a clean copy (without the private @tempuskg/mwnn-kanban-pro package, which the build does not import): `tsc -p tsconfig.test.json`, unit tests 1189 (1185 pass, 4 skipped, 0 fail), `eslint src --ext ts` and `webpack` all pass. CHANGELOG [Unreleased] has a Fixed entry.
- Cleanup: src/extension.ts is restored byte-for-byte (108952 bytes, verified on disk), and the watch task rebuilds dist from it. Left for the person: the scratch folder E:\mwnn-kanban\.tmp-smoke-board is safe to delete, and the Dev Host is still open.
STATUS: DONE
