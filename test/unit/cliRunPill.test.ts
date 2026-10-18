import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { createCliRunStatusTracker } from '../../src/cliRunStatusTracker';
import type { CliRunStatus } from '../../src/types';

interface CliRun {
  readonly providerLabel: string;
  readonly statusLine: string;
  readonly stoppable: boolean;
  readonly dispatchId?: string;
  readonly requestedModel?: string;
  readonly actualModel?: string;
  readonly thinkingLevel?: string;
}

const { nextCliRunStatus, cliRunPillView } = require('../../../media/board.js') as {
  nextCliRunStatus(previous: CliRun | undefined, message: CliRunStatus): CliRun | null;
  cliRunPillView(run: CliRun): { label: string; model: string; confirmed: boolean; thinkingLevel: string; title: string };
};

/** The extension-host tracker feeding the webview reducer, as the board does. */
function board() {
  const runs = new Map<string, CliRun>();
  const posted: CliRunStatus[] = [];
  const post = (status: CliRunStatus): void => {
    posted.push(status);
    const next = nextCliRunStatus(runs.get(status.cardId), status);
    if (next) {
      runs.set(status.cardId, next);
    } else {
      runs.delete(status.cardId);
    }
  };
  const tracker = (cardId: string, providerLabel: string, dispatchId: string) =>
    createCliRunStatusTracker({ cardId, providerLabel, dispatchId, post });
  return { runs, posted, tracker };
}

