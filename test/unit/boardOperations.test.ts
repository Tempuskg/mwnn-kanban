import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { isAssignee, isBoardState } from '../../src/types';
import {
  addCard,
  addColumn,
  appendActivity,
  blockingDependencies,
  canMoveCardToColumn,
  calculateCardPosition,
  defaultBoard,
  deleteCard,
  duplicateCard,
  editCard,
  enforceBlockedCardPlacement,
  isCardBlocked,
  moveCard,
  readyState,
  removeColumn,
  renameColumn,
  reorderColumns,
  setAssignee,
  setAcceptanceCriteria,
  setColumnConfig,
  setDependencies,
  setDescription,
  wipState,
} from '../../src/utils';

suite('board operations', () => {
  test('defaultBoard uses provided column titles', () => {
    const board = defaultBoard(['Backlog', 'Doing']);
    assert.deepEqual(
      board.columns.map((c) => c.title),
      ['Backlog', 'Doing'],
    );
    assert.ok(isBoardState(board));
  });

  test('defaultBoard falls back when given no titles', () => {
    const board = defaultBoard([]);
    assert.equal(board.columns.length, 4);
  });

  test('defaultBoard trims titles and falls back when they are all blank', () => {
    const board = defaultBoard(['  Backlog  ', '   ']);
    assert.deepEqual(
      board.columns.map((c) => c.title),
      ['Backlog'],
    );

    const fallbackBoard = defaultBoard(['   ', '\t']);
    assert.deepEqual(
      fallbackBoard.columns.map((c) => c.title),
      ['Backlog', 'Ready', 'In Progress', 'Done'],
    );
  });

  test('addCard appends to the target column without mutating the input', () => {
    const board = defaultBoard(['To Do']);
    const columnId = board.columns[0]!.id;
    const next = addCard(board, columnId, 'First task');
    assert.equal(board.columns[0]!.cards.length, 0, 'original board is unchanged');
    assert.equal(next.columns[0]!.cards.length, 1);
    assert.equal(next.columns[0]!.cards[0]!.title, 'First task');
  });

  test('addCard ignores blank titles', () => {
    const board = defaultBoard(['To Do']);
    const columnId = board.columns[0]!.id;
    const next = addCard(board, columnId, '   ');
    assert.equal(next.columns[0]!.cards.length, 0);
  });

  test('addColumn appends a new empty column', () => {
    const board = defaultBoard(['To Do']);
    const next = addColumn(board, 'Done');
    assert.equal(next.columns.length, 2);
    assert.equal(next.columns[1]!.title, 'Done');
    assert.deepEqual(next.columns[1]!.cards, []);
  });

  test('addColumn trims titles and ignores blank values', () => {
    const board = defaultBoard(['To Do']);
    const trimmed = addColumn(board, '  Done  ');
    assert.equal(trimmed.columns[1]!.title, 'Done');
    assert.equal(trimmed.columns[1]!.role, 'custom');

    const unchanged = addColumn(board, '   ');
    assert.equal(unchanged.columns.length, 1);
  });

  test('editCard updates the matching card title', () => {
    let board = defaultBoard(['To Do']);
    board = addCard(board, board.columns[0]!.id, 'Old');
    const cardId = board.columns[0]!.cards[0]!.id;
    const next = editCard(board, cardId, 'New');
    assert.equal(next.columns[0]!.cards[0]!.title, 'New');
  });

  test('editCard ignores blank replacement titles', () => {
    let board = defaultBoard(['To Do']);
    board = addCard(board, board.columns[0]!.id, 'Old');
    const cardId = board.columns[0]!.cards[0]!.id;
    const next = editCard(board, cardId, '   ');
    assert.equal(next.columns[0]!.cards[0]!.title, 'Old');
  });

  test('duplicateCard copies editable content into a new card in the same column', () => {
    let board = defaultBoard(['To Do', 'Done']);
    const columnId = board.columns[0]!.id;
    board = addCard(board, columnId, 'Original');
    // Add a dependency target so the copied dependsOn references a real card.
    board = addCard(board, board.columns[1]!.id, 'Dependency');
    const depId = board.columns[1]!.cards[0]!.id;
    const cardId = board.columns[0]!.cards[0]!.id;
    board = setDescription(board, cardId, 'A description');
    board = setAcceptanceCriteria(board, cardId, '- [ ] Done when shipped');
    board = setAssignee(board, cardId, { kind: 'ai', name: 'Copilot' });
    board = setDependencies(board, cardId, [depId]);
    board = appendActivity(board, cardId, 'Some prior activity');

    const next = duplicateCard(board, cardId);

    // Same column, inserted right after the original.
    const column = next.columns[0]!;
    assert.equal(column.cards.length, 2);
    const original = column.cards[0]!;
    const copy = column.cards[1]!;
    assert.equal(original.id, cardId);

    // New unique id.
    assert.notEqual(copy.id, original.id);

    // Copied fields with a distinguishing title suffix.
    assert.equal(copy.title, 'Original (copy)');
    assert.equal(copy.description, 'A description');
    assert.equal(copy.acceptanceCriteria, '- [ ] Done when shipped');
    assert.deepEqual(copy.assignee, { kind: 'ai', name: 'Copilot' });
    assert.deepEqual(copy.dependsOn, [depId]);

    // Fresh activity history, not the original's.
    assert.equal(copy.activity, undefined);
    assert.equal(original.activity, 'Some prior activity');
  });

  test('duplicateCard produces an independent card that does not affect the original', () => {
    let board = defaultBoard(['To Do']);
    board = addCard(board, board.columns[0]!.id, 'Original');
    const cardId = board.columns[0]!.cards[0]!.id;
    board = setDependencies(board, cardId, []);

    let next = duplicateCard(board, cardId);
    const copyId = next.columns[0]!.cards[1]!.id;

    // Editing the copy leaves the original untouched.
    next = editCard(next, copyId, 'Renamed copy');
    assert.equal(next.columns[0]!.cards[0]!.title, 'Original');
    assert.equal(next.columns[0]!.cards[1]!.title, 'Renamed copy');

    // Deleting the copy leaves the original in place.
    next = deleteCard(next, copyId);
    assert.equal(next.columns[0]!.cards.length, 1);
    assert.equal(next.columns[0]!.cards[0]!.id, cardId);
  });

  test('duplicateCard is a no-op when the card is not found', () => {
    let board = defaultBoard(['To Do']);
    board = addCard(board, board.columns[0]!.id, 'Original');
    const next = duplicateCard(board, 'card-does-not-exist');
    assert.equal(next.columns[0]!.cards.length, 1);
  });

  test('deleteCard removes the matching card', () => {
    let board = defaultBoard(['To Do']);
    board = addCard(board, board.columns[0]!.id, 'Doomed');
    const cardId = board.columns[0]!.cards[0]!.id;
    const next = deleteCard(board, cardId);
    assert.equal(next.columns[0]!.cards.length, 0);
  });

  test('setDependencies stores ids, drops self-references, dedupes, and ignores unknown cards', () => {
    let board = defaultBoard(['To Do', 'Done']);
    board = addCard(board, board.columns[0]!.id, 'A');
    board = addCard(board, board.columns[0]!.id, 'B');
    board = addCard(board, board.columns[1]!.id, 'C');
    const a = board.columns[0]!.cards[0]!.id;
    const b = board.columns[0]!.cards[1]!.id;
    const c = board.columns[1]!.cards[0]!.id;

    const next = setDependencies(board, a, [b, c, b, a, 'card-missing']);
    assert.deepEqual(next.columns[0]!.cards[0]!.dependsOn, [b, c]);
  });

  test('setDependencies with an empty list clears the field', () => {
    let board = defaultBoard(['To Do']);
    board = addCard(board, board.columns[0]!.id, 'A');
    board = addCard(board, board.columns[0]!.id, 'B');
    const a = board.columns[0]!.cards[0]!.id;
    const b = board.columns[0]!.cards[1]!.id;

    let next = setDependencies(board, a, [b]);
    assert.deepEqual(next.columns[0]!.cards[0]!.dependsOn, [b]);

    next = setDependencies(next, a, []);
    assert.equal(next.columns[0]!.cards[0]!.dependsOn, undefined);
  });

  test('deleteCard removes the deleted card from other cards dependency lists', () => {
    let board = defaultBoard(['To Do']);
    board = addCard(board, board.columns[0]!.id, 'A');
    board = addCard(board, board.columns[0]!.id, 'B');
    const a = board.columns[0]!.cards[0]!.id;
    const b = board.columns[0]!.cards[1]!.id;

    board = setDependencies(board, a, [b]);
    const next = deleteCard(board, b);
    assert.equal(next.columns[0]!.cards.length, 1);
    assert.equal(next.columns[0]!.cards[0]!.id, a);
    assert.equal(next.columns[0]!.cards[0]!.dependsOn, undefined);
  });

  test('isCardBlocked reflects whether dependencies sit in a done column', () => {
    let board = defaultBoard(['Backlog', 'Done']);
    board = setColumnConfig(board, board.columns[1]!.id, { role: 'done' });
    board = addCard(board, board.columns[0]!.id, 'Blocked');
    board = addCard(board, board.columns[0]!.id, 'Upstream pending');
    const blocked = board.columns[0]!.cards[0]!.id;
    const pending = board.columns[0]!.cards[1]!.id;

    board = setDependencies(board, blocked, [pending]);
    assert.equal(isCardBlocked(board, blocked), true);
    assert.deepEqual(blockingDependencies(board, blocked), [pending]);

    // Move the dependency into the Done column; the card is no longer blocked.
    board = moveCard(board, pending, board.columns[1]!.id, 0);
    assert.equal(isCardBlocked(board, blocked), false);
    assert.deepEqual(blockingDependencies(board, blocked), []);
  });

  test('isCardBlocked is false for a card without dependencies', () => {
    let board = defaultBoard(['Backlog']);
    board = addCard(board, board.columns[0]!.id, 'Solo');
    assert.equal(isCardBlocked(board, board.columns[0]!.cards[0]!.id), false);
  });

  test('canMoveCardToColumn stops a blocked card from advancing past Ready', () => {
    let board = defaultBoard(['Backlog', 'Ready', 'In Progress', 'Done']);
    const [backlog, ready, inProgress, done] = board.columns.map((column) => column.id) as [
      string,
      string,
      string,
      string,
    ];
    board = addCard(board, backlog, 'Blocked');
    board = addCard(board, backlog, 'Upstream');
    const blocked = board.columns[0]!.cards[0]!.id;
    const upstream = board.columns[0]!.cards[1]!.id;
    board = setDependencies(board, blocked, [upstream]);

    // Blocked: may sit in Backlog/Ready or reorder, but not move into work columns.
    assert.equal(canMoveCardToColumn(board, blocked, backlog), true);
    assert.equal(canMoveCardToColumn(board, blocked, ready), true);
    assert.equal(canMoveCardToColumn(board, blocked, inProgress), false);
    assert.equal(canMoveCardToColumn(board, blocked, done), false);

    // Once the dependency is Done, the card can advance freely.
    board = moveCard(board, upstream, done, 0);
    assert.equal(canMoveCardToColumn(board, blocked, inProgress), true);
  });

  test('canMoveCardToColumn always allows unblocked cards anywhere', () => {
    let board = defaultBoard(['Backlog', 'Ready', 'In Progress', 'Done']);
    board = addCard(board, board.columns[0]!.id, 'Free');
    const free = board.columns[0]!.cards[0]!.id;
    assert.equal(canMoveCardToColumn(board, free, board.columns[2]!.id), true);
  });

  test('enforceBlockedCardPlacement pulls a newly blocked work card back to Ready', () => {
    let board = defaultBoard(['Backlog', 'Ready', 'In Progress', 'Done']);
    const readyId = board.columns[1]!.id;
    const inProgressId = board.columns[2]!.id;
    board = addCard(board, inProgressId, 'Started early');
    board = addCard(board, board.columns[0]!.id, 'Upstream');
    const started = board.columns[2]!.cards[0]!.id;
    const upstream = board.columns[0]!.cards[0]!.id;

    // Adding a dependency leaves the card stranded in In Progress until enforced.
    board = setDependencies(board, started, [upstream]);
    const enforced = enforceBlockedCardPlacement(board);

    assert.equal(enforced.columns[2]!.cards.length, 0, 'card no longer sits in In Progress');
    assert.equal(enforced.columns[1]!.id, readyId);
    assert.equal(enforced.columns[1]!.cards.some((card) => card.id === started), true, 'card is now in Ready');
  });

  test('enforceBlockedCardPlacement leaves unblocked and Ready/Backlog cards in place', () => {
    let board = defaultBoard(['Backlog', 'Ready', 'In Progress', 'Done']);
    board = addCard(board, board.columns[2]!.id, 'Unblocked work');
    const before = JSON.stringify(board);
    assert.equal(JSON.stringify(enforceBlockedCardPlacement(board)), before);
  });

  test('readyState ignores blocked cards when counting toward the reverse-WIP minimum', () => {
    let board = defaultBoard(['Backlog', 'Ready', 'Done']);
    board = setColumnConfig(board, board.columns[1]!.id, { reverseWip: 2 });
    board = addCard(board, board.columns[1]!.id, 'Ready and defined');
    board = addCard(board, board.columns[1]!.id, 'Blocked but defined');
    board = addCard(board, board.columns[0]!.id, 'Upstream');
    const open = board.columns[1]!.cards[0]!.id;
    const blocked = board.columns[1]!.cards[1]!.id;
    const upstream = board.columns[0]!.cards[0]!.id;

    board = setDescription(board, open, 'Defined slice.');
    board = setDescription(board, blocked, 'Defined slice.');
    board = setDependencies(board, blocked, [upstream]);

    // Only the unblocked, defined card counts toward the minimum.
    assert.deepEqual(readyState(board, board.columns[1]!), { defined: 1, min: 2, under: true });
  });

  test('moveCard relocates a card to another column at an index', () => {
    let board = defaultBoard(['To Do', 'Done']);
    board = addCard(board, board.columns[0]!.id, 'A');
    board = addCard(board, board.columns[0]!.id, 'B');
    const cardId = board.columns[0]!.cards[0]!.id;
    const doneId = board.columns[1]!.id;
    const next = moveCard(board, cardId, doneId, 0);
    assert.equal(next.columns[0]!.cards.length, 1);
    assert.equal(next.columns[1]!.cards.length, 1);
    assert.equal(next.columns[1]!.cards[0]!.title, 'A');
  });

  test('moveCard clamps an out-of-range index', () => {
    let board = defaultBoard(['To Do', 'Done']);
    board = addCard(board, board.columns[0]!.id, 'A');
    const cardId = board.columns[0]!.cards[0]!.id;
    const doneId = board.columns[1]!.id;
    const next = moveCard(board, cardId, doneId, 99);
    assert.equal(next.columns[1]!.cards.length, 1);
  });

  test('moveCard keeps the card in place when the destination column is missing', () => {
    let board = defaultBoard(['To Do', 'Done']);
    board = addCard(board, board.columns[0]!.id, 'A');
    const cardId = board.columns[0]!.cards[0]!.id;
    const next = moveCard(board, cardId, 'missing-column', 0);
    assert.equal(next.columns[0]!.cards.length, 1);
    assert.equal(next.columns[0]!.cards[0]!.title, 'A');
    assert.equal(next.columns[1]!.cards.length, 0);
  });

  test('setAssignee stores a normalized assignee and can clear it again', () => {
    let board = defaultBoard(['To Do']);
    board = addCard(board, board.columns[0]!.id, 'Assigned');
    const cardId = board.columns[0]!.cards[0]!.id;

    const assigned = setAssignee(board, cardId, { kind: 'ai', name: '  Claude  ' });
    assert.deepEqual(assigned.columns[0]!.cards[0]!.assignee, { kind: 'ai', name: 'Claude' });
    assert.equal(isAssignee(assigned.columns[0]!.cards[0]!.assignee), true);

    const cleared = setAssignee(assigned, cardId, undefined);
    assert.equal(cleared.columns[0]!.cards[0]!.assignee, undefined);
  });

  test('setDescription trims text and drives ready-state counts', () => {
    let board = defaultBoard(['Ready']);
    board = addCard(board, board.columns[0]!.id, 'Defined');
    board = addCard(board, board.columns[0]!.id, 'Undefined');
    const firstCardId = board.columns[0]!.cards[0]!.id;
    const readyColumnId = board.columns[0]!.id;

    board = setDescription(board, firstCardId, '  A clearly defined slice.  ');
    board = setColumnConfig(board, readyColumnId, { role: 'ready', reverseWip: 2 });

    assert.equal(board.columns[0]!.cards[0]!.description, 'A clearly defined slice.');
    assert.deepEqual(readyState(board, board.columns[0]!), { defined: 1, min: 2, under: true });
  });

  test('appendActivity trims entries and preserves older history', () => {
    let board = defaultBoard(['Ready']);
    board = addCard(board, board.columns[0]!.id, 'Documented');
    const cardId = board.columns[0]!.cards[0]!.id;

    board = appendActivity(board, cardId, '  First note  ');
    board = appendActivity(board, cardId, '\nSecond note\n');

    assert.equal(board.columns[0]!.cards[0]!.activity, 'First note\n\nSecond note');
  });

  test('setAcceptanceCriteria trims text and clears blank values', () => {
    let board = defaultBoard(['Ready']);
    board = addCard(board, board.columns[0]!.id, 'Defined');
    const cardId = board.columns[0]!.cards[0]!.id;

    board = setAcceptanceCriteria(board, cardId, '  - [ ] Ship it  ');
    assert.equal(board.columns[0]!.cards[0]!.acceptanceCriteria, '- [ ] Ship it');

    board = setAcceptanceCriteria(board, cardId, '   ');
    assert.equal(board.columns[0]!.cards[0]!.acceptanceCriteria, undefined);
  });

  test('setColumnConfig updates title, role, and limit metadata', () => {
    const board = defaultBoard(['Backlog']);
    const columnId = board.columns[0]!.id;
    const next = setColumnConfig(board, columnId, {
      title: '  Ready  ',
      role: 'ready',
      wipLimit: 3,
      reverseWip: 2,
    });

    assert.equal(next.columns[0]!.title, 'Ready');
    assert.equal(next.columns[0]!.role, 'ready');
    assert.equal(next.columns[0]!.wipLimit, 3);
    assert.equal(next.columns[0]!.reverseWip, 2);
    assert.deepEqual(wipState(next.columns[0]!), { count: 0, limit: 3, over: false });
  });

  test('renameColumn reuses column-config normalization', () => {
    const board = defaultBoard(['Backlog']);
    const next = renameColumn(board, board.columns[0]!.id, '  Ready for Work  ');
    assert.equal(next.columns[0]!.title, 'Ready for Work');
  });

  test('removeColumn moves cards into a target column when supplied', () => {
    let board = defaultBoard(['Backlog', 'Done']);
    const backlogId = board.columns[0]!.id;
    const doneId = board.columns[1]!.id;
    board = addCard(board, backlogId, 'A');

    const next = removeColumn(board, backlogId, doneId);
    assert.equal(next.columns.length, 1);
    assert.equal(next.columns[0]!.id, doneId);
    assert.equal(next.columns[0]!.cards[0]!.title, 'A');
  });

  test('removeColumn keeps a populated column when no target is supplied', () => {
    let board = defaultBoard(['Backlog', 'Done']);
    const backlogId = board.columns[0]!.id;
    board = addCard(board, backlogId, 'A');

    const next = removeColumn(board, backlogId);
    assert.equal(next.columns.length, 2);
  });

  test('reorderColumns moves the requested column to the target index', () => {
    const board = defaultBoard(['Backlog', 'Ready', 'Done']);
    const readyId = board.columns[1]!.id;
    const next = reorderColumns(board, readyId, 0);
    assert.deepEqual(
      next.columns.map((column) => column.title),
      ['Ready', 'Backlog', 'Done'],
    );
  });

  test('calculateCardPosition uses a midpoint or the next open slot', () => {
    assert.equal(calculateCardPosition({}), 1000);
    assert.equal(calculateCardPosition({ previous: 1000 }), 2000);
    assert.equal(calculateCardPosition({ next: 1000 }), 0);
    assert.equal(calculateCardPosition({ previous: 1000, next: 2000 }), 1500);
  });

  test('isBoardState rejects malformed input', () => {
    assert.equal(isBoardState(null), false);
    assert.equal(isBoardState({ version: 2 }), false);
    assert.equal(isBoardState({ version: 999, columns: [] }), false);
    assert.equal(
      isBoardState({
        version: 2,
        columns: [{ id: 'col-1', title: 'Ready', cards: [], role: 'ready', wipLimit: 3, reverseWip: 2 }],
      }),
      true,
    );
    assert.equal(
      isBoardState({
        version: 2,
        columns: [{ id: 'col-1', title: 'Ready', cards: [], role: 'mystery' }],
      }),
      false,
    );
  });
});
