---
id: card-mv2ik8oc-4
title: Make My Work timer and focus controls state-aware and surface Stop Focus Session
column: col-mqwk2njn-4
position: -72000
assignee: { kind: human }
createdAt: 1791643972377
updatedAt: 1791655054911
---

## Description
Right now, Start Timer and Stop Timer both appear inline on every My Work card, whatever the timer state. Stop Focus Session can be reached only from the palette, even though Start Focus Session is one click away. This card fixes both, as decided in wiki/command-ui-surfaces.md (from card-mv2h1yip-1):
- The Pro module should give a card's tree item a state-specific `contextValue`, for example `mwnn-kanban.card` or `mwnn-kanban.card.timing`. Then key `startTimer` and `stopTimer` inline `when` clauses on it.
- The Pro module should set a `mwnn-kanban-pro.focusSessionActive` context key. Add `mwnn-kanban-pro.stopFocusSession` to the My Work `view/title` at `navigation@0`, when `view == mwnn-kanban.myWork && mwnn-kanban.hasProLicense && mwnn-kanban-pro.focusSessionActive`.

The Pro module is loaded from outside this repo (`src/pro/loader.ts`). If its source is not accessible, report BLOCKED with the required context-key contract rather than editing only the menus.

## Acceptance criteria
- [x] A card without a running timer shows Start Timer but not Stop Timer, and a timing card shows Stop Timer but not Start Timer
- [x] A Stop Focus Session icon appears in the My Work title only while a focus session is active
- [x] Any existing `viewItem == mwnn-kanban.card` clauses still match the base contextValue, so nothing loses its menu
- [x] Development Host smoke test: start and stop a timer, and start and stop a focus session, entirely from the My Work view

## Activity
- 2026-10-10 Claude Code: created from the command UI audit (card-mv2h1yip-1)

### 2026-10-10T16:55:32.281Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-10-10 - Claude Code: implemented, smoke test pending
- Pro (`E:\mwnn-kanban-pro`, uncommitted): `src/ui/workQueueTree.ts` gives a card `mwnn-kanban.card.timing` while a manual timer runs on it, otherwise `mwnn-kanban.card`. It updates in place on tracker changes and re-renders only when the timing card changes, not on every heartbeat. `src/registerProFeatures.ts` adds `timingCardFromTrackerState` and sets `mwnn-kanban-pro.focusSessionActive` from the tracker state. New unit tests are in `test/unit/workQueueTree.test.ts` and `test/unit/registerProFeatures.test.ts`.
- Base `package.json`: `startTimer` inline is now `viewItem == mwnn-kanban.card` and `stopTimer` inline is `viewItem == mwnn-kanban.card.timing`. `startFocusSession` inline uses `viewItem =~ /^mwnn-kanban\.card(\.|$)/`, so it still matches timing cards. `stopFocusSession` now has a `$(debug-stop)` icon and sits in the My Work `view/title` at `navigation@0`, gated on `mwnn-kanban-pro.focusSessionActive`.
- Validation: Pro compile-tests, compile (dist rebuilt), test 507/507, and eslint on the touched files are all green. Base compile-tests, compile, and test 783/783 are green.
- Remaining: the Development Host smoke test (start and stop a timer, and start and stop a focus session, from My Work) has not been run.
Initially reported as blocked: Development Host smoke test of the My Work timer and focus controls needed a human; resolved in interview below.

### 2026-10-10T17:43:54.638Z - AI-guided interview started in Claude Code
Opened an interview chat in Claude Code. Answers are recorded below as they are given; this entry is not evidence that any acceptance criterion is met.

### 2026-10-10 - Interview: timer smoke test
- Q: In a Development Host or local install with a Pro license, did you start and stop a timer using only the My Work inline buttons, with only Stop Timer shown while timing and only Start Timer shown after stopping?
- A: "Yes" (user-reported by Darren McLeod in interview chat, 2026-10-10). Timer part of the smoke test passed; the focus session part is not yet confirmed.

### 2026-10-10 - Interview: focus session smoke test
- Q: In My Work, did you start a focus session from a card's inline Start Focus Session button, see a Stop Focus Session icon in the My Work title bar while it ran, and have clicking it end the session and remove the icon?
- A: "Yes" (user-reported by Darren McLeod in interview chat, 2026-10-10).

### 2026-10-10 - Interview summary
- Criteria 1-3: met on the earlier implementation evidence (Pro and base unit tests, compile, and lint green, as recorded above). The user's smoke-test answers also confirm the behavior.
- Criterion 4 (Development Host smoke test): met on user-reported evidence. The timer start/stop and the focus session start/stop were both confirmed from the My Work view. The interviewer did not observe or independently verify this.
- Unresolved exceptions: none. Note: the Pro changes in `E:\mwnn-kanban-pro` were recorded as uncommitted at implementation time.
- The card was not moved; its column is left to the board's column/WIP rules.
STATUS: DONE
