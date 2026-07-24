import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { resolveBoardPanelPlacement } from '../../src/boardPanelPlacement';

suite('board panel placement', () => {
  test('creates in the active tab group when no board panel exists', () => {
    assert.deepEqual(resolveBoardPanelPlacement(false, 'group-two'), {
      kind: 'create',
      column: 'group-two',
    });
  });

  test('reveals the existing panel without selecting another group', () => {
    assert.deepEqual(resolveBoardPanelPlacement(true, 'group-two'), { kind: 'reveal' });
  });

  test('uses the active group even when there is no active text editor', () => {
    const activeGroupColumn = 3;
    const placement = resolveBoardPanelPlacement(false, activeGroupColumn);

    assert.equal(placement.kind, 'create');
    if (placement.kind === 'create') {
      assert.equal(placement.column, activeGroupColumn);
    }
  });
});
