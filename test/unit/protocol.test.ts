import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { isWebviewToHostMessage } from '../../src/types';

suite('webview protocol', () => {
  test('accepts valid messages for each supported message type', () => {
    assert.equal(isWebviewToHostMessage({ type: 'ready' }), true);
    assert.equal(isWebviewToHostMessage({ type: 'addCard', columnId: 'col-1', title: 'Task' }), true);
    assert.equal(isWebviewToHostMessage({ type: 'addColumn', title: 'Ready' }), true);
    assert.equal(isWebviewToHostMessage({ type: 'editCard', cardId: 'card-1', title: 'Rename' }), true);
    assert.equal(isWebviewToHostMessage({ type: 'renameColumn', columnId: 'col-1', title: 'Ready' }), true);
    assert.equal(
      isWebviewToHostMessage({
        type: 'setColumnLimits',
        columnId: 'col-1',
        wipLimit: 3,
        reverseWip: null,
      }),
      true,
    );
    assert.equal(isWebviewToHostMessage({ type: 'deleteColumn', columnId: 'col-1' }), true);
    assert.equal(isWebviewToHostMessage({ type: 'deleteColumn', columnId: 'col-1', targetColumnId: 'col-2' }), true);
    assert.equal(isWebviewToHostMessage({ type: 'reorderColumn', columnId: 'col-1', toIndex: 1 }), true);
    assert.equal(isWebviewToHostMessage({ type: 'setDescription', cardId: 'card-1', description: 'Defined work' }), true);
    assert.equal(
      isWebviewToHostMessage({
        type: 'setAcceptanceCriteria',
        cardId: 'card-1',
        acceptanceCriteria: '- [ ] Ship it',
      }),
      true,
    );
    assert.equal(isWebviewToHostMessage({ type: 'setAssignee', cardId: 'card-1', assignee: { kind: 'ai', name: 'Copilot' } }), true);
    assert.equal(isWebviewToHostMessage({ type: 'setAssignee', cardId: 'card-1' }), true);
    assert.equal(isWebviewToHostMessage({ type: 'runCardWithAI', cardId: 'card-1' }), true);
    assert.equal(isWebviewToHostMessage({ type: 'deleteCard', cardId: 'card-1' }), true);
    assert.equal(
      isWebviewToHostMessage({ type: 'moveCard', cardId: 'card-1', toColumnId: 'col-2', toIndex: 0 }),
      true,
    );
  });

  test('rejects malformed or unsupported messages', () => {
    assert.equal(isWebviewToHostMessage(null), false);
    assert.equal(isWebviewToHostMessage({}), false);
    assert.equal(isWebviewToHostMessage({ type: 'ready', extra: true }), true);
    assert.equal(isWebviewToHostMessage({ type: 'addCard', columnId: 'col-1' }), false);
    assert.equal(isWebviewToHostMessage({ type: 'addColumn' }), false);
    assert.equal(isWebviewToHostMessage({ type: 'editCard', cardId: 1, title: 'Rename' }), false);
    assert.equal(isWebviewToHostMessage({ type: 'renameColumn', columnId: 1, title: 'Ready' }), false);
    assert.equal(
      isWebviewToHostMessage({ type: 'setColumnLimits', columnId: 'col-1', wipLimit: 1.5, reverseWip: null }),
      false,
    );
    assert.equal(
      isWebviewToHostMessage({ type: 'setColumnLimits', columnId: 'col-1', wipLimit: 1 }),
      false,
    );
    assert.equal(isWebviewToHostMessage({ type: 'deleteColumn', columnId: 'col-1', targetColumnId: 1 }), false);
    assert.equal(isWebviewToHostMessage({ type: 'reorderColumn', columnId: 'col-1', toIndex: 1.5 }), false);
    assert.equal(isWebviewToHostMessage({ type: 'setDescription', cardId: 'card-1', description: 1 }), false);
    assert.equal(
      isWebviewToHostMessage({ type: 'setAcceptanceCriteria', cardId: 'card-1', acceptanceCriteria: 1 }),
      false,
    );
    assert.equal(isWebviewToHostMessage({ type: 'setAssignee', cardId: 'card-1', assignee: { kind: 'robot' } }), false);
    assert.equal(isWebviewToHostMessage({ type: 'runCardWithAI', cardId: 1 }), false);
    assert.equal(isWebviewToHostMessage({ type: 'deleteCard', cardId: 1 }), false);
    assert.equal(
      isWebviewToHostMessage({ type: 'moveCard', cardId: 'card-1', toColumnId: 'col-2', toIndex: 1.5 }),
      false,
    );
    assert.equal(isWebviewToHostMessage({ type: 'archiveCard', cardId: 'card-1' }), false);
  });
});
