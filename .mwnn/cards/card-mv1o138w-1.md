---
id: card-mv1o138w-1
title: Stop blocked cards silently jumping back to Ready on unrelated edits
column: col-mqwk2njn-4
position: -68000
assignee: { kind: ai }
createdAt: 1791592690352
updatedAt: 1791644811560
---

## Description
A card in a work column can quietly vanish from that column when the user makes an unrelated change, such as adding a different card. Seen on 2026-10-09 in the canadiansocial board: an agent edited card-murp5pdl-8.md directly to add a dependency that was not yet Done while the card sat in In Progress. The watcher reload left it there. The next mutation (adding a new card to In Progress) ran `enforceBlockedCardPlacement` and moved card 8 to the end of Ready in the same write, with no feedback. To the user, the existing card looked deleted.

Cause: `runQueued` in src/boardStore.ts applies `enforceBlockedCardPlacement` (src/utils.ts) only after a mutation, never after `refreshFromDisk` on a reload. A dependency added outside the extension therefore gets enforced later, attributed to whatever the user does next. The relocation is also silent.

Keep the rule (blocked cards can't sit past Ready), but make it happen when the cause happens and tell the user:
- Enforce placement when a reload brings in external edits that newly block a card, and persist that move, so the card moves at the time the dependency is added rather than on an unrelated later action. Avoid a write loop with the file watcher, since unchanged cards are already skipped.
- When enforcement moves any card, show a VS Code notification naming the card, the column it left, and the unfinished dependencies that block it. Also append an Activity entry to the moved card ("Moved back to Ready: blocked by <titles>").
- Consider also adding the board-panel move error that the UI already gives for a blocked drag (`canMoveCardToColumn` in src/utils.ts, message built in src/boardLoop.ts) so the explanation matches.

## Acceptance criteria
- [x] A dependency added to an in-progress card by an external file edit moves the card back to Ready on the reload that picks up the edit, not on the next unrelated mutation.
- [x] Adding, editing or moving an unrelated card never relocates another card unless that action itself blocked it.
- [x] Every enforced relocation shows a notification naming the card, its former column and the blocking dependencies, and appends an Activity entry to the card.
- [x] No write/reload loop: an enforced move on reload results in one write and settles.
- [x] Unit tests in test/unit/boardOperations.test.ts or a store test cover the reload path, the unrelated-mutation case and the notification payload; existing blocked-card tests still pass.

## Activity
### 2026-10-10T15:00:49.516Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-10-10 - Claude Code: completed
- src/utils.ts: added `relocateBlockedCards` (returns the corrected board plus a `BlockedCardRelocation` report per moved card and appends `Moved back to Ready from "<column>": blocked by "<titles>".` to each card's Activity), `describeBlockedCardRelocation`, `describeBlockedMove`, `blockingDependencyTitles`; `enforceBlockedCardPlacement` now delegates.
- src/boardStore.ts: enforces placement right after every `refreshFromDisk` (store load, watcher reload, before each mutation, `ensurePersisted`) and persists it immediately, reported as `reason: 'reload'`; mutation-caused moves report `reason: 'mutation'` via new `onDidRelocateBlockedCards` dep. Unrelated mutations therefore never carry an external edit's relocation. The follow-up watcher reload finds nothing to move and writes nothing.
- src/extension.ts: shows a warning notification per relocation (card, former column, blocking dependencies). src/boardPanel.ts: blocked-drag message now names the blocking dependencies via `describeBlockedMove`.
- Tests: 5 new store tests (reload path, single write + settle, unrelated mutation, mutation-caused, blocked on load) and a boardOperations test for the payload/messages/Activity entry. `npm run compile-tests`, `npm test` (777 pass), `npm run compile`, `npm run lint` all green. Development Host smoke test not run.

STATUS: DONE
