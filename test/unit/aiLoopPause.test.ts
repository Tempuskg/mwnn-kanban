import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { createAiLoopPauseGate } from '../../src/aiLoopPause';

async function isSettled(promise: Promise<void>): Promise<boolean> {
  let settled = false;
  void promise.then(() => {
    settled = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  return settled;
}

suite('AI loop pause gate', () => {
  test('waiting while not paused resolves at once', async () => {
    const gate = createAiLoopPauseGate();

    assert.equal(await isSettled(gate.waitWhilePaused()), true);
  });

  test('a paused gate holds waiters until resumed', async () => {
    const changes: boolean[] = [];
    const gate = createAiLoopPauseGate(() => changes.push(gate.isPaused()));

    assert.equal(gate.pause(), true);
    assert.equal(gate.pause(), false);
    const wait = gate.waitWhilePaused();
    assert.equal(await isSettled(wait), false);

    assert.equal(gate.resume(), true);
    assert.equal(await isSettled(wait), true);
    assert.equal(gate.resume(), false);
    assert.deepEqual(changes, [true, false]);
  });

  test('release wakes a paused waiter and refuses later pauses', async () => {
    const gate = createAiLoopPauseGate();
    gate.pause();
    const wait = gate.waitWhilePaused();

    gate.release();

    assert.equal(await isSettled(wait), true);
    assert.equal(gate.isPaused(), false);
    assert.equal(gate.pause(), false);
  });
});
