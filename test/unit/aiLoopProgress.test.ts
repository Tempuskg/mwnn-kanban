import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { createAiLoopProgressOptions } from '../../src/aiLoopProgress';

suite('AI loop progress', () => {
  test('uses window-scoped progress without a notification cancel control', () => {
    const options = createAiLoopProgressOptions({ Window: 'window' as const });

    assert.deepEqual(options, {
      location: 'window',
      title: 'MWNN AI loop',
    });
    assert.equal('cancellable' in options, false);
  });
});
