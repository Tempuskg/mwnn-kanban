import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { suite, test } from 'node:test';
import { buildCardPath, copyCardPathToClipboard } from '../../src/cardPath';

suite('card path copy', () => {
  const workspaceFolder = path.resolve('test-workspace');

  test('builds an absolute native path from the default board folder', () => {
    const cardPath = buildCardPath(workspaceFolder, '.mwnn', 'card-default');

    assert.equal(cardPath, path.join(workspaceFolder, '.mwnn', 'cards', 'card-default.md'));
    assert.equal(path.isAbsolute(cardPath), true);
  });

  test('builds an absolute native path from a configured non-default board folder', () => {
    const cardPath = buildCardPath(workspaceFolder, 'planning/team-board/', 'card-abc123');

    assert.equal(cardPath, path.join(workspaceFolder, 'planning', 'team-board', 'cards', 'card-abc123.md'));
    assert.equal(path.isAbsolute(cardPath), true);
  });

  test('copies the constructed path and returns success feedback', async () => {
    let copiedText = '';
    const expectedPath = path.join(workspaceFolder, 'work', 'kanban', 'cards', 'card-42.md');
    const result = await copyCardPathToClipboard(workspaceFolder, 'work/kanban', 'card-42', (value) => {
      copiedText = value;
    });

    assert.equal(copiedText, expectedPath);
    assert.deepEqual(result, {
      ok: true,
      path: expectedPath,
      message: `Copied ${expectedPath} to the clipboard.`,
    });
  });

  test('returns clear failure feedback when clipboard access rejects', async () => {
    const expectedPath = path.join(workspaceFolder, 'tasks', 'cards', 'card-7.md');
    const result = await copyCardPathToClipboard(workspaceFolder, 'tasks', 'card-7', async () => {
      throw new Error('Clipboard access denied.');
    });

    assert.deepEqual(result, {
      ok: false,
      path: expectedPath,
      message: `Could not copy card path ${expectedPath}. Clipboard access denied.`,
    });
  });
});
