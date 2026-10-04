import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';

interface CardPathCopyFeedback {
  readonly text: string;
  readonly className: string;
  readonly role: string;
}

interface BoardWebviewTestExports {
  requestCardPathCopy(cardId: string, postMessage: (message: unknown) => void): void;
  createCardPathCopyFeedback(result: { readonly ok: boolean; readonly message: string }): CardPathCopyFeedback;
}

const { requestCardPathCopy, createCardPathCopyFeedback } = require('../../../media/board.js') as BoardWebviewTestExports;

suite('card path webview action', () => {
  test('posts a copy request for the open card', () => {
    const messages: unknown[] = [];

    requestCardPathCopy('card-open', (message) => messages.push(message));

    assert.deepEqual(messages, [{ type: 'copyCardPath', cardId: 'card-open' }]);
  });

  test('maps successful copies to observable status feedback', () => {
    assert.deepEqual(
      createCardPathCopyFeedback({ ok: true, message: 'Copied C:\\work\\cards\\card-open.md to the clipboard.' }),
      {
        text: 'Copied C:\\work\\cards\\card-open.md to the clipboard.',
        className: 'card-modal-copy-feedback-success',
        role: 'status',
      },
    );
  });

  test('maps failed copies to clear alert feedback', () => {
    assert.deepEqual(
      createCardPathCopyFeedback({ ok: false, message: 'Could not copy card path. Clipboard access denied.' }),
      {
        text: 'Could not copy card path. Clipboard access denied.',
        className: 'card-modal-copy-feedback-error',
        role: 'alert',
      },
    );
  });
});

suite('card editor column change', () => {
  const { columnChangeMove } = require('../../../media/board.js') as {
    columnChangeMove(cardId: string, current: string, next: string): unknown;
  };

  test('moves a card whose column changed to the top of the destination column', () => {
    assert.deepEqual(columnChangeMove('card-a', 'col-ready', 'col-done'), {
      type: 'moveCard',
      cardId: 'card-a',
      toColumnId: 'col-done',
      toIndex: 0,
    });
  });

  test('posts nothing when the column is unchanged so the position is preserved', () => {
    assert.equal(columnChangeMove('card-a', 'col-ready', 'col-ready'), null);
  });
});
