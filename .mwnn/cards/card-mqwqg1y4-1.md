---
id: card-mqwqg1y4-1
title: Have the option to have a card dependent on 1 or more cards
column: col-mqwk2njn-4
position: 13000
assignee: { kind: human }
createdAt: 1782587287516
updatedAt: 1782686072393
---

## Description
Allow a card to declare a dependency on one or more other cards on the board, so
that the work it represents is understood to be blocked until those cards are
complete. A user editing a card can add and remove dependencies by selecting from
the other cards on the board, the relationship is persisted with the card, and the
board surfaces when a card is blocked by unfinished dependencies.

This slice covers the data model, persistence, edit UI, and a visible blocked
indicator. It does not need to prevent a blocked card from being moved (enforcement
can be a later card), only to make the dependency relationship visible and durable.

## Acceptance criteria
- [ ] A card can store references to zero, one, or many other cards it depends on (by card id).
- [ ] The dependency list is persisted to the card's markdown frontmatter and survives a reload of the board.
- [ ] From a card's detail/edit view, a user can add a dependency by choosing from the other cards on the board.
- [ ] A user can remove an existing dependency from a card.
- [ ] A card cannot depend on itself, and the picker does not offer the card itself as an option.
- [ ] Selecting an existing dependency does not create a duplicate entry for the same card.
- [ ] A card with one or more dependencies that are not yet in a "done" column shows a visible "blocked" indicator on the board.
- [ ] When all of a card's dependencies are complete (in a done column), the blocked indicator is no longer shown.
- [ ] Deleting a card removes it from the dependency lists of any cards that referenced it (no dangling references).
- [ ] The shared types and webview ⇄ host message protocol are updated to carry dependency data, and `npm run compile`, `npm run lint`, and `npm test` all pass.

## Activity
### 2026-06-28T21:13:01.192Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-06-28 - Implemented card dependencies (Claude Code)
Added a `dependsOn: string[]` field to the `Card` model and threaded it through the
full stack:
- **Types/protocol** (`src/types.ts`): new `setDependencies` webview→host message,
  `Card.dependsOn`, and updated runtime guards.
- **Persistence** (`src/serialization.ts`): `dependsOn` is written to/read from card
  frontmatter as `dependsOn: [id, ...]`; empty lists are omitted. Round-trips tested.
- **Operations** (`src/utils.ts`): `setDependencies` (drops self-references, dedupes,
  ignores unknown ids), `deleteCard` now strips the deleted id from every other card's
  list (no dangling refs), and new `blockingDependencies`/`isCardBlocked` helpers treat
  a dependency as complete once it sits in a `done`-role column.
- **Store/panel** (`src/boardStore.ts`, `src/boardPanel.ts`): `setDependencies` wired in.
- **Webview** (`media/board.js`, `media/board.css`): card detail view has a dependency
  editor (pick from other cards, remove chips; self and existing picks are never offered),
  and the board shows a red "Blocked" chip while any dependency is not yet Done.
- **Tests**: added coverage in protocol, serialization, and board-operations suites.

`npm run compile`, `npm run lint`, and `npm test` (69 passing) all green.
