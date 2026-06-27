import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { createBoardStore, type MementoLike } from '../../src/boardStore';

function fakeMemento(initial: Record<string, unknown> = {}): MementoLike {
  const data = new Map<string, unknown>(Object.entries(initial));
  return {
    get<T>(key: string): T | undefined {
      return data.get(key) as T | undefined;
    },
    update(key: string, value: unknown): void {
      data.set(key, value);
    },
  };
}

suite('board store', () => {
  test('initializes from default columns when storage is empty', () => {
    const store = createBoardStore({ memento: fakeMemento(), defaultColumns: ['A', 'B'] });
    assert.deepEqual(
      store.getState().columns.map((c) => c.title),
      ['A', 'B'],
    );
  });

  test('persists added cards back to the memento', async () => {
    const memento = fakeMemento();
    const store = createBoardStore({ memento, defaultColumns: ['To Do'] });
    const columnId = store.getState().columns[0]!.id;
    await store.addCard(columnId, 'Task');

    const reloaded = createBoardStore({ memento, defaultColumns: ['To Do'] });
    assert.equal(reloaded.getState().columns[0]!.cards[0]!.title, 'Task');
  });

  test('getState returns a copy that cannot mutate stored state', () => {
    const store = createBoardStore({ memento: fakeMemento(), defaultColumns: ['To Do'] });
    const snapshot = store.getState();
    snapshot.columns[0]!.title = 'Hacked';
    assert.equal(store.getState().columns[0]!.title, 'To Do');
  });

  test('reset restores the default board', async () => {
    const store = createBoardStore({ memento: fakeMemento(), defaultColumns: ['To Do'] });
    await store.addCard(store.getState().columns[0]!.id, 'Task');
    await store.reset();
    assert.equal(store.getState().columns[0]!.cards.length, 0);
  });
});
