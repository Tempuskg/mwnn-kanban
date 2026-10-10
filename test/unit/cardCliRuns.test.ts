import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { CardCliRunRegistry } from '../../src/cardCliRuns';
import { isWebviewToHostMessage } from '../../src/types';

suite('CardCliRunRegistry', () => {
  test('abortCard aborts only the runs registered for that card', () => {
    const registry = new CardCliRunRegistry();
    const first = registry.start('card-a');
    const second = registry.start('card-b');
    const untagged = registry.start();

    assert.equal(registry.abortCard('card-a'), 1);
    assert.equal(first.signal.aborted, true);
    assert.equal(second.signal.aborted, false);
    assert.equal(untagged.signal.aborted, false);
  });

  test('abortCard is a no-op for a card with no live run', () => {
    const registry = new CardCliRunRegistry();
    const run = registry.start('card-a');
    run.finish();

    assert.equal(registry.hasCard('card-a'), false);
    assert.equal(registry.abortCard('card-a'), 0);
    assert.equal(run.signal.aborted, false);
  });

  test('abortAll aborts every registered run, as the palette command does', () => {
    const registry = new CardCliRunRegistry();
    const runs = [registry.start('card-a'), registry.start('card-b'), registry.start()];

    assert.equal(registry.size, 3);
    assert.equal(registry.abortAll(), 3);
    assert.deepEqual(runs.map((run) => run.signal.aborted), [true, true, true]);
  });

  test('finish removes the run so hasCard tracks liveness', () => {
    const registry = new CardCliRunRegistry();
    const run = registry.start('card-a');
    assert.equal(registry.hasCard('card-a'), true);
    run.finish();
    assert.equal(registry.size, 0);
  });
});

suite('stopCardRun webview message', () => {
  test('requires a string cardId', () => {
    assert.equal(isWebviewToHostMessage({ type: 'stopCardRun', cardId: 'card-1' }), true);
    assert.equal(isWebviewToHostMessage({ type: 'stopCardRun' }), false);
    assert.equal(isWebviewToHostMessage({ type: 'stopCardRun', cardId: 1 }), false);
  });
});