suite('card running pill model tracking', () => {
  test('shows the requested model while pending, then the actual model for the same dispatch', () => {
    const { runs, tracker } = board();
    const run = tracker('card-a', 'Claude Code', 'card-a:1');

    run.setModel({ requested: 'sonnet' });
    run.start();
    assert.deepEqual(cliRunPillView(runs.get('card-a')!), {
      label: 'Claude Code running',
      model: 'sonnet',
      confirmed: false,
      thinkingLevel: '',
      title: 'Claude Code is working on this card on requested model sonnet (not yet confirmed by the CLI)',
    });

    run.setModel({ requested: 'sonnet', actual: 'claude-sonnet-5-5' });
    const view = cliRunPillView(runs.get('card-a')!);
    assert.equal(view.model, 'claude-sonnet-5-5');
    assert.equal(view.confirmed, true);
    assert.match(view.title, /confirmed by the CLI/);

    run.statusLine('Editing files');
    assert.equal(runs.get('card-a')!.actualModel, 'claude-sonnet-5-5');
    assert.equal(runs.get('card-a')!.statusLine, 'Editing files');

    run.end();
    assert.equal(runs.has('card-a'), false);
  });

  test('shows only the CLI when no model was requested and none is confirmed', () => {
    const { runs, tracker } = board();
    const run = tracker('card-a', 'Cursor', 'card-a:1');
    run.setModel({});
    run.start();

    const view = cliRunPillView(runs.get('card-a')!);
    assert.equal(view.model, '');
    assert.equal(view.title, 'Cursor is working on this card');
    assert.equal('requestedModel' in runs.get('card-a')!, false);
    assert.equal('actualModel' in runs.get('card-a')!, false);
  });

  test('keeps the requested model when the actual model stays unavailable', () => {
    const { runs, tracker } = board();
    const run = tracker('card-a', 'Cursor', 'card-a:1');
    run.setModel({ requested: 'Gemini 3.8 Flash' });
    run.start();
    run.statusLine('Working');

    assert.equal(cliRunPillView(runs.get('card-a')!).model, 'Gemini 3.8 Flash');
    assert.equal(cliRunPillView(runs.get('card-a')!).confirmed, false);
  });

  test('ignores a blank or malformed model delivered to the board', () => {
    const run = nextCliRunStatus(undefined, {
      cardId: 'card-a',
      providerLabel: 'Codex',
      running: true,
      dispatchId: 'card-a:1',
      requestedModel: '   ',
      actualModel: 42 as unknown as string,
    });

    assert.ok(run);
    assert.equal(cliRunPillView(run).model, '');
  });

  test('a retry on the same card starts from its own requested model, not the earlier actual one', () => {
    const { runs, tracker } = board();
    const first = tracker('card-a', 'Claude Code', 'card-a:1');
    first.setModel({ requested: 'sonnet', actual: 'claude-sonnet-5-5' });
    first.start();
    first.end();

    const retry = tracker('card-a', 'Codex', 'card-a:2');
    retry.setModel({ requested: 'gpt-6.1-sol' });
    retry.start();

    const view = cliRunPillView(runs.get('card-a')!);
    assert.equal(view.label, 'Codex running');
    assert.equal(view.model, 'gpt-6.1-sol');
    assert.equal(view.confirmed, false);
  });

  test('a provider switch replaces the pill even if the earlier attempt reports its exit late', () => {
    const { runs, tracker } = board();
    const first = tracker('card-a', 'Claude Code', 'card-a:1');
    first.setModel({ requested: 'sonnet', actual: 'claude-sonnet-5-5' });
    first.start();

    const second = tracker('card-a', 'Codex', 'card-a:2');
    second.setModel({ requested: 'gpt-6.1-sol' });
    second.start();
    first.end();

    assert.equal(runs.get('card-a')!.providerLabel, 'Codex');
    assert.equal(runs.get('card-a')!.requestedModel, 'gpt-6.1-sol');
    assert.equal('actualModel' in runs.get('card-a')!, false);
  });

  test('a finished dispatch can no longer post a model, so it cannot overwrite the current pill', () => {
    const { posted, tracker } = board();
    const run = tracker('card-a', 'Claude Code', 'card-a:1');
    run.setModel({ requested: 'sonnet' });
    run.start();
    run.end();
    const count = posted.length;

    run.setModel({ requested: 'sonnet', actual: 'late-model' });
    run.statusLine('late');
    run.end();

    assert.equal(posted.length, count);
  });

  test('concurrent cards keep their own CLI and model', () => {
    const { runs, tracker } = board();
    const a = tracker('card-a', 'Claude Code', 'card-a:1');
    const b = tracker('card-b', 'Codex', 'card-b:2');
    a.setModel({ requested: 'sonnet' });
    b.setModel({ requested: 'gpt-6.1-sol' });
    a.start();
    b.start();
    b.setModel({ requested: 'gpt-6.1-sol', actual: 'gpt-6.1-sol-2026' });
    a.statusLine('Reading');

    assert.equal(cliRunPillView(runs.get('card-a')!).model, 'sonnet');
    assert.equal(cliRunPillView(runs.get('card-b')!).model, 'gpt-6.1-sol-2026');

    b.end();
    assert.equal(runs.has('card-b'), false);
    assert.equal(runs.get('card-a')!.requestedModel, 'sonnet');
  });

  test('the board ignores a stale end message from an earlier dispatch of the same card', () => {
    const current = nextCliRunStatus(undefined, {
      cardId: 'card-a', providerLabel: 'Codex', running: true, dispatchId: 'card-a:2', requestedModel: 'gpt-6.1-sol',
    });
    const after = nextCliRunStatus(current!, {
      cardId: 'card-a', providerLabel: 'Claude Code', running: false, dispatchId: 'card-a:1',
    });

    assert.equal(after, current);
  });

  test('exposes the full long model name as the pill title', () => {
    const longName = 'anthropic/claude-sonnet-5-5-extended-thinking-preview-2026-10-18';
    const view = cliRunPillView({
      providerLabel: 'Claude Code', statusLine: '', stoppable: false, actualModel: longName,
    });

    assert.equal(view.model, longName);
    assert.ok(view.title.includes(longName));
  });

  test('shows the thinking level next to the model and keeps it once the actual model is confirmed', () => {
    const { runs, tracker } = board();
    const run = tracker('card-a', 'Claude Code', 'card-a:1');
    run.setModel({ requested: 'sonnet', thinkingLevel: 'high' });
    run.start();

    const pending = cliRunPillView(runs.get('card-a')!);
    assert.equal(pending.thinkingLevel, 'high');
    assert.equal(
      pending.title,
      'Claude Code is working on this card on requested model sonnet (not yet confirmed by the CLI) at thinking level high',
    );

    run.setModel({ requested: 'sonnet', actual: 'claude-sonnet-5-5', thinkingLevel: 'high' });
    const confirmed = cliRunPillView(runs.get('card-a')!);
    assert.equal(confirmed.model, 'claude-sonnet-5-5');
    assert.equal(confirmed.thinkingLevel, 'high');
  });

  test('shows a thinking level even when no model is known', () => {
    const { runs, tracker } = board();
    const run = tracker('card-a', 'Codex', 'card-a:1');
    run.setModel({ thinkingLevel: 'xhigh' });
    run.start();

    const view = cliRunPillView(runs.get('card-a')!);
    assert.equal(view.model, '');
    assert.equal(view.thinkingLevel, 'xhigh');
    assert.equal(view.title, 'Codex is working on this card at thinking level xhigh');
  });

  test('a retry does not inherit the earlier dispatch thinking level, and blanks are ignored', () => {
    const { runs, tracker } = board();
    const first = tracker('card-a', 'Claude Code', 'card-a:1');
    first.setModel({ requested: 'sonnet', thinkingLevel: 'high' });
    first.start();
    first.end();

    const retry = tracker('card-a', 'Cursor', 'card-a:2');
    retry.setModel({ requested: 'Gemini 3.8 Flash' });
    retry.start();
    assert.equal('thinkingLevel' in runs.get('card-a')!, false);

    const blank = nextCliRunStatus(undefined, {
      cardId: 'card-b', providerLabel: 'Codex', running: true, dispatchId: 'card-b:1', thinkingLevel: '  ',
    });
    assert.equal(cliRunPillView(blank!).thinkingLevel, '');
  });
});
