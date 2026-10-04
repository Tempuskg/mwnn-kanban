import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { autoStartAiCardFromReady, type ReadyAutoStartStore } from '../../src/boardLoop';
import {
  addCard,
  appendActivity,
  cloneBoard,
  defaultBoard,
  moveCard,
  setAssignee,
  setColumnConfig,
  setDependencies,
  setDescription,
} from '../../src/utils';
import type { Assignee, BoardState, Card } from '../../src/types';

const COLUMNS = ['Backlog', 'Ready', 'In Progress', 'Verify', 'Done'] as const;
const BACKLOG = 0;
const READY = 1;
const IN_PROGRESS = 2;
const NOW = new Date('2026-10-04T12:00:00.000Z');

function fakeStore(initial: BoardState): { store: ReadyAutoStartStore; state(): BoardState; moves: number } {
  let state = cloneBoard(initial);
  const harness = {
    moves: 0,
    state: () => state,
    store: {
      reload: async () => cloneBoard(state),
      moveCard: async (cardId: string, toColumnId: string, toIndex: number) => {
        harness.moves += 1;
        state = moveCard(state, cardId, toColumnId, toIndex);
      },
      appendActivity: async (cardId: string, entry: string) => {
        state = appendActivity(state, cardId, entry);
      },
    },
  };
  return harness;
}

function withCard(
  state: BoardState,
  columnIndex: number,
  title: string,
  assignee?: Assignee,
): { state: BoardState; cardId: string } {
  const column = state.columns[columnIndex]!;
  let next = addCard(state, column.id, title);
  const cardId = next.columns[columnIndex]!.cards.at(-1)!.id;
  next = setDescription(next, cardId, `${title} description`);
  if (assignee) {
    next = setAssignee(next, cardId, assignee);
  }
  return { state: next, cardId };
}

function locate(state: BoardState, cardId: string): { columnTitle: string; card: Card; index: number } {
  for (const column of state.columns) {
    const index = column.cards.findIndex((card) => card.id === cardId);
    if (index !== -1) {
      return { columnTitle: column.title, card: column.cards[index]!, index };
    }
  }
  throw new Error(`Card ${cardId} not found`);
}

suite('Ready auto-start for AI-assigned cards', () => {
  test('moves an AI-assigned Ready card to the end of In Progress and logs it', async () => {
    let { state } = withCard(defaultBoard([...COLUMNS]), IN_PROGRESS, 'Already running');
    ({ state } = withCard(state, IN_PROGRESS, 'Also running'));
    const added = withCard(state, READY, 'Hand to AI', { kind: 'ai' });
    const board = fakeStore(added.state);

    const result = await autoStartAiCardFromReady(board.store, added.cardId, NOW);

    assert.deepEqual(result, { kind: 'moved', columnTitle: 'In Progress' });
    const placed = locate(board.state(), added.cardId);
    assert.equal(placed.columnTitle, 'In Progress');
    assert.equal(placed.index, 2, 'appended after the existing In Progress cards');
    assert.deepEqual(placed.card.assignee, { kind: 'ai' });
    assert.match(placed.card.activity ?? '', /2026-10-04T12:00:00.000Z - Auto-started in In Progress/);
  });

  test('keeps the card in Ready with a logged reason when In Progress is at its WIP limit', async () => {
    let { state } = withCard(defaultBoard([...COLUMNS]), IN_PROGRESS, 'Running');
    state = setColumnConfig(state, state.columns[IN_PROGRESS]!.id, { wipLimit: 1 });
    const added = withCard(state, READY, 'Hand to AI', { kind: 'ai' });
    const board = fakeStore(added.state);

    const result = await autoStartAiCardFromReady(board.store, added.cardId, NOW);

    assert.equal(result.kind, 'refused');
    assert.equal(board.moves, 0);
    const placed = locate(board.state(), added.cardId);
    assert.equal(placed.columnTitle, 'Ready');
    assert.deepEqual(placed.card.assignee, { kind: 'ai' });
    assert.match(placed.card.activity ?? '', /Auto-start held in Ready/);
    assert.match(placed.card.activity ?? '', /WIP limit of 1/);
  });

  test('keeps a card with unfinished dependencies in Ready', async () => {
    const prerequisite = withCard(defaultBoard([...COLUMNS]), BACKLOG, 'Prerequisite', { kind: 'human' });
    const added = withCard(prerequisite.state, READY, 'Hand to AI', { kind: 'ai' });
    const state = setDependencies(added.state, added.cardId, [prerequisite.cardId]);
    const board = fakeStore(state);

    const result = await autoStartAiCardFromReady(board.store, added.cardId, NOW);

    assert.equal(result.kind, 'refused');
    assert.equal(locate(board.state(), added.cardId).columnTitle, 'Ready');
    assert.match(locate(board.state(), added.cardId).card.activity ?? '', /unfinished dependencies/);
  });

  test('keeps the card in Ready when Ready reverse-WIP admission refuses the start', async () => {
    let state = defaultBoard([...COLUMNS]);
    state = setColumnConfig(state, state.columns[READY]!.id, { reverseWip: 3 });
    ({ state } = withCard(state, BACKLOG, 'Still to define'));
    const added = withCard(state, READY, 'Hand to AI', { kind: 'ai' });
    const board = fakeStore(added.state);

    const result = await autoStartAiCardFromReady(board.store, added.cardId, NOW);

    assert.equal(result.kind, 'refused');
    assert.equal(locate(board.state(), added.cardId).columnTitle, 'Ready');
    assert.match(locate(board.state(), added.cardId).card.activity ?? '', /reverse WIP/);
  });

  for (const columnIndex of [0, 2, 3, 4]) {
    test(`leaves an AI card in the ${COLUMNS[columnIndex]} column alone`, async () => {
      const added = withCard(defaultBoard([...COLUMNS]), columnIndex, 'Not in Ready', { kind: 'ai' });
      const board = fakeStore(added.state);

      const result = await autoStartAiCardFromReady(board.store, added.cardId, NOW);

      assert.deepEqual(result, { kind: 'not-applicable' });
      assert.equal(board.moves, 0);
      assert.equal(locate(board.state(), added.cardId).card.activity, undefined);
    });
  }

  test('leaves a custom-column AI card alone', async () => {
    const added = withCard(defaultBoard(['Backlog', 'Ready', 'Design', 'In Progress', 'Done']), 2, 'Custom', { kind: 'ai' });
    assert.equal(added.state.columns[2]!.role, 'custom');
    const board = fakeStore(added.state);

    assert.deepEqual(await autoStartAiCardFromReady(board.store, added.cardId, NOW), { kind: 'not-applicable' });
    assert.equal(locate(board.state(), added.cardId).columnTitle, 'Design');
  });

  for (const assignee of [{ kind: 'human' } as const, undefined]) {
    test(`does not move a Ready card assigned to ${assignee?.kind ?? 'nobody'}`, async () => {
      const added = withCard(defaultBoard([...COLUMNS]), READY, 'Not for AI', assignee);
      const board = fakeStore(added.state);

      assert.deepEqual(await autoStartAiCardFromReady(board.store, added.cardId, NOW), { kind: 'not-applicable' });
      assert.equal(locate(board.state(), added.cardId).columnTitle, 'Ready');
      assert.equal(board.moves, 0);
    });
  }
});
