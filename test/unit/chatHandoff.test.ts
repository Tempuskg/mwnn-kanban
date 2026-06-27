import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import {
  listAvailableChatProviders,
  resolveChatHandoffTarget,
} from '../../src/chatHandoff';

suite('chat handoff resolution', () => {
  test('resolves Copilot to the query-capable chat command', () => {
    const target = resolveChatHandoffTarget('copilot', ['workbench.action.chat.open']);

    assert.equal(target?.commandId, 'workbench.action.chat.open');
    assert.equal(target?.supportsQuery, true);
  });

  test('resolves Codex and Claude Code to clipboard-paste open commands', () => {
    const codex = resolveChatHandoffTarget('codex', ['chatgpt.openSidebar']);
    const claude = resolveChatHandoffTarget('claude-code', ['claude-vscode.sidebar.open']);

    assert.equal(codex?.commandId, 'chatgpt.openSidebar');
    assert.equal(codex?.supportsQuery, false);
    assert.equal(claude?.commandId, 'claude-vscode.sidebar.open');
    assert.equal(claude?.supportsQuery, false);
  });

  test('returns undefined when no provider command is installed', () => {
    assert.equal(resolveChatHandoffTarget('codex', ['some.unrelated.command']), undefined);
  });

  test('prefers the first available candidate in preference order', () => {
    const target = resolveChatHandoffTarget('codex', ['chatgpt.newChat', 'chatgpt.openSidebar']);

    assert.equal(target?.commandId, 'chatgpt.openSidebar');
  });

  test('honours a configured command override before built-in candidates', () => {
    const target = resolveChatHandoffTarget(
      'claude-code',
      ['claude-vscode.sidebar.open', 'my.custom.claude.command'],
      { 'claude-code': 'my.custom.claude.command' },
    );

    assert.equal(target?.commandId, 'my.custom.claude.command');
    assert.equal(target?.supportsQuery, false);
  });

  test('lists only providers whose commands are present', () => {
    const targets = listAvailableChatProviders([
      'workbench.action.chat.open',
      'claude-vscode.sidebar.open',
    ]);

    assert.deepEqual(
      targets.map((target) => target.provider),
      ['copilot', 'claude-code'],
    );
  });
});
