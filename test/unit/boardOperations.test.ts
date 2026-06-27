import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { isBoardState } from '../../src/types';
import { addCard, addColumn, defaultBoard, deleteCard, editCard, moveCard } from '../../src/utils';

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

  test('isBoardState rejects malformed input', () => {
    assert.equal(isBoardState(null), false);
    assert.equal(isBoardState({ version: 1 }), false);
    assert.equal(isBoardState({ version: 999, columns: [] }), false);
  });
});
