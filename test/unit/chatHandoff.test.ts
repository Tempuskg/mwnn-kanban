import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import {
  describeChatHandoffTarget,
  createChatHandoffInFlight,
  createChatHandoffQueue,
  type ClipboardHandoffExecutor,
  deliverClipboardHandoff,
  resolveClipboardHandoffResult,
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

});


function codexHarness(options: { ready?: boolean; readyOnWait?: number; readyAfterMs?: number; acknowledgeOnCopy?: number; copyAfterWaits?: number; pasteOnWait?: boolean; requireNewChatAfterStartup?: boolean; copyUnavailable?: boolean } = {}) {
  let clipboard = '';
  let ready = options.ready ?? true;
  let pendingNewChat = false;
  let selected = false;
  let pendingPaste = '';
  let waits = 0;
  let copies = 0;
  let elapsedMs = 0;
  let pendingCopy: { text: string; waitsLeft: number } | undefined;
  let pendingPasteCommand = false;
  let composerFocused = !options.requireNewChatAfterStartup;
  const state = {
    composer: 'stale draft from another conversation',
    newChats: 0,
    newChatReadiness: [] as boolean[],
    pasted: [] as string[],
    attachments: [] as string[],
    events: [] as string[],
    clipboard: () => clipboard,
  };
  const paste = () => {
    state.pasted.push(clipboard);
    // A real VS Code command can resolve with no focused composer.
    if (!ready || !composerFocused) { return; }
    if (clipboard.length >= 5_000) { state.attachments.push(clipboard); return; }
    if (selected) { state.composer = ''; pendingPaste = ''; selected = false; }
    if (options.acknowledgeOnCopy) { pendingPaste += clipboard; } else { state.composer += clipboard; }
  };
  const executor: ClipboardHandoffExecutor = {
    writeClipboard: async (value) => { clipboard = value; },
    readClipboard: async () => clipboard,
    activateProvider: async () => { state.events.push('activate'); },
    executeCommand: async (command) => {
      state.events.push(command);
      if (command === 'chatgpt.newChat') {
        state.newChats += 1;
        state.newChatReadiness.push(ready);
        if (ready) { state.composer = ''; composerFocused = true; } else { pendingNewChat = true; }
      } else if (command === 'editor.action.clipboardPasteAction') {
        if (options.pasteOnWait) { pendingPasteCommand = true; } else { paste(); }
      } else if (command === 'editor.action.selectAll') {
        selected = ready && composerFocused;
      } else if (command === 'editor.action.clipboardCopyAction') {
        if (options.copyUnavailable) { return; }
        copies += 1;
        if (options.acknowledgeOnCopy && copies >= options.acknowledgeOnCopy) {
          state.composer += pendingPaste;
          pendingPaste = '';
        }
        if (ready && selected && state.composer) {
          if (options.copyAfterWaits) {
            pendingCopy ??= { text: state.composer, waitsLeft: options.copyAfterWaits };
          } else { clipboard = state.composer; }
        }
      }
    },
    wait: async (delayMs) => {
      waits += 1;
      elapsedMs += delayMs;
      if (pendingPasteCommand) { pendingPasteCommand = false; paste(); }
      if (pendingCopy !== undefined) {
        pendingCopy.waitsLeft -= 1;
        if (pendingCopy.waitsLeft === 0) { clipboard = pendingCopy.text; pendingCopy = undefined; }
      }
      if ((options.readyOnWait !== undefined && waits >= options.readyOnWait) ||
        (options.readyAfterMs !== undefined && elapsedMs >= options.readyAfterMs)) {
        ready = true;
        if (pendingNewChat) { state.composer = ''; pendingNewChat = false; }
      }
    },
  };
  return { state, executor };
}

const codexTarget = resolveChatHandoffTarget('codex', ['chatgpt.newChat', 'chatgpt.openSidebar'])!;
const noDelay = { providerReadyDelayMs: 0, composerReadyDelayMs: 0, pasteSettleDelayMs: 0, verificationRetryDelayMs: 0 };

