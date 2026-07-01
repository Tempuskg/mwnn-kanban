import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import {
  describeChatHandoffTarget,
  listAvailableChatProviders,
  resolveChatHandoffTarget,
  shouldAutoPasteChatHandoff,
} from '../../src/chatHandoff';

suite('chat handoff resolution', () => {
  test('resolves Copilot to the query-capable chat command', () => {
    const target = resolveChatHandoffTarget('copilot', ['workbench.action.chat.open']);

    assert.equal(target?.commandId, 'workbench.action.chat.open');
    assert.equal(target?.promptDelivery, 'query');
  });

  test('resolves Claude Code to a prompt-accepting editor command', () => {
    const claude = resolveChatHandoffTarget('claude-code', [
      'claude-vscode.editor.open',
      'claude-vscode.sidebar.open',
    ]);

    assert.equal(claude?.commandId, 'claude-vscode.editor.open');
    assert.equal(claude?.promptDelivery, 'positional');
  });

  test('falls back to clipboard-paste when only a bare open command exists', () => {
    const codex = resolveChatHandoffTarget('codex', ['chatgpt.openSidebar']);
    const claude = resolveChatHandoffTarget('claude-code', ['claude-vscode.sidebar.open']);

    assert.equal(codex?.commandId, 'chatgpt.openSidebar');
    assert.equal(codex?.promptDelivery, 'clipboard');
    assert.equal(claude?.commandId, 'claude-vscode.sidebar.open');
    assert.equal(claude?.promptDelivery, 'clipboard');
  });

  test('returns undefined when no provider command is installed', () => {
    assert.equal(resolveChatHandoffTarget('codex', ['some.unrelated.command']), undefined);
  });

  test('prefers a fresh Codex thread before reopening the sidebar', () => {
    const target = resolveChatHandoffTarget('codex', ['chatgpt.newChat', 'chatgpt.openSidebar']);

    assert.equal(target?.commandId, 'chatgpt.newChat');
  });

  test('honours a configured command override before built-in candidates', () => {
    const target = resolveChatHandoffTarget(
      'claude-code',
      ['claude-vscode.sidebar.open', 'my.custom.claude.command'],
      { 'claude-code': 'my.custom.claude.command' },
    );

    assert.equal(target?.commandId, 'my.custom.claude.command');
    assert.equal(target?.promptDelivery, 'clipboard');
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

  test('describes Codex new-chat handoffs as clipboard-based fresh threads', () => {
    const target = resolveChatHandoffTarget('codex', ['chatgpt.newChat']);

    assert.equal(
      describeChatHandoffTarget(target!),
      'Starts a fresh Codex thread and auto-pastes the prompt',
    );
  });

  test('auto-paste is enabled only for Codex new-chat handoffs', () => {
    const codexNewChat = resolveChatHandoffTarget('codex', ['chatgpt.newChat']);
    const codexSidebar = resolveChatHandoffTarget('codex', ['chatgpt.openSidebar']);
    const copilot = resolveChatHandoffTarget('copilot', ['workbench.action.chat.open']);

    assert.equal(shouldAutoPasteChatHandoff(codexNewChat!), true);
    assert.equal(shouldAutoPasteChatHandoff(codexSidebar!), false);
    assert.equal(shouldAutoPasteChatHandoff(copilot!), false);
  });
});
