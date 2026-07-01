import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { boardButtonMode, boardButtonLabel } from '../../src/boardButton';

suite('sidebar board button state', () => {
  test('shows "Open Board" when no board panel is open', () => {
    const mode = boardButtonMode({ open: false, focused: false });

    assert.equal(mode, 'open');
    assert.equal(boardButtonLabel(mode), 'Open Board');
  });

  test('shows "Focus Board" when the board is open but not focused', () => {
    const mode = boardButtonMode({ open: true, focused: false });

    assert.equal(mode, 'focus');
    assert.equal(boardButtonLabel(mode), 'Focus Board');
  });

  test('hides the button when the board is open and focused', () => {
    const mode = boardButtonMode({ open: true, focused: true });

    assert.equal(mode, 'hidden');
  });

  test('a closed board reports "open" regardless of the focused flag', () => {
    // Focus is meaningless without a panel; the closed state wins.
    assert.equal(boardButtonMode({ open: false, focused: true }), 'open');
  });

  test('transitions cover the closed → open-unfocused → open-focused path', () => {
    const closed = boardButtonMode({ open: false, focused: false });
    const openedUnfocused = boardButtonMode({ open: true, focused: false });
    const openedFocused = boardButtonMode({ open: true, focused: true });

    assert.deepEqual([closed, openedUnfocused, openedFocused], ['open', 'focus', 'hidden']);
  });
});
