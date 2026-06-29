---
id: card-mqx0vgl2-1
title: have a duplicate card button on the card details screen
column: col-mqwk2njn-4
position: 1000
assignee: { kind: human }
createdAt: 1782604802486
updatedAt: 1782733397480
---

## Description
Add a "Duplicate" button to the card details modal so a user can quickly create a
copy of the card they are viewing. Clicking it creates a new card in the same
column as the original, carrying over the editable content (title, description,
acceptance criteria, assignee, and dependencies) so the user has a working starting
point instead of recreating the card by hand.

The duplicate is a brand-new card: it gets its own unique id, is not a reference to
the original, and editing or deleting it never affects the source card. To make the
copy obvious and avoid confusion, the new card's title is suffixed (e.g. "(copy)")
and its activity history starts fresh rather than copying the original's activity.
The action goes through the existing extension-host persistence path so the new card
is written to disk and shows up on the board immediately after creation.

This slice is scoped to the card details screen only; it does not add bulk
duplication, drag-to-copy, or a board-level context menu.

## Acceptance criteria
- [x] The card details modal shows a clearly labelled "Duplicate" button alongside the existing footer actions.
- [x] Clicking "Duplicate" creates a new card in the same column as the original.
- [x] The new card copies the original's title (with a suffix such as "(copy)" to distinguish it), description, and acceptance criteria.
- [x] The new card copies the original's assignee and dependencies.
- [x] The new card receives its own unique id and is independent: editing or deleting the duplicate does not change the original, and vice versa.
- [x] The duplicate's activity history starts fresh rather than copying the original card's activity entries.
- [x] Duplication goes through the extension host so the new card is persisted to `.mwnn/cards/` and survives a board reload.
- [x] The new card appears on the board immediately after duplication without requiring a manual refresh.
- [x] `npm run compile`, `npm run lint`, and `npm test` all pass, with test coverage for duplicating a card (new id, copied fields, same column, independent from the original).

## Activity
### 2026-06-29T00:42:32.203Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.

### 2026-06-29T02:31:02.942Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-06-28 - Implemented by Claude Code
Added a "Duplicate" button to the card details modal footer that creates an
independent copy of the viewed card.

- **Pure op**: `duplicateCard(state, cardId)` in `src/utils.ts` inserts a copy
  immediately after the original in the same column. It gets a fresh id and
  timestamps, a `(copy)`-suffixed title, and carries over description,
  acceptance criteria, assignee, and dependencies. Activity is intentionally not
  copied so history starts fresh.
- **Protocol**: new `duplicateCard` webview→host message in `src/types.ts`
  (type + runtime guard).
- **Store**: `BoardStore.duplicateCard` in `src/boardStore.ts` runs through the
  existing `commit` path, so the copy is written to `.mwnn/cards/` and survives a
  reload.
- **Host**: `src/boardPanel.ts` handles the message, re-posts state, and opens
  the new card's details (identified by diffing card ids before/after).
- **UI**: `media/board.js` adds the "Duplicate" footer button; `media/board.css`
  styles `.card-modal-duplicate` to match the other footer actions.
- **Tests**: added coverage in `boardOperations.test.ts` (new id, copied fields,
  same column, independence, fresh activity, no-op when missing),
  `protocol.test.ts` (message guard accept/reject), and `boardStore.test.ts`
  (persistence + reload). `npm run compile`, `npm run lint`, and `npm test`
  (78 tests) all pass.

### 2026-06-28 - Fix: duplicated card could not be deleted
Follow-up after a user reported being unable to delete a freshly duplicated card.

- **Root cause**: `BoardStore.reload()` ran `refreshFromDisk()` outside the
  `commitQueue`. Every write also rewrites `columns.json`, so the file watcher
  schedules a reload after each operation. Duplicating writes a new card file
  (scheduling a reload); deleting that copy moments later could let the
  watcher's reload interleave with the delete commit, re-read the pre-delete
  disk, and clobber `state` — resurrecting the card so it appeared undeletable.
- **Fix**: `src/boardStore.ts` now routes `reload()` through the same
  `commitQueue` as mutations, so a reload never interleaves with an in-flight
  commit's apply/write.
- **Test**: added a `boardStore.test.ts` regression that holds a delete commit
  open mid-write while a reload runs; it fails against the old code (card
  resurrected) and passes with the queued reload. Full suite is 79 tests, all
  green, with `npm run compile` and `npm run lint` clean.
