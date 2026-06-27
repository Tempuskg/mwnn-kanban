import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { isAssignee, isBoardState } from '../../src/types';
import {
  addCard,
  addColumn,
  calculateCardPosition,
  defaultBoard,
  deleteCard,
  editCard,
  moveCard,
  readyState,
  removeColumn,
  renameColumn,
  reorderColumns,
  setAssignee,
  setColumnConfig,
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
    assert.equal(board.columns.length, 3);
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
      ['To Do', 'In Progress', 'Done'],
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

  test('deleteCard removes the matching card', () => {
    let board = defaultBoard(['To Do']);
    board = addCard(board, board.columns[0]!.id, 'Doomed');
    const cardId = board.columns[0]!.cards[0]!.id;
    const next = deleteCard(board, cardId);
    assert.equal(next.columns[0]!.cards.length, 0);
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
    assert.deepEqual(readyState(board.columns[0]!), { defined: 1, min: 2, under: true });
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
    assert.equal(isBoardState({ version: 1 }), false);
    assert.equal(isBoardState({ version: 999, columns: [] }), false);
    assert.equal(
      isBoardState({
        version: 1,
        columns: [{ id: 'col-1', title: 'Ready', cards: [], role: 'ready', wipLimit: 3, reverseWip: 2 }],
      }),
      true,
    );
    assert.equal(
      isBoardState({
        version: 1,
        columns: [{ id: 'col-1', title: 'Ready', cards: [], role: 'mystery' }],
      }),
      false,
    );
  });
});
