---
id: card-mqz7b9ae-3
title: Create an AI loop feature that automatically runs the board and leaves cards at the Verify column and assigns them to Human
column: col-mqwk2njn-3
position: 1000
assignee: { kind: ai }
createdAt: 1782736549574
updatedAt: 1782942935360
dependsOn: [card-mqz791h5-2]
---

## Description
Add an "AI loop" feature that automates the board end-to-end for AI-assigned work instead of the user running one card at a time. Today `runCardWithAI` (`src/extension.ts`) hands off a single AI card on demand; this slice introduces a loop that repeatedly picks up AI-assigned cards, drives them forward, and advances each card into the next column as it completes — but deliberately stops the automation at the `verify` role column.

When a card reaches Verify, the loop parks it there and reassigns it from AI to Human, so a person owns the verification/sign-off step. This gives a hands-off pipeline (Backlog/Ready → In Progress → … → Verify) where AI does the implementation and hands finished work back to a human at the gate, rather than pushing straight to Done.

In loop mode the loop also triages **unassigned** cards (no `assignee`) rather than skipping them: it asks the AI to decide whether the card is doable by an AI agent. If yes, the card is assigned to AI (`{ kind: 'ai' }`) and then flows through the loop like any other AI card; if no, it is assigned to Human (`{ kind: 'human' }`) and left for a person. When an unassigned card has only a title (no Description / Acceptance criteria yet), the loop first runs a "fill with AI" definition step (the existing `fillCardDefinition` / `buildCardDefinitionPrompt` flow) to populate the card, and only then makes the AI-vs-Human doability decision. This means a user can drop bare-title cards on the board, start the loop, and have it self-organize: define the work, route automatable cards to AI, and hand the rest to a human.

The loop must respect the existing board model: cards with unfinished `dependsOn` prerequisites are treated as blocked and not advanced, and card/column mutations go through `store` so `.mwnn/` files and the webview stay in sync. It also honours the existing `Run With AI` enable setting and the same chat-provider hand-off path used by `runCardWithAI`. This card depends on `card-mqz791h5-2`, which makes `verify` a stable, first-class column role the loop can key off.

Scope is the loop orchestration, unassigned-card triage (fill-then-decide), the stop-at-Verify + reassign-to-Human behavior, and its start/stop control surface — not new column roles and not the underlying single-card hand-off / fill-definition mechanisms (reused as-is).

## Acceptance criteria
- [ ] A command (e.g. `mwnn-kanban.runBoardLoop`) and/or board control starts an AI loop that automatically processes AI-assigned cards across columns without the user triggering each card individually.
- [ ] AI-assigned cards (`assignee.kind === 'ai'`, via the existing `listAiCardSelections` / `findAiCardSelection` helpers) are picked up and advanced by the loop; already Human-assigned cards are never picked up or advanced.
- [ ] Unassigned cards (no `assignee`) are triaged in loop mode: the AI is asked to decide whether the card is doable by an AI agent, and the card is then assigned to AI (`{ kind: 'ai' }`) if yes or Human (`{ kind: 'human' }`) if no.
- [ ] For an unassigned card that has only a title (empty Description and Acceptance criteria), the loop first runs the existing fill-with-AI definition step (`fillCardDefinition` / `buildCardDefinitionPrompt`) to populate the card, and only then makes the AI-vs-Human doability decision.
- [ ] A card triaged to AI subsequently flows through the loop like any other AI card (advanced column by column, stopped and reassigned to Human at Verify); a card triaged to Human is left in place for a person and not further advanced by the loop.
- [ ] Cards with unfinished `dependsOn` prerequisites are treated as blocked and are not advanced by the loop until their dependencies are complete.
- [ ] When an AI card completes in a column, the loop advances it into the next column (the same `nextColumn` progression used by the single-card flow), going through the board's ordered columns.
- [ ] The loop stops advancing a card once it reaches the column with `role === 'verify'`: the card is parked in Verify and is not moved on to Done by the loop.
- [ ] On parking a card in Verify, the loop reassigns it from AI to Human (`assignee` becomes `{ kind: 'human' }`) so a person owns verification; the reassignment is persisted via `store` and reflected in the card `.mwnn` file and the webview.
- [ ] The loop respects the existing `Run With AI` enable setting (`readEnableRunWithAI`): when disabled it shows the same guidance message and does not run.
- [ ] All card moves and assignee changes go through `store` (not direct file writes), so `.mwnn/cards/*.md` and the open board panel stay consistent, and each loop action appends a corresponding entry to the card's Activity log.
- [ ] The loop can be stopped/cancelled by the user, and it terminates on its own when there are no remaining eligible AI cards to advance (no infinite looping over blocked or Verify-parked cards).
- [ ] `npm run compile` and `npm run compile-tests` succeed, and unit tests cover: selecting AI cards, triaging unassigned cards to AI vs Human, running fill-with-AI first for title-only unassigned cards, skipping blocked cards, stopping at Verify, and reassigning a Verify-parked card to Human.

## Activity
### 2026-07-01T16:43:01.762Z - Definition requested from Codex (ChatGPT)
Asked Codex (ChatGPT) to fill in the Description and Acceptance criteria for this card.

### 2026-07-01T20:16:22.114Z - Definition requested from Codex (ChatGPT)
Asked Codex (ChatGPT) to fill in the Description and Acceptance criteria for this card.

### 2026-07-01T20:17:00.678Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.

### 2026-07-01T21:55:35.302Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-07-01T22:40:00.000Z - Implemented by Claude Code
Added the AI board loop:
- New `src/boardLoop.ts` (no vscode imports, fully unit-testable): a pure action planner plus an injectable async runner. Each pass it parks AI cards that reached the `verify` column (reassigning them to `{ kind: 'human' }`), triages unassigned cards (fill-with-AI definition first when the card is title-only, then an AI doability decision routing to `{ kind: 'ai' }` or `{ kind: 'human' }`), advances unblocked AI cards through the ordered columns, dispatches the existing card hand-off prompt in work columns, and waits for the agent's `STATUS: DONE` / `STATUS: BLOCKED` report (scanning only activity appended after the dispatch). Blocked (`dependsOn`) cards are never advanced, the loop never moves a card into a `done` column, at most one chat hand-off is in flight at a time, and it terminates on its own once nothing is actionable or waiting (failed hand-offs, BLOCKED reports, and wait timeouts mark cards skipped so it can't spin).
- Wired `mwnn-kanban.runBoardLoop` and `mwnn-kanban.stopBoardLoop` commands in `src/extension.ts` and `package.json`. The loop honours `readEnableRunWithAI` with the same guidance message, reuses `pickChatProvider`/`handOffPromptToChat`/`buildCardHandoffPrompt`/`buildCardDefinitionPrompt`, runs under a cancellable progress notification (cancel = stop), and mutates only through `store` so `.mwnn/` files and the webview stay in sync; every action appends an Activity entry. The doability decision uses the VS Code Language Model API (`vscode.lm.selectChatModels`) with a `DOABLE_BY_AI`/`NEEDS_HUMAN` verdict prompt; when no model or verdict is available the card is left unassigned and skipped.
- Added `test/unit/boardLoop.test.ts` (17 tests) covering: AI-card selection vs human cards, blocked-card skipping, park-at-Verify with Human reassignment, fill-then-triage for title-only cards, triage to AI vs Human, BLOCKED reports, hand-off failure, cancellation, wait timeout, never advancing into Done, and doability prompt/parsing.
- Validation: `npm run compile`, `npm run compile-tests`, `npm test` (122 pass), and `npm run lint` all succeed. Not verified here: a live Development Host smoke test of the new commands.
