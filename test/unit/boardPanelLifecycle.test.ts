import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { BoardPanelLifecycle } from '../../src/boardPanelLifecycle';

interface FakePanel {
  readonly id: string;
  reveals: number;
}

function createHarness(): {
  readonly lifecycle: BoardPanelLifecycle<FakePanel>;
  readonly createPanel: () => FakePanel;
  readonly created: FakePanel[];
} {
  const created: FakePanel[] = [];
  return {
    lifecycle: new BoardPanelLifecycle((panel) => {
      panel.reveals += 1;
    }),
    createPanel: () => {
      const panel = { id: `panel-${created.length + 1}`, reveals: 0 };
      created.push(panel);
      return panel;
    },
    created,
  };
}

suite('board panel lifecycle', () => {
  test('creates once and reveals the same panel on every repeated open', () => {
    const { lifecycle, createPanel, created } = createHarness();

    const first = lifecycle.show(createPanel);
    const second = lifecycle.show(createPanel);
    const third = lifecycle.show(createPanel);

    assert.equal(created.length, 1);
    assert.equal(second, first);
    assert.equal(third, first);
    assert.equal(first.reveals, 2);
    assert.equal(lifecycle.current, first);
  });

  test('creates one fresh functional panel after the live panel closes', () => {
    const { lifecycle, createPanel, created } = createHarness();
    const first = lifecycle.show(createPanel);

    assert.equal(lifecycle.close(first), true);
    assert.equal(lifecycle.current, undefined);

    const second = lifecycle.show(createPanel);
    assert.notEqual(second, first);
    assert.equal(created.length, 2);
    assert.equal(lifecycle.show(createPanel), second);
    assert.equal(second.reveals, 1);
  });

  test('a stale close cannot clear a newer live panel', () => {
    const { lifecycle, createPanel } = createHarness();
    const first = lifecycle.show(createPanel);
    lifecycle.close(first);
    const second = lifecycle.show(createPanel);

    assert.equal(lifecycle.close(first), false);
    assert.equal(lifecycle.current, second);
  });

  test('adopts one restored panel and disposes later restored duplicates', () => {
    const { lifecycle, createPanel, created } = createHarness();
    let duplicateDisposals = 0;

    const restored = lifecycle.restore(createPanel, () => {
      throw new Error('The first restored panel must not be discarded.');
    });
    const resolved = lifecycle.restore(createPanel, () => {
      duplicateDisposals += 1;
    });

    assert.equal(created.length, 1);
    assert.equal(resolved, restored);
    assert.equal(restored.reveals, 1);
    assert.equal(duplicateDisposals, 1);
    assert.equal(lifecycle.current, restored);
  });

  test('restoration cannot replace a panel created by an earlier open request', () => {
    const { lifecycle, createPanel, created } = createHarness();
    const opened = lifecycle.show(createPanel);
    let duplicateDisposals = 0;

    const resolved = lifecycle.restore(createPanel, () => {
      duplicateDisposals += 1;
    });

    assert.equal(created.length, 1);
    assert.equal(resolved, opened);
    assert.equal(opened.reveals, 1);
    assert.equal(duplicateDisposals, 1);
  });
});
