import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { isWebviewToHostMessage } from '../../src/types';

suite('webview protocol', () => {
  test('accepts valid messages for each supported message type', () => {
    assert.equal(isWebviewToHostMessage({ type: 'ready' }), true);
    assert.equal(isWebviewToHostMessage({ type: 'addCard', columnId: 'col-1', title: 'Task' }), true);
    assert.equal(isWebviewToHostMessage({ type: 'editCard', cardId: 'card-1', title: 'Rename' }), true);
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
    assert.equal(isWebviewToHostMessage({ type: 'editCard', cardId: 1, title: 'Rename' }), false);
    assert.equal(isWebviewToHostMessage({ type: 'deleteCard', cardId: 1 }), false);
    assert.equal(
      isWebviewToHostMessage({ type: 'moveCard', cardId: 'card-1', toColumnId: 'col-2', toIndex: 1.5 }),
      false,
    );
    assert.equal(isWebviewToHostMessage({ type: 'archiveCard', cardId: 'card-1' }), false);
  });
});