suite('verified Codex clipboard handoff', () => {
  test('distinguishes an unreadable composer from failed delivery when the full prompt arrived', async () => {
    const { state, executor } = codexHarness({ copyUnavailable: true });
    const prompt = 'Complete prompt for the selected card';
    const result = await deliverClipboardHandoff(codexTarget, prompt, executor, noDelay);
    assert.equal(result.delivered, false, 'unreadable Copy must not prove success');
    assert.equal('unconfirmed' in result && result.unconfirmed, true, 'lack of readback must not claim paste failure');
    assert.equal(state.composer, prompt);
    assert.deepEqual(state.pasted, [prompt]);
    assert.equal(state.newChats, 1);
    assert.equal(state.clipboard(), prompt);
  });

  test('waits for asynchronous webview Copy without inserting readiness-token text', async () => {
    const { state, executor } = codexHarness({ copyAfterWaits: 1, pasteOnWait: true });
    const prompt = 'Complete selected-card prompt';
    assert.deepEqual(await deliverClipboardHandoff(codexTarget, prompt, executor, noDelay), { delivered: true });
    assert.equal(state.newChats, 1);
    assert.deepEqual(state.pasted, [prompt]);
    assert.equal(state.composer, prompt);
    assert.equal(state.clipboard(), prompt);
  });

  test('does not claim delivery when startup outlasts the allowed wait and the single paste is ignored', async () => {
    const { state, executor } = codexHarness({ ready: false, readyOnWait: 3 });
    const result = await deliverClipboardHandoff(codexTarget, 'selected card prompt', executor, noDelay);
    assert.equal(result.delivered, false);
    assert.equal(state.composer, '');
    assert.equal(state.newChats, 1);
    assert.deepEqual(state.pasted, ['selected card prompt'], 'the actual card prompt is inserted once');
    assert.equal(state.clipboard(), 'selected card prompt');
  });

  test('waits through the reported five-second initialization before its only prompt paste', async () => {
    const { state, executor } = codexHarness({ ready: false, readyAfterMs: 5_000 });
    const prompt = 'Title: cold card\nDescription\n- [ ] Full acceptance text';
    assert.deepEqual(await deliverClipboardHandoff(codexTarget, prompt, executor), { delivered: true });
    assert.equal(state.newChats, 1);
    assert.deepEqual(state.pasted, [prompt]);
    assert.equal(state.composer, prompt);
  });

  test('requests the new chat after startup when a queued startup chat would not focus the composer', async () => {
    const { state, executor } = codexHarness({
      ready: false, readyAfterMs: 5_000, requireNewChatAfterStartup: true,
      pasteOnWait: true, copyAfterWaits: 1,
    });
    const prompt = 'Selected card path\nTitle and complete acceptance criteria';
    assert.deepEqual(await deliverClipboardHandoff(codexTarget, prompt, executor), { delivered: true });
    assert.deepEqual(state.newChatReadiness, [true], 'one new-chat request must follow sidebar initialization');
    assert.deepEqual(state.pasted, [prompt]);
    assert.equal(state.composer, prompt);
  });

  test('awaits activation and prepares the sidebar before creating one new chat', async () => {
    const { state, executor } = codexHarness();
    let release!: () => void;
    const activation = new Promise<void>((resolve) => { release = resolve; });
    const pending = deliverClipboardHandoff(codexTarget, 'complete prompt', {
      ...executor,
      activateProvider: async () => { state.events.push('activate:start'); await activation; },
    }, noDelay);
    for (let step = 0; step < 4; step += 1) { await Promise.resolve(); }
    assert.deepEqual(state.events, ['activate:start']);
    release();
    assert.deepEqual(await pending, { delivered: true });
    assert.deepEqual(state.events.slice(1, 4), ['chatgpt.openSidebar', 'chatgpt.newChat', 'editor.action.clipboardPasteAction']);
    assert.equal(state.newChats, 1);
  });

  test('delivers the selected card on an already-open conversation without its stale draft', async () => {
    const { state, executor } = codexHarness();
    const prompt = 'Title: selected card\nDescription\n- [ ] Acceptance criterion';
    assert.deepEqual(await deliverClipboardHandoff(codexTarget, prompt, executor, noDelay), { delivered: true });
    assert.equal(state.composer, prompt);
    assert.deepEqual(state.pasted, [prompt]);
    assert.equal(state.clipboard(), prompt);
  });

  test('delivers once when initialization finishes before the composer paste', async () => {
    const { state, executor } = codexHarness({ ready: false, readyOnWait: 2 });
    assert.deepEqual(await deliverClipboardHandoff(codexTarget, 'card A', executor, noDelay), { delivered: true });
    assert.equal(state.composer, 'card A');
    assert.equal(state.newChats, 1);
    assert.deepEqual(state.pasted, ['card A']);
  });

  test('polls delayed acknowledgement without creating another chat or replaying paste', async () => {
    const { state, executor } = codexHarness({ acknowledgeOnCopy: 3 });
    assert.deepEqual(await deliverClipboardHandoff(codexTarget, 'card A', executor, noDelay), { delivered: true });
    assert.equal(state.composer, 'card A');
    assert.equal(state.newChats, 1);
    assert.deepEqual(state.pasted, ['card A']);
    assert.equal(state.events.filter((event) => event === 'editor.action.clipboardCopyAction').length, 3);
  });

  test('rejects mismatched or incomplete composer text instead of using the source clipboard as evidence', async () => {
    const { state, executor } = codexHarness();
    const execute = executor.executeCommand;
    const result = await deliverClipboardHandoff(codexTarget, 'card A', {
      ...executor,
      executeCommand: async (command) => {
        await execute(command);
        if (command === 'editor.action.clipboardPasteAction' && state.pasted.length > 0) { state.composer = 'stale card B'; }
      },
    }, noDelay);
    assert.equal(result.delivered, false);
    if (!result.delivered) { assert.match(result.error, /complete selected-card prompt/); }
    assert.equal(state.clipboard(), 'card A');
  });

  test('keeps long prompts inline, including Unicode and CRLF at chunk boundaries', async () => {
    const { state, executor } = codexHarness({ pasteOnWait: true, copyAfterWaits: 1 });
    const prompt = 'a'.repeat(3_999) + '\u{1F680}' + 'b'.repeat(3_997) + '\r\n' + 'c'.repeat(1_000);
    assert.deepEqual(await deliverClipboardHandoff(codexTarget, prompt, executor, noDelay), { delivered: true });
    assert.equal(state.composer, prompt);
    assert.equal(state.pasted.join(''), prompt);
    assert.deepEqual(state.attachments, []);
    for (const chunk of state.pasted) {
      assert.doesNotMatch(chunk, /[\uD800-\uDBFF]$/);
      assert.doesNotMatch(chunk, /^[\uDC00-\uDFFF]/);
      assert.equal(chunk.endsWith('\r'), false);
      assert.equal(chunk.startsWith('\n'), false);
    }
    assert.equal(state.clipboard(), prompt);
  });

  test('does not replay a paste that throws after inserting text', async () => {
    const { state, executor } = codexHarness();
    const execute = executor.executeCommand;
    const result = await deliverClipboardHandoff(codexTarget, 'card A', {
      ...executor,
      executeCommand: async (command) => {
        await execute(command);
        if (command === 'editor.action.clipboardPasteAction' && state.pasted.length > 0) { throw new Error('reply lost after insertion'); }
      },
    }, noDelay);
    assert.deepEqual(result, { delivered: false, error: 'reply lost after insertion' });
    assert.equal(state.composer, 'card A');
    assert.deepEqual(state.pasted, ['card A']);
    assert.equal(state.clipboard(), 'card A');
  });

  test('stops after a failed long-prompt chunk and restores the complete clipboard', async () => {
    const { state, executor } = codexHarness();
    const execute = executor.executeCommand;
    const prompt = 'a'.repeat(9_000);
    const result = await deliverClipboardHandoff(codexTarget, prompt, {
      ...executor,
      executeCommand: async (command) => {
        if (command === 'editor.action.clipboardPasteAction' && state.pasted.length === 1) {
          throw new Error('composer lost focus');
        }
        await execute(command);
      },
    }, noDelay);
    assert.deepEqual(result, { delivered: false, error: 'composer lost focus' });
    assert.equal(state.pasted.length, 1);
    assert.equal(state.clipboard(), prompt);
  });

  test('holds the per-card lock through acknowledgement and the single success Activity write', async () => {
    const inFlight = createChatHandoffInFlight();
    const { state, executor } = codexHarness({ ready: false, readyOnWait: 2, acknowledgeOnCopy: 3 });
    let release!: () => void;
    let probing!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const probeStarted = new Promise<void>((resolve) => { probing = resolve; });
    let activities = 0;
    const action = async () => {
      const result = await deliverClipboardHandoff(codexTarget, 'card A', {
        ...executor,
        wait: async (delayMs) => {
          if (state.newChats === 1 && state.pasted.length === 0) { probing(); await gate; }
          await executor.wait(delayMs);
        },
      }, noDelay);
      if (result.delivered) { activities += 1; }
      return result.delivered;
    };
    const first = inFlight.run('card-A', action);
    await probeStarted;
    assert.deepEqual(await inFlight.run('card-A', action), { started: false });
    release();
    assert.deepEqual(await first, { started: true, value: true });
    assert.equal(state.newChats, 1);
    assert.deepEqual(state.pasted, ['card A']);
    assert.equal(activities, 1);
  });

  test('bounds verification when Codex never loads without repeatedly pasting anything', async () => {
    const { state, executor } = codexHarness({ ready: false });
    const result = await deliverClipboardHandoff(codexTarget, 'card A', executor, {
      ...noDelay, verificationMaxAttempts: 3,
    });
    assert.equal(result.delivered, false);
    if (!result.delivered) {
      assert.match(formatChatHandoffFailure('Codex', 'card A', result.error), /inspect the new-chat draft before retrying/);
    }
    assert.equal(state.newChats, 1);
    assert.deepEqual(state.pasted, ['card A']);
    assert.equal(state.clipboard(), 'card A');
  });

  test('does not overwrite a delayed Copy acknowledgement between polls', async () => {
    const { state, executor } = codexHarness({ copyAfterWaits: 3 });
    assert.deepEqual(await deliverClipboardHandoff(codexTarget, 'card A', executor, noDelay), { delivered: true });
    assert.deepEqual(state.pasted, ['card A']);
    assert.equal(state.composer, 'card A');
    assert.equal(state.clipboard(), 'card A');
  });

  test('serializes different cards so a pending handoff cannot paste another card clipboard', async () => {
    const queue = createChatHandoffQueue();
    const { state, executor } = codexHarness();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const first = queue.run(() => deliverClipboardHandoff(codexTarget, 'card A', {
      ...executor, activateProvider: () => gate,
    }, noDelay));
    const second = queue.run(() => deliverClipboardHandoff(codexTarget, 'card B', executor, noDelay));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(state.clipboard(), 'card A');
    assert.equal(state.newChats, 0);
    release();
    assert.deepEqual(await first, { delivered: true });
    assert.deepEqual(await second, { delivered: true });
    assert.deepEqual(state.pasted, ['card A', 'card B']);
    assert.equal(state.composer, 'card B');
  });

  test('initialization failure records no success and releases the card for a later retry', async () => {
    const inFlight = createChatHandoffInFlight();
    const { state, executor } = codexHarness();
    let activities = 0;
    let failActivation = true;
    const attempt = () => inFlight.run('card-A', async () => {
      const result = await deliverClipboardHandoff(codexTarget, 'card A', {
        ...executor,
        activateProvider: async () => { if (failActivation) { throw new Error('Codex cannot initialize'); } },
      }, noDelay);
      if (result.delivered) { activities += 1; }
      return result;
    });
    const failed = await attempt();
    assert.equal(failed.started && failed.value.delivered, false);
    assert.equal(activities, 0);
    assert.equal(state.newChats, 0);
    if (failed.started && !failed.value.delivered) {
      const warning = formatChatHandoffFailure('Codex (ChatGPT)', 'card A', failed.value.error);
      assert.match(warning, /Codex cannot initialize/);
      assert.match(warning, /No activity entry was recorded/);
      assert.match(warning, /Try again/);
    }
    failActivation = false;
    const retried = await attempt();
    assert.equal(retried.started && retried.value.delivered, true);
    assert.equal(activities, 1);
  });

  test('a rejected queued delivery does not poison later handoffs', async () => {
    const queue = createChatHandoffQueue();
    await assert.rejects(queue.run(async () => { throw new Error('failed'); }), /failed/);
    assert.equal(await queue.run(async () => 'retry'), 'retry');
  });

  test('times out activation without allowing its late completion to open an old handoff', async () => {
    const { state, executor } = codexHarness();
    let release!: () => void;
    const activation = new Promise<void>((resolve) => { release = resolve; });
    const result = await deliverClipboardHandoff(codexTarget, 'old card A', {
      ...executor, activateProvider: () => activation,
    }, { ...noDelay, providerActivationTimeoutMs: 1 });
    assert.equal(result.delivered, false);
    if (!result.delivered) { assert.match(result.error, /activation timed out/); }
    assert.equal(state.newChats, 0);
    assert.deepEqual(await deliverClipboardHandoff(codexTarget, 'new card B', executor, noDelay), { delivered: true });
    release();
    await Promise.resolve();
    assert.equal(state.newChats, 1);
    assert.deepEqual(state.pasted, ['new card B']);
    assert.equal(state.composer, 'new card B');
  });

  test('silent delivery failure records no success and a subsequent ready retry proceeds', async () => {
    const inFlight = createChatHandoffInFlight();
    const { state, executor } = codexHarness({ ready: false, readyOnWait: 3 });
    let activities = 0;
    const attempt = () => inFlight.run('card-A', async () => {
      const result = await deliverClipboardHandoff(codexTarget, 'card A', executor, noDelay);
      if (result.delivered) { activities += 1; }
      return result.delivered;
    });
    assert.deepEqual(await attempt(), { started: true, value: false });
    assert.equal(activities, 0);
    assert.deepEqual(state.pasted, ['card A'], 'a failed paste is not repeated');
    assert.deepEqual(await attempt(), { started: true, value: true });
    assert.equal(activities, 1);
    assert.equal(state.composer, 'card A');
  });

  test('does not paste when the new-chat command fails', async () => {
    const { state, executor } = codexHarness();
    const execute = executor.executeCommand;
    const result = await deliverClipboardHandoff(codexTarget, 'card A', {
      ...executor,
      executeCommand: async (command) => {
        if (command === 'chatgpt.newChat') { throw new Error('Codex failed to open'); }
        await execute(command);
      },
    }, noDelay);
    assert.deepEqual(result, { delivered: false, error: 'Codex failed to open' });
    assert.deepEqual(state.pasted, []);
  });

  test('verification failures restore the clipboard and never claim success', async () => {
    const { state, executor } = codexHarness();
    const result = await deliverClipboardHandoff(codexTarget, 'card A', {
      ...executor,
      readClipboard: async () => {
        if (state.pasted.length > 0) { throw new Error('copy unavailable'); }
        return executor.readClipboard();
      },
    }, { ...noDelay, verificationMaxAttempts: 2 });
    assert.deepEqual(result, { delivered: false, unconfirmed: true, error: 'copy unavailable after 2 verification attempts' });
    assert.equal(state.clipboard(), 'card A');
  });
});

