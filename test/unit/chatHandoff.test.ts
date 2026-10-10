import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import {
  describeChatHandoffTarget,
  createChatHandoffInFlight,
  deliverClipboardHandoff,
  formatChatHandoffFailure,
  listAvailableChatProviders,
  positionalHandoffArgs,
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
    assert.equal(target?.prepareCommandId, 'chatgpt.openSidebar');
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

  test('describes Claude Code positional handoffs without promising a new window', () => {
    const target = resolveChatHandoffTarget('claude-code', ['claude-vscode.editor.open']);

    assert.equal(
      describeChatHandoffTarget(target!),
      'Opens Claude Code chat pre-filled with the card prompt',
    );
  });

  test('passes sidebar routing options to Claude Code editor.open only', () => {
    const editorOpen = resolveChatHandoffTarget('claude-code', ['claude-vscode.editor.open']);
    const primaryEditorOpen = resolveChatHandoffTarget('claude-code', ['claude-vscode.primaryEditor.open'], {
      'claude-code': 'claude-vscode.primaryEditor.open',
    });

    assert.deepEqual(positionalHandoffArgs(editorOpen!, 'do the card'), [
      undefined,
      'do the card',
      undefined,
      undefined,
      undefined,
      { programmatic: 'honor-preferred-location' },
    ]);
    assert.deepEqual(positionalHandoffArgs(primaryEditorOpen!, 'do the card'), [undefined, 'do the card']);
  });

  test('auto-paste is enabled only for Codex new-chat handoffs', () => {
    const codexNewChat = resolveChatHandoffTarget('codex', ['chatgpt.newChat']);
    const codexSidebar = resolveChatHandoffTarget('codex', ['chatgpt.openSidebar']);
    const copilot = resolveChatHandoffTarget('copilot', ['workbench.action.chat.open']);

    assert.equal(shouldAutoPasteChatHandoff(codexNewChat!), true);
    assert.equal(shouldAutoPasteChatHandoff(codexSidebar!), false);
    assert.equal(shouldAutoPasteChatHandoff(copilot!), false);
  });

  test('activates and prepares Codex before sending the new-chat command', async () => {
    const target = resolveChatHandoffTarget('codex', ['chatgpt.newChat', 'chatgpt.openSidebar'])!;
    const events: string[] = [];
    let releaseActivation!: () => void;
    const activation = new Promise<void>((resolve) => {
      releaseActivation = resolve;
    });
    const resultPromise = deliverClipboardHandoff(target, 'complete card prompt', {
      writeClipboard: async (prompt) => {
        events.push(`clipboard:${prompt}`);
      },
      activateProvider: async () => {
        events.push('activate:start');
        await activation;
        events.push('activate:done');
      },
      executeCommand: async (commandId) => {
        events.push(`command:${commandId}`);
      },
      wait: async (delayMs) => {
        events.push(`wait:${delayMs}`);
      },
    }, { providerReadyDelayMs: 0, composerReadyDelayMs: 0 });

    await Promise.resolve();
    assert.deepEqual(events, ['clipboard:complete card prompt', 'activate:start']);
    releaseActivation();

    assert.deepEqual(await resultPromise, { delivered: true });
    assert.deepEqual(events, [
      'clipboard:complete card prompt',
      'activate:start',
      'activate:done',
      'command:chatgpt.openSidebar',
      'wait:0',
      'command:chatgpt.newChat',
      'wait:0',
      'command:editor.action.clipboardPasteAction',
    ]);
  });

  test('delivers immediately when the Codex composer is already loaded', async () => {
    const target = resolveChatHandoffTarget('codex', ['chatgpt.newChat'])!;
    const clipboard: string[] = [];
    const commands: string[] = [];
    const waits: number[] = [];
    const result = await deliverClipboardHandoff(target, 'Title\nDescription\nAcceptance criteria', {
      writeClipboard: async (prompt) => {
        clipboard.push(prompt);
      },
      executeCommand: async (commandId) => {
        commands.push(commandId);
      },
      wait: async (delayMs) => {
        waits.push(delayMs);
      },
    }, { providerReadyDelayMs: 0, composerReadyDelayMs: 0, pasteRetryDelayMs: 0 });

    assert.deepEqual(result, { delivered: true });
    assert.deepEqual(clipboard, ['Title\nDescription\nAcceptance criteria']);
    assert.deepEqual(commands, ['chatgpt.newChat', 'editor.action.clipboardPasteAction']);
    assert.deepEqual(waits, [0]);
  });

  test('retains the prompt and retries paste until the Codex composer loads', async () => {
    const target = resolveChatHandoffTarget('codex', ['chatgpt.newChat', 'chatgpt.openSidebar'])!;
    const clipboard: string[] = [];
    const commands: string[] = [];
    const waits: number[] = [];
    let pasteAttempts = 0;
    const result = await deliverClipboardHandoff(target, 'complete first-attempt prompt', {
      writeClipboard: async (prompt) => {
        clipboard.push(prompt);
      },
      executeCommand: async (commandId) => {
        commands.push(commandId);
        if (commandId === 'editor.action.clipboardPasteAction') {
          pasteAttempts += 1;
          if (pasteAttempts < 3) {
            throw new Error('composer still loading');
          }
        }
      },
      wait: async (delayMs) => {
        waits.push(delayMs);
      },
    }, { providerReadyDelayMs: 0, composerReadyDelayMs: 0, pasteRetryDelayMs: 0 });

    assert.deepEqual(result, { delivered: true });
    assert.deepEqual(clipboard, ['complete first-attempt prompt']);
    assert.deepEqual(commands, [
      'chatgpt.openSidebar',
      'chatgpt.newChat',
      'editor.action.clipboardPasteAction',
      'editor.action.clipboardPasteAction',
      'editor.action.clipboardPasteAction',
    ]);
    assert.equal(pasteAttempts, 3, 'the handoff stops retrying after the first successful paste');
    assert.deepEqual(waits, [0, 0, 0, 0]);
  });

  test('keeps a long Codex request inline instead of creating a pasted-text attachment', async () => {
    const target = resolveChatHandoffTarget('codex', ['chatgpt.newChat'])!;
    const prompt = 'Title: Portfolio loop\nDescription:\n' + 'Implement the full workflow.\n'.repeat(320);
    let clipboard = '';
    let composer = '';
    const attachments: string[] = [];
    const pasted: string[] = [];
    const result = await deliverClipboardHandoff(target, prompt, {
      writeClipboard: async (text) => { clipboard = text; },
      executeCommand: async (commandId) => {
        if (commandId === 'editor.action.clipboardPasteAction') {
          pasted.push(clipboard);
          // The installed Codex composer converts an individual large paste
          // into an attachment rather than including it in the user message.
          if (clipboard.length >= 5_000) {
            attachments.push(clipboard);
          } else {
            composer += clipboard;
          }
        }
      },
      wait: async () => undefined,
    });

    assert.deepEqual(result, { delivered: true });
    assert.deepEqual(attachments, []);
    assert.equal(composer, prompt);
    assert.ok(pasted.length > 1);
    assert.equal(clipboard, prompt, 'the complete prompt remains available for manual recovery');
  });

  test('preserves Unicode and CRLF boundaries across Codex paste chunks', async () => {
    const target = resolveChatHandoffTarget('codex', ['chatgpt.newChat'])!;
    const prompt = 'a'.repeat(3_999) + '\u{1F680}' + 'b'.repeat(3_997) + '\r\n' + 'c'.repeat(1_000);
    let clipboard = '';
    const pasted: string[] = [];
    await deliverClipboardHandoff(target, prompt, {
      writeClipboard: async (text) => { clipboard = text; },
      executeCommand: async (commandId) => {
        if (commandId === 'editor.action.clipboardPasteAction') {
          pasted.push(clipboard);
        }
      },
      wait: async () => undefined,
    });

    assert.equal(pasted.join(''), prompt);
    for (const chunk of pasted) {
      assert.doesNotMatch(chunk, /[\uD800-\uDBFF]$/);
      assert.doesNotMatch(chunk, /^[\uDC00-\uDFFF]/);
      assert.equal(chunk.endsWith('\r'), false);
      assert.equal(chunk.startsWith('\n'), false);
    }
  });

  test('restores the full prompt and stops after a later chunk cannot be pasted', async () => {
    const target = resolveChatHandoffTarget('codex', ['chatgpt.newChat'])!;
    const prompt = 'a'.repeat(9_000);
    let clipboard = '';
    const pasted: string[] = [];
    const result = await deliverClipboardHandoff(target, prompt, {
      writeClipboard: async (text) => { clipboard = text; },
      executeCommand: async (commandId) => {
        if (commandId === 'editor.action.clipboardPasteAction') {
          pasted.push(clipboard);
          if (pasted.length > 1) {
            throw new Error('composer lost focus');
          }
        }
      },
      wait: async () => undefined,
    }, { pasteMaxAttempts: 2, pasteRetryDelayMs: 0 });

    assert.deepEqual(result, { delivered: false, error: 'composer lost focus after 2 paste attempts' });
    assert.equal(pasted.length, 3, 'the final chunk is never attempted');
    assert.equal(clipboard, prompt);
  });

  test('does not start a second handoff while the first is in progress', async () => {
    const inFlight = createChatHandoffInFlight();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let actions = 0;
    const first = inFlight.run('card-1', async () => {
      actions += 1;
      await gate;
      return true;
    });
    const second = await inFlight.run('card-1', async () => {
      actions += 1;
      return true;
    });

    assert.deepEqual(second, { started: false });
    assert.equal(actions, 1);
    release();
    assert.deepEqual(await first, { started: true, value: true });
  });

  test('returns a visible retry message and no success when paste cannot be delivered', async () => {
    const target = resolveChatHandoffTarget('codex', ['chatgpt.newChat'])!;
    const result = await deliverClipboardHandoff(target, 'complete card prompt', {
      writeClipboard: async () => undefined,
      executeCommand: async (commandId) => {
        if (commandId === 'editor.action.clipboardPasteAction') {
          throw new Error('Codex composer is still unavailable');
        }
      },
      wait: async () => undefined,
    }, { providerReadyDelayMs: 0, composerReadyDelayMs: 0 });

    assert.equal(result.delivered, false);
    if (result.delivered) {
      assert.fail('expected delivery to fail');
    }
    assert.match(formatChatHandoffFailure('Codex (ChatGPT)', '"Example card"', result.error), /Could not hand off/);
    assert.match(formatChatHandoffFailure('Codex (ChatGPT)', '"Example card"', result.error), /Try again/);
    assert.match(formatChatHandoffFailure('Codex (ChatGPT)', '"Example card"', result.error), /No activity entry was recorded/);
  });

  test('does not paste or report success when Codex cannot open', async () => {
    const target = resolveChatHandoffTarget('codex', ['chatgpt.newChat'])!;
    const commands: string[] = [];
    const result = await deliverClipboardHandoff(target, 'complete card prompt', {
      writeClipboard: async () => undefined,
      executeCommand: async (commandId) => {
        commands.push(commandId);
        if (commandId === 'chatgpt.newChat') {
          throw new Error('Codex failed to open');
        }
      },
      wait: async () => undefined,
    }, { providerReadyDelayMs: 0, composerReadyDelayMs: 0 });

    assert.deepEqual(result, { delivered: false, error: 'Codex failed to open' });
    assert.deepEqual(commands, ['chatgpt.newChat']);
    assert.match(formatChatHandoffFailure('Codex (ChatGPT)', '"Example card"', result.error), /Try again/);
  });
});
