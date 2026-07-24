---
id: card-mr50aj71-1
title: "In AI Loop when it picks a card from the backlog and defines it, it should be placed in the Ready column. Currently it is going into the Implement Column."
column: col-mqwk2njn-4
position: -2000
assignee: { kind: human }
createdAt: 1783087555501
updatedAt: 1784475118434
---

## Description
When the AI board loop (`runBoardLoop` in `src/boardLoop.ts`) picks up an undefined, unassigned card from the Backlog, it requests a definition, then triages the card, and — because `planLoopAction` treats Backlog and Ready as pass-through "pre-work" columns for AI-assigned cards — immediately advances it column by column and dispatches it into the Implement (in-progress) column, all within the same loop run.

That skips the Ready column's role in the methodology: Ready is where defined cards wait to be pulled into work. A card the loop has just defined should land in Ready and stop there for that run, so a human can review the freshly written Description and Acceptance criteria before implementation begins. Change the loop so that a card it defines from the Backlog is placed at the end of the Ready column and is not auto-advanced past Ready or dispatched during the same run. Cards that were already defined and AI-assigned before the run starts keep today's behavior (advance through pre-work columns and get dispatched).

## Acceptance criteria
- [ ] When the loop requests a definition for a Backlog card and the definition completes (card becomes defined per `isCardDefined`), the loop moves that card to the end of the Ready column and appends an Activity entry recording the move.
- [ ] A card the loop defined during the current run is never advanced past Ready nor dispatched to the chat agent in that same run, regardless of its triage outcome (AI or Human).
- [ ] A card the loop defines while it is already sitting in Ready stays in Ready (it is not advanced to Implement in that run).
- [ ] If the board has no column with role `ready`, the freshly defined card stays where it is (no move, no dispatch) and the loop continues without error.
- [ ] Cards that were already defined and AI-assigned before the run starts still advance through Backlog/Ready and get dispatched in work columns exactly as before (no regression to existing `planLoopAction` behavior or its tests).
- [ ] Unit tests in `test/unit/boardLoop.test.ts` cover: define-from-Backlog lands in Ready, no dispatch of a freshly defined card in the same run, and the no-Ready-column fallback.
- [ ] `npm test` (or the repo's standard test command) passes.

## Activity
### 2026-07-03T14:06:12.063Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.

### 2026-07-03T14:12:02.317Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-07-03T14:35:00.000Z - Implemented by Claude Code
Added a `definedThisRun` set to `LoopSession` (`src/boardLoop.ts`), populated in `pruneLoopSession` when a definition wait resolves with the card now defined. `planLoopAction` returns a new `move-to-ready` action for such cards still in a backlog-role column (placing them at the end of the Ready column, with a new `formatLoopDefinedReadyEntry` Activity entry), and never plans a pre-work advance or a dispatch for a freshly defined card, regardless of triage outcome. With no ready-role column the card stays put and the loop continues. Cards defined before the run are untouched by the gate, so existing advance/dispatch behavior is unchanged. Added `movedToReady` to `LoopSummary` and surfaced it in `summarizeLoopRun` (`src/extension.ts`). New tests in `test/unit/boardLoop.test.ts`: define-from-Backlog lands at the end of Ready with no dispatch, define-in-Ready stays in Ready without a move, and the no-Ready-column fallback. Verified with `npm test` (130 pass), `npm run compile`, and `npm run lint` — all clean.