suite('clipboard handoff acknowledgement', () => {
  test('verified delivery completes without a confirmation or failure message', async () => {
    const { executor } = codexHarness();
    const result = await deliverClipboardHandoff(codexTarget, 'card A', executor, noDelay);
    assert.equal(await resolveClipboardHandoffResult(result,
      async () => { assert.fail('verified delivery must not ask for confirmation'); },
      () => { assert.fail('verified delivery must not report failure'); },
    ), true);
  });

  test('user confirmation records one successful handoff without repasting or losing the pending card lock', async () => {
    const { state, executor } = codexHarness({ copyUnavailable: true });
    const inFlight = createChatHandoffInFlight();
    let release!: (confirmed: boolean) => void;
    let confirming!: () => void;
    const confirmation = new Promise<boolean>((resolve) => { release = resolve; });
    const confirmationStarted = new Promise<void>((resolve) => { confirming = resolve; });
    let activities = 0;
    let failures = 0;
    const action = async () => {
      const result = await deliverClipboardHandoff(codexTarget, 'card A', executor, noDelay);
      const delivered = await resolveClipboardHandoffResult(result,
        () => { confirming(); return confirmation; },
        () => { failures += 1; },
      );
      if (delivered) { activities += 1; }
      return delivered;
    };
    const pending = inFlight.run('card-A', action);
    await confirmationStarted;
    assert.equal(state.composer, 'card A');
    assert.equal(activities, 0, 'unavailable readback alone must never record success');
    assert.deepEqual(await inFlight.run('card-A', action), { started: false });
    release(true);
    assert.deepEqual(await pending, { started: true, value: true });
    assert.equal(activities, 1);
    assert.equal(failures, 0, 'a confirmed prompt must not show the false failure warning');
    assert.equal(state.newChats, 1);
    assert.deepEqual(state.pasted, ['card A']);
  });

  for (const confirmed of [false, undefined]) {
    test(`${confirmed === false ? 'a missing prompt' : 'dismissed confirmation'} records no success and permits a later retry`, async () => {
      const { state, executor } = codexHarness({ ready: false, readyOnWait: 3 });
      const inFlight = createChatHandoffInFlight();
      let activities = 0;
      const failures: string[] = [];
      const attempt = () => inFlight.run('card-A', async () => {
        const result = await deliverClipboardHandoff(codexTarget, 'card A', executor, noDelay);
        const delivered = await resolveClipboardHandoffResult(result, async () => confirmed, (reason) => { failures.push(reason); });
        if (delivered) { activities += 1; }
        return delivered;
      });
      assert.deepEqual(await attempt(), { started: true, value: false });
      assert.equal(activities, 0);
      assert.equal(failures.length, confirmed === false ? 1 : 0);
      if (confirmed === false) {
        assert.match(formatChatHandoffFailure('Codex', 'card A', failures[0]!), /reported missing.*No activity entry was recorded/);
      }
      assert.deepEqual(state.pasted, ['card A'], 'confirmation never retries the paste');
      assert.deepEqual(await attempt(), { started: true, value: true });
      assert.equal(activities, 1);
      assert.equal(state.composer, 'card A');
    });
  }

  test('an observed mismatch or explicit delivery error reports failure without offering success confirmation', async () => {
    const failures: string[] = [];
    assert.equal(await resolveClipboardHandoffResult({ delivered: false, error: 'incomplete selected-card prompt' },
      async () => { assert.fail('known delivery failure must not ask for success confirmation'); },
      (reason) => { failures.push(reason); },
    ), false);
    assert.deepEqual(failures, ['incomplete selected-card prompt']);
  });
});
